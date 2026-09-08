import { generateContent, TraceContext } from './geminiClient';

/**
 * AI chat planner — any wording → plan. Never invents prices or types.
 * Catalog types + cities come from DB only (no hardcoded bus/hoarding/led lists).
 */

import { canonicalizeServiceName } from '../utils/serviceNameUtils';
import {
  reportAiTelemetry,
  usageFromGeminiResponse,
} from './aiTokenMonitor';

const MODEL = 'gemini-3.1-flash-lite';
const TELEMETRY_MODULE = 'chat_intent';

/** One batch clause from Gemini (validated by parseIntent against DB). */
export interface ChatIntentSegment {
  service?: string | null;
  city?: string | null;
  qty?: number | null;
  place?: string | null;
  raw?: string | null;
}

export interface ChatIntentHint {
  kind?: 'greeting' | 'help' | 'quote' | 'clarify_type' | 'city_browse' | 'services_browse' | 'other' | null;
  /** Catalog type / family tokens the user wants. */
  media?: string[];
  medium?: string | null;
  city?: string | null;
  areaHint?: string | null;
  /** Raw site/direction phrase extracted from the user's wording. */
  directionHint?: string | null;
  /** True when feature/place is ambiguous (led, bus stand, outdoor…) — ask type from DB. */
  ambiguous?: boolean;
  clarifyHint?: string | null;
  qty?: number | null;
  duration?: string | null;
  /** Parsed for telemetry / future use — never show in chat bubbles (Phase 1). */
  shortReply?: string | null;
  /** Multi-service mixed-city batch (Phase 2). Validated per segment in parseIntent. */
  segments?: ChatIntentSegment[];
}

export interface ChatPlannerCatalog {
  types: string[];
  cities: string[];
}

/** Active funnel locks sent to Gemini so refinements do not re-parse from scratch. */
export interface ChatPlannerSessionContext {
  medium?: string | null;
  mediumType?: string | null;
  city?: string | null;
  area?: string | null;
  directionHint?: string | null;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function getApiKey(): string | null {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || String(apiKey).trim() === '') return null;
  return String(apiKey).trim();
}

