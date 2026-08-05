/**
 * AI chat planner — any wording → plan. Never invents prices or types.
 * Catalog types + cities come from DB only (no hardcoded bus/hoarding/led lists).
 */

const MODEL = 'gemini-2.5-flash-lite';

export interface ChatIntentHint {
  kind?: 'greeting' | 'help' | 'quote' | 'clarify_type' | 'city_browse' | 'other' | null;
  /** Catalog type / family tokens the user wants. */
  media?: string[];
  medium?: string | null;
  city?: string | null;
  areaHint?: string | null;
  /** True when feature/place is ambiguous (led, bus stand, outdoor…) — ask type from DB. */
  ambiguous?: boolean;
  clarifyHint?: string | null;
  qty?: number | null;
  duration?: string | null;
  shortReply?: string | null;
}

export interface ChatPlannerCatalog {
  types: string[];
  cities: string[];
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
      key: t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    }))
    .filter((t) => t.key.length >= 1);

  for (const m of media) {
    const q = m.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!q) continue;

    const exact = catalog.find((c) => c.key === q);
    if (exact) {
      if (!out.includes(q)) out.push(q);
      continue;
    }

    // Single-token family ("bus" / "auto") when catalog has that first word
    const qWords = q.split(/\s+/).filter(Boolean);
    if (qWords.length === 1) {
      const familyHit = catalog.some((c) => {
        const first = c.key.split(/\s+/).filter(Boolean)[0] || '';
        return first === q;
      });
      if (familyHit) {
        if (!out.includes(q)) out.push(q);
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

function resolveCityAgainstCatalog(
  city: string | null | undefined,
  catalogCities: string[],
): string | null {
  if (!city?.trim()) return null;
  const q = city.toLowerCase().trim();
  const hit = catalogCities.find((c) => c.toLowerCase() === q)
    || catalogCities.find((c) => c.toLowerCase().includes(q) || q.includes(c.toLowerCase()));
  return hit || city.trim();
}

/**
 * Ask Gemini for a quote plan using DB catalog types + cities only.
 */
export async function parseChatIntentWithAi(
  userText: string,
  catalog: ChatPlannerCatalog | string[] = [],
  timeoutMs = 3500,
): Promise<ChatIntentHint | null> {
  const apiKey = getApiKey();
  if (!apiKey || !userText.trim()) return null;

  const types = Array.isArray(catalog) ? catalog : (catalog.types || []);
  const cities = Array.isArray(catalog) ? [] : (catalog.cities || []);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const typeList = types.length > 0 ? types.slice(0, 100).join(' | ') : '(none)';
  const cityList = cities.length > 0 ? cities.slice(0, 40).join(' | ') : '(none)';

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const prompt = [
      'You plan steps for an advertising quote chatbot.',
      'Return ONLY compact JSON (no markdown):',
      '{"kind":"greeting"|"help"|"quote"|"clarify_type"|"city_browse"|"other","media":string[],"city":string|null,"areaHint":string|null,"ambiguous":boolean,"clarifyHint":string|null,"qty":number|null,"duration":string|null,"shortReply":string}',
      '',
      'SERVICE TYPES IN DATABASE:',
      typeList,
      '',
      'CITIES IN DATABASE (use only these for city field):',
      cityList,
      '',
      'Rules:',
      '- Never invent prices. Never invent types/cities not related to the lists above.',
      '- kind=greeting for hi/hello/hey.',
      '- kind=help for help/how-to.',
      '- kind=city_browse when user only names a city.',
      '- kind=clarify_type + ambiguous=true when the user gives a FEATURE or place phrase that spans MANY types',
      '  Examples that MUST clarify (media=[] , clarifyHint=feature):',
      '  "led" (LED can be hoarding LED, mobile van LED, mobile van non led, etc.)',
      '  "bus stand branding", "outdoor", "vehicles", "branding" alone',
      '  Do NOT pick only one type for those.',
      '- kind=quote when types are clear: "bus", "auto", "bus and auto in madurai".',
      '  media = family tokens or catalog type names (bus, auto, …). Multiple allowed.',
      '- If user says a clear type WITHOUT city and cities exist → still kind=quote with media set; app asks city.',
      '- city = one of CITIES list or null. Never put locality/area names (e.g. Anna Nagar) as city.',
      '- qty only if user typed a count (not duration). duration like "3 months" or null.',
      '- shortReply = ONE short friendly line (max 14 words). No prices.',
      '- Examples:',
      '  "bus" → kind=quote, media=["bus"], city=null, ambiguous=false',
      '  "led" → kind=clarify_type, ambiguous=true, media=[], clarifyHint="led"',
      '  "bus and auto madurai" → kind=quote, media=["bus","auto"], city="Madurai"',
      '  "bus stand branding madurai" → kind=clarify_type, ambiguous=true, clarifyHint="bus stand", city="Madurai"',
      '  "chennai" → kind=city_browse, city="Chennai"',
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

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw || typeof raw !== 'string') return null;

    let jsonText = raw.trim();
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonText = fence[1].trim();
    const brace = jsonText.match(/\{[\s\S]*\}/);
    if (brace) jsonText = brace[0];

    const parsed = JSON.parse(jsonText) as ChatIntentHint & { media?: unknown };
    const ambiguous = parsed.ambiguous === true || parsed.kind === 'clarify_type';

    let media = normalizeMediaList(parsed.media);
    if (!media.length && parsed.medium) media = normalizeMediaList(parsed.medium);
    if (!ambiguous) {
      media = resolveMediaAgainstCatalog(media, types);
    } else {
      media = [];
    }

    let shortReply = parsed.shortReply ? String(parsed.shortReply).trim() : null;
    if (shortReply && shortReply.length > 90) shortReply = shortReply.slice(0, 87) + '…';

    return {
      kind: ambiguous ? 'clarify_type' : (parsed.kind || 'quote'),
      media,
      medium: media[0] || null,
      city: resolveCityAgainstCatalog(
        parsed.city ? String(parsed.city).trim() : null,
        cities,
      ),
      areaHint: parsed.areaHint ? String(parsed.areaHint).trim() : null,
      ambiguous,
      clarifyHint: parsed.clarifyHint ? String(parsed.clarifyHint).trim() : null,
      qty: parsed.qty != null && Number.isFinite(Number(parsed.qty)) ? Number(parsed.qty) : null,
      duration: parsed.duration ? String(parsed.duration) : null,
      shortReply,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