function normalizeMediaList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (raw != null && String(raw).trim()) {
    return String(raw)
      .split(/[,&+/]| and /i)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Map free labels onto catalog type keys / family tokens (e.g. "bus" → family "bus").
 * Does NOT map feature words like "led" onto a single type (caller should clarify).
 */
export function resolveMediaAgainstCatalog(
  media: string[],
  catalogTypes: string[],
): string[] {
  if (!media.length || !catalogTypes.length) return [];
  const out: string[] = [];
  const catalog = catalogTypes
    .map((t) => ({
      raw: t,
      key: canonicalizeServiceName(t),
    }))
    .filter((t) => t.key.length >= 1);

  const familyTokens = [
    ...new Set(
      catalog
        .map((c) => c.key.split(/\s+/).filter(Boolean)[0] || '')
        .filter((w) => w.length >= 3),
    ),
  ];

  for (const m of media) {
    const q = canonicalizeServiceName(m);
    if (!q) continue;

    const exact = catalog.find((c) => c.key === q);
    if (exact) {
      if (!out.includes(q)) out.push(q);
      continue;
    }

    // Single-token family ("bus" / "auto") when catalog has that first word
    const qWords = q.split(/\s+/).filter(Boolean);
    if (qWords.length === 1) {
      const familyHit = familyTokens.includes(q);
      if (familyHit) {
        if (!out.includes(q)) out.push(q);
        continue;
      }
      // Silent typo vs family token (hording→hoarding, buss already normalized)
      const maxD = q.length >= 7 ? 2 : 1;
      let bestTok: string | null = null;
      let bestD = Infinity;
      let ties = 0;
      for (const f of familyTokens) {
        if (Math.abs(f.length - q.length) > maxD) continue;
        const d = editDistance(q, f);
        if (d === 0 || d > maxD) continue;
        if (d < bestD) {
          bestD = d;
          bestTok = f;
          ties = 1;
        } else if (d === bestD) ties += 1;
      }
      if (bestTok && ties === 1) {
        if (!out.includes(bestTok)) out.push(bestTok);
        continue;
      }
    }

    let best: { raw: string; key: string; score: number } | null = null;
    for (const c of catalog) {
      let score = 0;
      if (c.key === q) score = 100;
      else if (c.key.startsWith(`${q} `) || q.startsWith(`${c.key} `)) score = 80;
      else continue;
      if (!best || score > best.score) best = { raw: c.raw, key: c.key, score };
    }
    if (best && best.score >= 80) {
      if (qWords.length >= 2) {
        // Keep "bus shelter" — do not collapse to family token "bus"
        if (!out.includes(q)) out.push(q);
      } else {
        const family = best.key.split(/\s+/).filter(Boolean)[0] || best.raw;
        if (!out.includes(family)) out.push(family);
      }
    }
  }
  return out;
}

export function resolveCityAgainstCatalog(
  city: string | null | undefined,
  catalogCities: string[],
): string | null {
  if (!city?.trim()) return null;
  const q = city.toLowerCase().trim();
  // Exact match only — loose includes() wrongly maps invented AI cities onto wrong places
  const hit = catalogCities.find((c) => c.toLowerCase() === q);
  return hit || null;
}

/**
 * Ask Gemini for a quote plan using DB catalog types + cities only.
 */
function sessionContextLines(
  session: ChatPlannerSessionContext | null | undefined,
): string[] {
  if (!session) return [];
  const lines: string[] = ['ACTIVE SESSION (refine — keep locks unless user changes them):'];
  if (session.medium) lines.push(`- medium: ${session.medium}`);
  if (session.mediumType) lines.push(`- mediumType: ${session.mediumType}`);
  if (session.city) lines.push(`- city: ${session.city}`);
  if (session.area) lines.push(`- area: ${session.area}`);
  if (session.directionHint) lines.push(`- direction: ${session.directionHint}`);
  if (lines.length === 1) return [];
  return lines;
}

function normalizeAiSegments(raw: unknown): ChatIntentSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const seg = item as Record<string, unknown>;
      const service = seg.service != null ? String(seg.service).trim() : null;
      const city = seg.city != null ? String(seg.city).trim() : null;
      const place = seg.place != null ? String(seg.place).trim() : null;
      const qtyRaw = seg.qty;
      const qty =
        qtyRaw != null && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null;
      if (!service && !city && qty == null && !place) return null;
      return { service, city, qty, place } satisfies ChatIntentSegment;
    })
    .filter((s): s is ChatIntentSegment => !!s);
}

export async function parseChatIntentWithAi(
  userText: string,
  catalog: ChatPlannerCatalog | string[] = [],
  timeoutMs = 3500,
  sessionContext?: ChatPlannerSessionContext | null,
): Promise<ChatIntentHint | null> {
  if (!userText.trim()) return null;

  const types = Array.isArray(catalog) ? catalog : (catalog.types || []);
  const cities = Array.isArray(catalog) ? [] : (catalog.cities || []);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  const typeList = types.length > 0 ? types.slice(0, 100).join(' | ') : '(none)';
  const cityList = cities.length > 0 ? cities.slice(0, 40).join(' | ') : '(none)';

  try {
    const prompt = [
      'You plan steps for an advertising quote chatbot.',
      'Return ONLY compact JSON (no markdown):',
      '{"kind":"greeting"|"help"|"quote"|"clarify_type"|"city_browse"|"services_browse"|"other","media":string[],"segments":[{"service":string,"city":string|null,"qty":number|null,"place":string|null}],"city":string|null,"areaHint":string|null,"directionHint":string|null,"ambiguous":boolean,"clarifyHint":string|null,"qty":number|null,"duration":string|null,"shortReply":string}',
      '',
      'SERVICE TYPES IN DATABASE:',
      typeList,
      '',
      'CITIES IN DATABASE (use only these for city field):',
      cityList,
      '',
      'Rules:',
      '- HARD RULE: Every service, type, city, area, and direction must be an exact value supported by the supplied catalog lists or DB rows.',
      '- HARD RULE: If the user names a location that is not in the supplied CITIES list or DB area/locality values, set city=null and areaHint=null; never replace it with Chennai or any other city.',
      '- HARD RULE: A location introduced by "in", "at", "near", "around", or "for" is explicit user input and must be validated; do not silently discard it.',
      '- HARD RULE: If an explicit location is not catalogued, do not ask for a different city and do not return services from another city. Return kind="other", media=[], city=null, areaHint=null.',
      '- Never invent prices. Never invent types/cities not related to the lists above.',
      '- kind=greeting for hi/hello/hey/hlo/hii.',
      '- kind=help for help/how-to.',
      '- kind=services_browse when the user asks to list or show all available services.',
      '- Treat "list all", "show all", "all services", "list all services", and "what services are available?" as services_browse.',
      '- For services_browse, return media=[], city=null, areaHint=null, directionHint=null, ambiguous=false.',
      '- kind=city_browse when user only names a city.',
      '- kind=clarify_type + ambiguous=true when the user gives a FEATURE or place phrase that spans MANY types',
      '  Examples that MUST clarify (media=[] , clarifyHint=feature):',
      '  "led" (LED can be hoarding LED, mobile van LED, mobile van non led, etc.)',
      '  "bus stand branding", "outdoor", "vehicles", "branding" alone',
      '  Do NOT pick only one type for those.',
      '- kind=quote when types are clear: "bus", "auto", "bus and auto in madurai".',
      '  media = family tokens or catalog type names (bus, auto, …). Multiple allowed.',
      '- For mixed-city batch use segments[] (one object per service clause):',
      '  "cab madurai and auto in chennai" → segments=[{"service":"cab","city":"Madurai","qty":null,"place":null},{"service":"auto","city":"Chennai","qty":null,"place":null}], media=[], city=null',
      '  Each segment.service must be a catalog type/family; segment.city must be from CITIES or null.',
      '  Invalid / unknown city for a segment → city=null for that segment (never invent).',
      '- If user says a clear type WITHOUT city and cities exist → still kind=quote with media set; city=null; app asks city.',
      '- city = one of CITIES list ONLY when user named that exact city; otherwise null. Never invent a city or use a default city.',
      '- Never put locality/area names (e.g. Anna Nagar, Tenyampet) as city — use areaHint for those.',
      '- areaHint = locality only when user named it; else null.',
      '- directionHint = only the raw site/direction phrase the user named, such as "Gemini Fly Over"; otherwise null.',
      '- Do not invent or correct directionHint. It will be validated against catalog direction_remarks by the application.',
      '- qty only if user typed a count (not duration). duration like "3 months" or null.',
      '- shortReply = max 2 lines and max 12 words total. No opener (no Good choice/Sure/Great). No prices. No UI jargon. Never truncate catalog names.',
      '- For an unknown explicit location, shortReply must not claim availability; use an empty string and let the application provide the unavailable-location message.',
      '- Never start replies with Sure/Great/Perfect/I understand/Thanks/Here\'s what we found/Good choice/Let\'s continue/Hello.',
      '- Line 1: what is available. Line 2: the next question. Chips show the options — do not list them in the text.',
      '- Never invent services/cities/prices. Never say database.',
      '- Examples for shortReply:',
      '  "bus" → "Bus advertising options available.\\nWhich option do you need?"',
      '  "led" → "LED options available.\\nWhich option do you need?"',
      '  "chennai" → "Services available in Chennai.\\nWhich service do you need?"',
      '  "what services are available?" → "Advertising services available.\\nWhich service do you need?"',
      '  "list all" → "Advertising services available.\\nWhich service do you need?"',
      '  "which cities are available?" → "Available in these cities.\\nWhich city do you need?"',
      '  "bus chennai" → "Bus advertising options available.\\nWhich option do you need?"',
      '  "near ecr" → "Services available near ECR.\\nWhich service do you need?"',
      '  "bus semi branding" → "Available in more than one city.\\nWhich city do you need?"',
      '  "need quote for metro station" → "Metro Station options available.\\nWhich option do you need?"',
      '- Examples:',
      '  "bus" → kind=quote, media=["bus"], city=null, ambiguous=false',
      '  "apartment demo" → kind=quote, media=["apartment demo"], city=null, areaHint=null',
      '  "led" → kind=clarify_type, ambiguous=true, media=[], clarifyHint="led"',
      '  "bus and auto madurai" → kind=quote, media=["bus","auto"], city="Madurai"',
      '  "hoarding near Tenyampet" → kind=quote, media=["hoarding"], city=null, areaHint="Tenyampet"',
      '  "hoarding near Gemini Fly Over" → kind=quote, media=["hoarding"], city=null, areaHint=null, directionHint="Gemini Fly Over"',
      '  "bus stand branding madurai" → kind=clarify_type, ambiguous=true, clarifyHint="bus stand", city="Madurai"',
      '  "chennai" → kind=city_browse, city="Chennai"',
      '  "give me a quote for chennai" → kind=city_browse, city="Chennai", media=[]',
      '  "list all" → kind=services_browse, media=[], city=null, ambiguous=false',
      '  "bus 30 and auto 60 and 2 hoarding" → kind=quote, media=["bus","auto","hoarding"], city=null',
      '  "cab madurai and auto in chennai" → kind=quote, segments=[{"service":"cab","city":"Madurai"},{"service":"auto","city":"Chennai"}], media=[]',
      ...sessionContextLines(sessionContext),
      '',
      `User: ${userText.trim()}`,
    ].join('\n');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 240 },
      }),
    });

    if (!res.ok) {
      reportAiTelemetry({
        model: MODEL,
        module: TELEMETRY_MODULE,
        latency: Date.now() - startedAt,
        status: 'FAILED',
        errorMessage: `HTTP ${res.status}`,
      });
      return null;
    }
    const data = await res.json();
    const usage = usageFromGeminiResponse(data);
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw || typeof raw !== 'string') {
      reportAiTelemetry({
        model: MODEL,
        module: TELEMETRY_MODULE,
        latency: Date.now() - startedAt,
        status: 'FAILED',
        usage,
        errorMessage: 'Empty Gemini response',
      });
      return null;
    }

    let jsonText = raw.trim();
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonText = fence[1].trim();
    const brace = jsonText.match(/\{[\s\S]*\}/);
    if (brace) jsonText = brace[0];

    const parsed = JSON.parse(jsonText) as ChatIntentHint & { media?: unknown; segments?: unknown };
    const ambiguous = parsed.ambiguous === true || parsed.kind === 'clarify_type';
    const segments = normalizeAiSegments(parsed.segments);

    let media = normalizeMediaList(parsed.media);
    if (!media.length && parsed.medium) media = normalizeMediaList(parsed.medium);
    if (!ambiguous && !segments.length) {
      media = resolveMediaAgainstCatalog(media, types);
    } else if (ambiguous) {
      media = [];
    }

    // Keep JSON field for the model; never return it for chat bubbles (Phase 1).
    void parsed.shortReply;

    reportAiTelemetry({
      model: MODEL,
      module: TELEMETRY_MODULE,
      latency: Date.now() - startedAt,
      status: 'SUCCESS',
      usage,
    });

    return {
      kind: ambiguous ? 'clarify_type' : (parsed.kind || 'quote'),
      media,
      medium: media[0] || null,
      city: resolveCityAgainstCatalog(
        parsed.city ? String(parsed.city).trim() : null,
        cities,
      ),
      areaHint: parsed.areaHint ? String(parsed.areaHint).trim() : null,
      directionHint: parsed.directionHint
        ? String(parsed.directionHint).trim().slice(0, 160)
        : null,
      ambiguous,
      clarifyHint: parsed.clarifyHint ? String(parsed.clarifyHint).trim() : null,
      qty: parsed.qty != null && Number.isFinite(Number(parsed.qty)) ? Number(parsed.qty) : null,
      duration: parsed.duration ? String(parsed.duration) : null,
      shortReply: null,
      segments: segments.length ? segments : undefined,
    };
  } catch (error) {
    reportAiTelemetry({
      model: MODEL,
      module: TELEMETRY_MODULE,
      latency: Date.now() - startedAt,
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
