/**
 * useCityServiceRegistry
 * ──────────────────────
 * Builds and persists a city→services registry by calling Gemini once per
 * city PDF. Lives at App level so it runs regardless of which page is open.
 *
 * Registry is stored in three tiers:
 *   • module-level singleton Map  → survives HMR without sessionStorage reads
 *   • sessionStorage              → survives full page refresh in the same tab
 *   • localStorage (NEW, TTL 7d)  → survives tab close / new tab same device
 *
 * Schema (v2): each city holds a Map of normalized canonical service names
 * to ServiceEntry records (with unitPrice/uom/aliases hooks for the future
 * pricing-summary parser). Legacy `services[]` and `quantities{}` are kept
 * as derived fields so existing consumers keep working unchanged.
 *
 * ChatInterface reads from this singleton directly via getCityServiceRegistry().
 */

import { useEffect } from 'react';
import { useAppStore } from '../store';
import { trackTokenUsage } from '../services/tokenMonitorService';

// ── Shared types ─────────────────────────────────────────────────────────────
export interface ServiceQuantity { min: number; max: number | null; }

/**
 * Structured per-service entry. unitPrice/uom/etc. are nullable today and
 * will be filled in by the upcoming Pricing-Summary table parser.
 */
export interface ServiceEntry {
  canonicalName: string;        // normalized + synonyms applied (lookup key)
  displayName: string;          // first/prettiest variant seen, shown in UI
  aliases: string[];            // every other variant the same service appears as
  minQty: number;
  maxQty: number | null;
  unitPrice: number | null;     // ₹ per unit (filled later)
  uom: string | null;           // "per board", "per metro/month", …
  campaignPrice: number | null; // total for min qty
  remarks: string | null;
  size: string | null;
  rowIndex: number | null;      // position in PDF Pricing-Summary table
}

export interface CityRegistry {
  // ── New (v2) ──
  city: string;
  entries: Record<string, ServiceEntry>;   // keyed by canonicalName
  idf: Record<string, number>;             // token → inverse-document-frequency weight
  source: 'gemini' | 'pricing_summary';
  builtAt: number;                          // Date.now() when built
  ttlDays: number;                          // expiry hint for localStorage
  pdfHash: string | null;                   // sha-256 of source PDF text (cache invalidation)

  // ── Legacy (derived from entries — kept for backward compat) ──
  services: string[];
  quantities: Record<string, ServiceQuantity>;

  status: 'building' | 'ready' | 'failed';
}

// ── Module-level singleton: survives HMR without re-parsing ──────────────────
const _registry = new Map<string, CityRegistry>();
// Bump PARSER_VERSION whenever the fast-path/Gemini parsing logic changes so
// previously cached (and possibly truncated) registries are invalidated and
// rebuilt from the source PDF. Keys include this version so old entries are
// simply ignored (and pruned on next persist).
const PARSER_VERSION = 'v9-minqty-not-campaign-days';
const SESSION_KEY = `e2w_city_service_registry__${PARSER_VERSION}`;
const LOCAL_KEY_PREFIX = `e2w_registry_v2:${PARSER_VERSION}:`;
const DEFAULT_TTL_DAYS = 7;

// One-time cleanup of legacy cache keys so they don't sit in storage forever.
try {
  ['e2w_city_service_registry'].forEach(k => sessionStorage.removeItem(k));
  Object.keys(localStorage)
    .filter(k => k.startsWith('e2w_registry_v2:') && !k.startsWith(LOCAL_KEY_PREFIX))
    .forEach(k => localStorage.removeItem(k));
} catch { /* ignore */ }

export const getCityServiceRegistry = () => _registry;

// ── Module-level page index: cityKey → { canonicalName → reference pageNumbers[] } ──
// Built in-memory each session from pageImages — never persisted (images not in localStorage).
const _pageIndex = new Map<string, Record<string, number[]>>();
export const getPageIndexForCity = (cityKey: string): Record<string, number[]> | null =>
  _pageIndex.get(cityKey) ?? null;

// ── City list (single source of truth) ───────────────────────────────────────
export const KNOWN_CITY_LIST = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tirupur',
  'erode', 'vellore', 'tirunelveli', 'bangalore', 'hyderabad', 'mumbai', 'delhi', 'kochi',
];

// ── Layer 1: normalize a service name ────────────────────────────────────────
// • lowercase
// • en/em dash, hyphen, slash → space
// • strip page markers like "(1/3)" and any other paren content
// • singularize common trailing-s nouns
// • collapse whitespace
function normalizeSvc(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(\d+\s*\/\s*\d+\)/g, ' ')                 // strip "(1/3)" page markers FIRST
    .replace(/[\u2013\u2014\u2212–—\-\/]/g, ' ')         // dashes & slashes
    .replace(/[()[\]{}]/g, ' ')                          // remaining brackets
    .replace(/\b(boards|hoardings|posters|screens|stations|ads|copies|stickers|banners|frames|cabs|autos|buses|vans|metros|hoarding)\b/g,
      m => {
        // singularize, but keep "hoarding" mapped to "hoarding" (already singular)
        if (m === 'hoarding') return 'hoarding';
        return m.replace(/s$/, '');
      })
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Layer 2: domain synonyms (applied AFTER normalizeSvc) ────────────────────
// Map "ads" → "branding" so detail-page headings collapse onto summary rows.
// Keep this list small; add entries only when a real mismatch is observed.
const SYNONYMS: Array<[RegExp, string]> = [
  [/\bad\b/g, 'branding'],                 // "lobby screen ad" → "lobby screen branding"
  [/\badvertising\b/g, 'branding'],
  // NOTE: do NOT collapse "sticker" → "branding". "Auto Back Stickers" is a
  // distinct rate-card row from Auto Full/Semi Branding — collapsing it
  // creates false token overlap.
  [/\bunderground metro\b/g, 'underground'], // PDF row 22 doubled word
  [/\bunderground station\b/g, 'underground'],
];

function applySynonyms(s: string): string {
  let out = s;
  for (const [re, to] of SYNONYMS) out = out.replace(re, to);
  return out.replace(/\s+/g, ' ').trim();
}

// canonicalize = normalize + synonyms — used for BOTH registry keys and user input.
export function canonicalizeServiceName(s: string): string {
  return applySynonyms(normalizeSvc(s));
}

// ── Heading-pattern fast-path helpers ────────────────────────────────────────
// Determine whether a line looks like a service-page heading rather than a
// price/spec line. Headings are short, mostly ALL-CAPS (or title case), have
// no rupee/percent/digits-with-units, and don't contain words like "price",
// "duration", "min." etc.
const HEADING_BLOCKLIST = /\b(price|rental|display|design|specification|specifications|reference|image|grand total|total|terms|conditions|gst|lead time|prior notice|min\.|quantity|duration|material|back to summary|email|phone|sales@|proposal|day image|night image|left side|right side|back side|back top|back to)\b/i;
const RUPEE_OR_NUMBER_HEAVY = /(₹|\bRs\.?\b|\d{2,}|%|inches|days?|months?)/i;

function isPlausibleHeading(s: string): boolean {
  // Strip leading size prefix such as "30 Sqft " (e.g. "30 Sqft FLEX BANNER")
  // so the number doesn't falsely trigger the RUPEE_OR_NUMBER_HEAVY check.
  const t = s.trim().replace(/^\d+\s*(sqft?|sqm?)\s*/i, '');
  if (t.length < 4 || t.length > 80) return false;
  if (HEADING_BLOCKLIST.test(t)) return false;
  if (RUPEE_OR_NUMBER_HEAVY.test(t)) return false;
  // Must contain at least one alphabetic word
  if (!/[a-zA-Z]{3,}/.test(t)) return false;
  return true;
}

// True when a line could be part of a wrapped multi-line heading
// (no numbers, no blocklist words, mostly uppercase letters).
function isHeadingFragment(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 60) return false;
  if (HEADING_BLOCKLIST.test(t)) return false;
  if (RUPEE_OR_NUMBER_HEAVY.test(t)) return false;
  // Letters, dashes (incl. en/em), spaces, ampersand, slash, underscore. No commas/colons/parens.
  return /^[A-Za-z][A-Za-z\s\-\u2013\u2014&/_]+$/.test(t);
}

// ── Layer 4: IDF (inverse document frequency) per registry ───────────────────
// Common tokens (e.g. "branding") get a small weight; rare disambiguators
// (e.g. "underground", "lobby") get a large one. Used by future TF-IDF classifier.
function computeIdf(entries: Record<string, ServiceEntry>): Record<string, number> {
  const docFreq = new Map<string, number>();
  const N = Object.keys(entries).length || 1;
  for (const e of Object.values(entries)) {
    const tokens = new Set(e.canonicalName.split(/\s+/).filter(Boolean));
    for (const t of tokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const idf: Record<string, number> = {};
  for (const [token, df] of docFreq) {
    idf[token] = +(Math.log((N + 1) / (df + 1)) + 1).toFixed(3);
  }
  return idf;
}

// ── Layer 3: derive legacy services[]/quantities{} from entries map ──────────
function syncLegacyFields(reg: CityRegistry): void {
  reg.services = Object.keys(reg.entries);
  reg.quantities = {};
  for (const [k, e] of Object.entries(reg.entries)) {
    reg.quantities[k] = { min: e.minQty, max: e.maxQty };
  }
  reg.idf = computeIdf(reg.entries);
}

// ── pdfHash: cheap content fingerprint (sha-256 first 4 bytes hex) ───────────
async function hashText(text: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(text.slice(0, 8000));
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf).slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

// ── Persistence helpers ──────────────────────────────────────────────────────
function persistToSession() {
  try {
    const snapshot: Record<string, CityRegistry> = {};
    _registry.forEach((val, key) => { snapshot[key] = val; });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch { /* quota exceeded — silently skip */ }
}

function persistToLocal(cityKey: string, reg: CityRegistry) {
  try {
    const payload = { data: reg, expiresAt: reg.builtAt + reg.ttlDays * 86_400_000 };
    localStorage.setItem(LOCAL_KEY_PREFIX + cityKey, JSON.stringify(payload));
  } catch { /* ignore */ }
}

function readFromLocal(cityKey: string): CityRegistry | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_PREFIX + cityKey);
    if (!raw) return null;
    const { data, expiresAt } = JSON.parse(raw) as { data: CityRegistry; expiresAt: number };
    if (Date.now() > expiresAt) {
      localStorage.removeItem(LOCAL_KEY_PREFIX + cityKey);
      return null;
    }
    // Reject empty/failed snapshots so we re-parse from source
    if (!data || !data.entries || Object.keys(data.entries).length === 0 || data.status !== 'ready') {
      localStorage.removeItem(LOCAL_KEY_PREFIX + cityKey);
      return null;
    }
    return data;
  } catch { return null; }
}

// ── Restore from sessionStorage on first import ──────────────────────────────
// Runs once at module load time so the data is available before any component mounts.
// Only restore entries that are BOTH ready AND have actual non-empty content;
// reject empty/failed snapshots so the useEffect re-attempts a fresh build.
try {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    const parsed: Record<string, CityRegistry> = JSON.parse(stored);
    let dropped = 0;
    Object.entries(parsed).forEach(([key, val]) => {
      const v = val as CityRegistry;
      const hasContent = v.entries && Object.keys(v.entries).length > 0;
      if (v.status === 'ready' && hasContent) {
        _registry.set(key, v);
      } else {
        dropped++;
        console.log(`♻️ [Registry] Dropping stale "${key}" snapshot (status=${v.status}, entries=${v.entries ? Object.keys(v.entries).length : 0}) — will rebuild.`);
      }
    });
    if (_registry.size > 0) {
      console.log('♻️ [Registry] Restored from sessionStorage:', [..._registry.keys()].join(', '));
    }
    if (dropped > 0) {
      // Re-persist so the dropped entries don't keep coming back on reload
      const snapshot: Record<string, CityRegistry> = {};
      _registry.forEach((val, key) => { snapshot[key] = val; });
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
    }
  }
} catch { /* ignore corrupt storage */ }

// ── Helper: build a v2 CityRegistry from Gemini's raw extraction ─────────────
// Applies Layer 1 (normalize) + Layer 2 (synonyms) + Layer 3 (dedupe with
// alias preservation) + IDF computation.
// parsed.services     = inner-page heading names (canonical source)
// parsed.quantities   = keyed by inner-page name, prices from Summary cross-ref
// parsed.aliases      = { innerPageName: [summaryName, ...otherVariants] }
function buildRegistryFromGemini(
  cityKey: string,
  parsed: {
    services?: string[];
    quantities?: Record<string, {
      min?: unknown; max?: unknown;
      unitPrice?: unknown; uom?: unknown;
      campaignPrice?: unknown; remarks?: unknown; rowIndex?: unknown;
    }>;
    aliases?: Record<string, string[]>;
  },
  pdfHash: string,
): CityRegistry {
  const entries: Record<string, ServiceEntry> = {};

  for (const rawName of parsed.services ?? []) {
    if (typeof rawName !== 'string' || !rawName.trim()) continue;

    const canonical = canonicalizeServiceName(rawName);
    if (!canonical) continue;

    // Find the quantities/price row keyed by either raw or canonical
    const rawKey = Object.keys(parsed.quantities ?? {})
      .find(k => canonicalizeServiceName(k) === canonical) ?? rawName;
    const q = parsed.quantities?.[rawKey];
    const minQty = typeof q?.min === 'number' ? q.min : 1;
    const maxQty = typeof q?.max === 'number' ? q.max : null;
    const unitPrice = typeof q?.unitPrice === 'number' ? q.unitPrice : null;
    const uom = typeof q?.uom === 'string' ? q.uom.toLowerCase() : null;
    const campaignPrice = typeof q?.campaignPrice === 'number' ? q.campaignPrice : null;
    const remarks = typeof q?.remarks === 'string' ? q.remarks.trim() : null;
    const rowIndex = typeof q?.rowIndex === 'number' ? q.rowIndex : null;

    // Aliases: Summary-table name variants (or any other variant Gemini found)
    const rawAliases: string[] = (parsed.aliases?.[rawName] ?? []).filter(
      (a): a is string => typeof a === 'string' && a.trim().length > 0
    );
    const aliasSet = new Set<string>(rawAliases.map(a => a.trim()));

    if (entries[canonical]) {
      // Duplicate inner-page name — merge aliases, keep stricter qty
      const existing = entries[canonical];
      for (const a of aliasSet) if (!existing.aliases.includes(a)) existing.aliases.push(a);
      existing.minQty = Math.max(existing.minQty, minQty);
      if (existing.maxQty == null) existing.maxQty = maxQty;
      if (existing.unitPrice == null && unitPrice != null) existing.unitPrice = unitPrice;
      if (existing.uom == null && uom != null) existing.uom = uom;
      if (existing.campaignPrice == null && campaignPrice != null) existing.campaignPrice = campaignPrice;
    } else {
      entries[canonical] = {
        canonicalName: canonical,
        displayName: rawName.trim().replace(/\s+/g, ' '),
        aliases: [...aliasSet],
        minQty,
        maxQty,
        unitPrice,
        uom,
        campaignPrice,
        remarks,
        size: null,
        rowIndex,
      };
    }
  }

  const reg: CityRegistry = {
    city: cityKey,
    entries,
    idf: {},
    source: 'gemini',
    builtAt: Date.now(),
    ttlDays: DEFAULT_TTL_DAYS,
    pdfHash,
    services: [],
    quantities: {},
    status: 'ready',
  };
  syncLegacyFields(reg);
  return reg;
}

/**
 * Public lookup — find a ServiceEntry by user input (canonical or alias).
 * Returns null if no exact match. Use this for new consumers; legacy code
 * can keep reading `registry.services` and `registry.quantities`.
 */
export function findEntryByName(cityKey: string, query: string): ServiceEntry | null {
  const reg = _registry.get(cityKey);
  if (!reg || reg.status !== 'ready') return null;
  const canonical = canonicalizeServiceName(query);
  if (reg.entries[canonical]) return reg.entries[canonical];
  for (const e of Object.values(reg.entries)) {
    if (e.aliases.some(a => canonicalizeServiceName(a) === canonical)) return e;
  }
  return null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export const useCityServiceRegistry = () => {
  const activeProposals = useAppStore(state => state.activeProposals);

  useEffect(() => {
    console.log(`🔍 [Registry] useEffect fired — ${activeProposals.length} active proposals`);

    // ── Evict registry entries whose proposal has been unloaded ──────────────
    const activeCityKeys = new Set<string>();
    activeProposals.forEach(p => {
      const k = KNOWN_CITY_LIST.find(c => p.fileName.toLowerCase().includes(c))
        || p.fileName.replace(/\.(pdf|xlsx?)$/i, '').toLowerCase().replace(/[^a-z]/g, '');
      if (k) activeCityKeys.add(k);
    });
    for (const key of [..._registry.keys()]) {
      if (!activeCityKeys.has(key)) {
        _registry.delete(key);
        try { localStorage.removeItem(LOCAL_KEY_PREFIX + key); } catch { /* ignore */ }
        console.log(`🗑️ [Registry] Evicted "${key}" — proposal unloaded`);
      }
    }
    // Re-persist session snapshot after eviction (clears removed cities)
    if (activeCityKeys.size === 0 && _registry.size === 0) {
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    } else {
      persistToSession();
    }

    activeProposals.forEach(proposal => {
      const cityKey = KNOWN_CITY_LIST.find(c =>
        proposal.fileName.toLowerCase().includes(c)
      ) || proposal.fileName.replace(/\.(pdf|xlsx?)$/i, '').toLowerCase().replace(/[^a-z]/g, '');

      if (!cityKey) return;

      const existing = _registry.get(cityKey);
      if (existing && (existing.status === 'ready' || existing.status === 'building')) return;

      if (!proposal.textContent || proposal.textContent.trim().length < 50) {
        console.warn(`⚠️ [Registry] Skipping "${cityKey}" — textContent too short (${proposal.textContent?.trim().length ?? 0} chars)`);
        _registry.set(cityKey, makeFailedRegistry(cityKey));
        return;
      }

      _registry.set(cityKey, makeBuildingRegistry(cityKey));
      console.log(`🏗️ [Registry] Building for "${cityKey}"...`);

      (async () => {
        try {
          const pdfHash = await hashText(proposal.textContent!);
          let seededServiceNames: string[] | null = null;

          // Tier-3 cache: localStorage hit (within TTL + same pdfHash) → no API call
          const cached = readFromLocal(cityKey);
          if (cached && cached.pdfHash === pdfHash) {
            _registry.set(cityKey, cached);
            persistToSession();
            console.log(`💾 [Registry] localStorage hit for "${cityKey}" — ${Object.keys(cached.entries).length} entries, no API call.`);
            // Build page index from already-loaded pageImages (synchronous, no API call)
            const idx = buildPageIndex(cityKey, cached.entries, proposal.pageImages ?? []);
            _pageIndex.set(cityKey, idx);
            return;
          }

          // ── Fast path: parse explicit "Inner Header content Service Name list" ──
          // This section is appended at the bottom of the rate card and lists every
          // service name exactly as it appears in the inner-page headings. Parsing
          // it directly is deterministic and avoids the 15k-char Gemini truncation
          // problem that caused only 12/32 services to be detected for Chennai.
          // Only stop at a NEW ## section header (not at lines starting with a single
          // '#' which could legitimately appear inside the list, e.g. "#1 bus branding").
          const serviceListMatch = proposal.textContent!.match(
            /##Inner Header content Service Name list\s*\n([\s\S]*?)(?=\n##|\s*$)/i
          );
          if (serviceListMatch) {
            const rawBlock = serviceListMatch[1];
            const rawLines = rawBlock.split('\n').map(s => s.trim());
            const serviceNames = rawLines
              // Reject only true markdown section headers ("## ...").
              // A leading "#1 ", "1.", "1)", etc. is a numeric list marker we
              // strip below — those lines must be KEPT.
              .filter(s => s.length > 2 && !/^#{2,}/.test(s))
              // Strip leading list markers: "1.", "1)", "- ", "* ", "#1 ", "•"
              .map(s => s.replace(/^(?:#?\d+[.)]?\s+|[-*•]\s+)/, '').trim())
              .filter(s => s.length > 2);

            console.log(`🔎 [Registry] "${cityKey}" fast-path matched ${rawLines.length} raw lines, ${serviceNames.length} after filter. Raw block:\n${rawBlock}`);

            if (serviceNames.length > 0) {
              seededServiceNames = serviceNames;
              console.log(`✅ [Registry] "${cityKey}" seeded ${serviceNames.length} services from explicit list; continuing to quantity extraction`);
            }
          } else {
            console.log(`🔎 [Registry] "${cityKey}" — no "##Inner Header content Service Name list" section found, trying heading-pattern fast path`);
          }

          // ── Fast path #2: detect inner-page headings by their (N/M) page marker ──
          // Every service detail page in the rate-card PDF is titled with the
          // service name followed by a "(1/3)" / "( 2/3 )" / "(3/4)" page marker.
          // The marker may be on the same line OR on the next line, AND the
          // heading itself may wrap across 2 lines (e.g. "BUS SHELTER - DOUBLE\n
          // PANEL - LIT (1/3)"). We must collect the WHOLE heading by scanning
          // backwards from the marker line.
          const allText = proposal.textContent!;
          const flat = allText
            .replace(/\t\|\t/g, ' ')
            .replace(/\s*\|\s*/g, ' ')
            .replace(/[ \t]+/g, ' ');
          const lines = flat.split('\n').map(l => l.trim());

          const pageMarker = /\(\s*1\s*\/\s*\d+\s*\)\s*$/;
          const headingCandidates = new Set<string>();

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !pageMarker.test(line)) continue;

            // The marker line may itself contain part of the heading
            // (e.g. "PANEL - LIT (1/3)") or be marker-only ("( 1/2)").
            const tailHeading = line.replace(pageMarker, '').trim();
            const parts: string[] = [];
            if (tailHeading) parts.unshift(tailHeading);

            // Walk backwards collecting heading-fragment lines (ALL-CAPS-ish,
            // no prices/specs/blocklist words). Stop at the first non-fragment
            // (which is typically a page number "1", "2" or a blank).
            for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
              const prev = lines[j];
              if (!prev) break;
              if (!isHeadingFragment(prev)) break;
              parts.unshift(prev);
            }

            if (parts.length === 0) continue;
            const heading = parts.join(' ').replace(/\s+/g, ' ').trim();
            if (isPlausibleHeading(heading)) {
              headingCandidates.add(heading.toLowerCase());
            }
          }

          if (!seededServiceNames && headingCandidates.size > 0) {
            const serviceNames = [...headingCandidates];
            seededServiceNames = serviceNames;
            console.log(`✅ [Registry] "${cityKey}" seeded ${serviceNames.length} services from heading-pattern fast path; continuing to quantity extraction. Headings:`, serviceNames);
          } else {
            console.log(`🔎 [Registry] "${cityKey}" — heading-pattern fast path found 0 candidates, using Gemini full extraction`);
          }

          // ── Diagnostic: dump what we're sending to Gemini so we can see if
          // the source PDF text actually contains all expected services. If a
          // service name isn't here, the upstream PDF extractor lost it and
          // no amount of Gemini-prompt tuning will recover it.
          const txt = proposal.textContent!;
          const probes = [
            'auto full branding', 'auto semi branding', 'auto back sticker',
            'bus full branding', 'bus semi branding', 'bus shelter',
            'cab branding', 'mobile van', 'lamp post', 'flex hoarding',
            'lobby screen', 'metro branding',
          ];
          const presence = probes.map(p => `${p}=${txt.toLowerCase().includes(p) ? '✓' : '✗'}`).join(' ');
          console.log(`📄 [Registry] "${cityKey}" textContent length=${txt.length}, slice→Gemini=${Math.min(txt.length, 50000)}`);
          console.log(`📄 [Registry] "${cityKey}" probe hits: ${presence}`);

          const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();
          if (!apiKey) throw new Error('No API key');

          const { GoogleGenerativeAI } = await import('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash-lite',
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
          });

          const prompt = `You are reading an outdoor advertising rate card PDF.
Your task is to build a structured service registry. Follow these TWO STEPS exactly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — EXTRACT SERVICE NAMES FROM INNER-PAGE HEADINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The PDF has individual service detail pages. Each has a prominent heading such as:
  "BUS SEMI BRANDING"
  "APARTMENT LOBBY SCREEN BRANDING"
  "METRO BRANDING – INTERIOR"
  "LAMP POST BOARD STAR FLEX"

Rules for Step 1:
- Use ONLY these inner-page headings as service names. Do NOT use Pricing Summary table names.
- Strip page-number suffixes like "(1/3)", "(2/3)" — exclude them from the name.
- Each unique heading = one entry. If the same heading spans multiple pages, count it ONCE.
- Output the name in lowercase.
- Do NOT invent, guess, or carry over names from prior knowledge.
- Do NOT include prices, sizes (numbers), durations, city names, or page numbers in the name.
- Include ALL variants separately (e.g. "auto full branding" and "auto semi branding" are different entries).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — CROSS-REFERENCE PRICING SUMMARY FOR EACH SERVICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The PDF also contains a PRICING SUMMARY table with columns:
  # | Activity (Branding Activities) | Unit Price | Unit of Measurement | Min Quantity | Price per Campaign | Remarks

For EACH service found in Step 1:
- Find the best matching row in the Pricing Summary table by comparing key words.
- Extract: min quantity (integer), unit price (integer, rupees only, no symbols), unit of measurement (string), campaign price (integer), remarks (string), row number (#).
- If the Pricing Summary row name DIFFERS from the inner-page heading name, record the Summary name as an alias.
- If no matching Pricing Summary row exists, use min=1 and null for the rest.

CRITICAL — Min Quantity vs Campaign Duration:
- "min quantity" means the MINIMUM NUMBER OF UNITS to book (e.g. 1 van, 5 buses, 50 autos). It comes ONLY from the "Min Quantity" column in the Pricing Summary table.
- "Campaign Days" or "Campaign Duration" (e.g. 30 days) is a time period — it is NOT min quantity. NEVER use a days/duration value as the min quantity.
- If a service detail page says "Campaign Days: 30" but the Pricing Summary row shows Min Qty = 1, the correct min is 1.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — return ONLY valid JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "services": ["<inner-page heading 1 lowercase>", "<inner-page heading 2 lowercase>"],
  "quantities": {
    "<inner-page heading 1 lowercase>": {
      "min": <number>,
      "max": <number|null>,
      "unitPrice": <number|null>,
      "uom": "<unit of measurement|null>",
      "campaignPrice": <number|null>,
      "remarks": "<remarks|null>",
      "rowIndex": <summary row number|null>
    }
  },
  "aliases": {
    "<inner-page heading 1 lowercase>": ["<pricing summary name if different from heading>"],
    "<inner-page heading 2 lowercase>": []
  }
}

CRITICAL RULES:
- services[] must contain ONLY inner-page heading names (lowercase). This is the single source of truth.
- aliases{} holds the Pricing Summary row name ONLY when it differs from the inner-page heading.
- Return ONLY valid JSON — no markdown fences, no explanation, no extra text.
- Never copy the placeholder strings above. Every value must come directly from the document below.

${seededServiceNames && seededServiceNames.length > 0 ? `
SEED SERVICES (deterministic parser result):
${seededServiceNames.map((s, i) => `${i + 1}. ${s}`).join('\n')}

IMPORTANT FOR THIS RUN:
- Use the seed list above as the EXACT services[] output (lowercase).
- Do NOT add/remove/reword service names.
- Focus on extracting quantities/price metadata for these services from the pricing summary.
` : ''}

Rate card content:
${proposal.textContent.slice(0, 50000)}`;

          const startTime = performance.now();
          const result = await model.generateContent(prompt);
          const raw = result.response.text().trim();
          const processingTimeMs = performance.now() - startTime;

          // Track token usage for service extraction
          const usageMetadata = result.response.usageMetadata;
          trackTokenUsage({
            operationType: 'service_extraction',
            operationDetails: `Service registry build for ${cityKey}`,
            inputTokens: usageMetadata?.promptTokenCount || 0,
            outputTokens: usageMetadata?.candidatesTokenCount || 0,
            processingTimeMs,
            contextSize: prompt.length,
            responseSize: raw.length,
            pdfFileName: proposal.fileName
          });

          console.log(`🤖 [Registry] "${cityKey}" raw Gemini response (${raw.length} chars):\n${raw.slice(0, 2000)}${raw.length > 2000 ? '\n…(truncated)' : ''}`);
          const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          const parsed = JSON.parse(jsonStr);
          const parsedForBuild = (seededServiceNames && seededServiceNames.length > 0)
            ? { ...parsed, services: seededServiceNames }
            : parsed;

          const reg = buildRegistryFromGemini(cityKey, parsedForBuild, pdfHash);
          _registry.set(cityKey, reg);
          persistToSession();
          persistToLocal(cityKey, reg);
          // Build page index from already-loaded pageImages (synchronous, no API call)
          const idx = buildPageIndex(cityKey, reg.entries, proposal.pageImages ?? []);
          _pageIndex.set(cityKey, idx);

          const entryCount = Object.keys(reg.entries).length;
          const aliasCount = Object.values(reg.entries).reduce((n, e) => n + e.aliases.length, 0);
          console.log(`✅ [Registry] Ready for "${cityKey}": ${entryCount} entries (${aliasCount} aliases collapsed), source=${reg.source}, hash=${pdfHash}`);
          console.log(`📊 [Registry] IDF top tokens for "${cityKey}":`,
            Object.entries(reg.idf).sort((a, b) => b[1] - a[1]).slice(0, 8));
        } catch (err) {
          console.warn(`⚠️ [Registry] Build failed for "${cityKey}":`, err);
          _registry.set(cityKey, makeFailedRegistry(cityKey));
        }
      })();
    });
  }, [activeProposals]);
};

/**
 * Build a service → reference-page-numbers index from already-extracted PDF pages.
 * Only indexes pages with (N/M) marker where N >= 2 (reference pages, not spec/pricing).
 * Runs synchronously on the in-memory pageImages — no API call needed.
 *
 * Heading format in PDF: "CURRENT SERVICE (2/3) | NEXT SERVICE →"
 * We take [0] of pipe-split to get current service, then strip (N/M) to get the name.
 */
function buildPageIndex(
  cityKey: string,
  entries: Record<string, ServiceEntry>,
  pages: Array<{ pageNumber: number; text: string }>,
): Record<string, number[]> {
  const index: Record<string, number[]> = {};
  // Unicode nav arrows used in PDF navigation bars (← → ◄ ► ▲ ▼ and their variants)
  const NAV_ARROWS = /[\u2190\u2192\u2193\u2191\u25C4\u25BA\u25B2\u25BC\u00AB\u00BB]+/g;
  // (N/M) marker pattern
  const MARKER_RE = /\(\s*(\d+)\s*\/\s*(\d+)\s*\)/g;

  for (const page of pages) {
    const rawText = page.text.replace(/\s+/g, ' ').trim();
    // Use 400 chars — long enough to cover pages where nav text precedes the heading.
    const headingArea = rawText.substring(0, 400);

    // Scan headingArea for ALL (N/M) markers.
    // PDF nav bars have two layouts:
    //   Layout A: "CURRENT SERVICE (N/M) | NEXT SERVICE →"   — marker before pipe
    //   Layout B: "← PREV SERVICE | CURRENT SERVICE (N/M)"   — marker after pipe
    // Old code only handled Layout A by taking split('|')[0].
    // New code finds each marker then extracts the service name from between the
    // nearest preceding pipe (or start of string) and the marker position.
    MARKER_RE.lastIndex = 0;
    let markerMatch: RegExpExecArray | null;
    let matched = false;

    while ((markerMatch = MARKER_RE.exec(headingArea)) !== null) {
      const pageNum = parseInt(markerMatch[1]);
      if (pageNum < 2) continue; // (1/N) = spec/pricing page — skip

      // Text before the (N/M) marker, with nav arrows stripped.
      // The PDF uses | as BOTH:
      //   (a) navigation separator: "← PREV SERVICE | CURRENT SERVICE (N/M)"
      //   (b) column layout break within a service name: "BUS SEMI | BRANDING (N/M)"
      //       or even: "← PREV | CURRENT NAME PART1 | CURRENT NAME PART2 (N/M)"
      // Strategy: split on |, then try combining segments from the end backwards
      // until a registry match is found. This handles both cases:
      //   "BUS SEMI | BRANDING (2/3)" → last seg="BRANDING" no match →
      //     try "BUS SEMI BRANDING" → match ✓
      //   "← WALL POSTER | (2/3)"    → last seg="" (empty) →
      //     try "WALL POSTER" → match ✓
      const textBeforeMarker = headingArea.substring(0, markerMatch.index).replace(NAV_ARROWS, '');
      const segments = textBeforeMarker.split('|').map(s => s.trim()).filter((_s, i, arr) => {
        // Keep all segments; empty ones at the end are the "marker-right-after-pipe" case
        // and will be handled by combining with previous segment.
        void i; void arr;
        return true;
      });

      // Try combining increasing numbers of segments from the end
      for (let numSegs = 1; numSegs <= segments.length && !matched; numSegs++) {
        const combined = segments.slice(segments.length - numSegs).join(' ').trim();
        if (!combined || combined.length < 2) continue;

        // Try progressively stripping leading words to handle logo/icon text prefixes
        // e.g. "bn 30 Sqft FLEX BANNER" → strip "bn" → "30 Sqft FLEX BANNER" → match ✓
        const headingWords = combined.split(/\s+/);
        for (let start = 0; start < headingWords.length; start++) {
          const candidate = headingWords.slice(start).join(' ');
          if (candidate.length < 3) break;
          const canonical = canonicalizeServiceName(candidate);
          if (entries[canonical]) {
            if (!index[canonical]) index[canonical] = [];
            if (!index[canonical].includes(page.pageNumber)) {
              index[canonical].push(page.pageNumber);
            }
            matched = true;
            break;
          }
        }
      }
      if (matched) break; // one match per page is enough
    }

    if (!matched) {
      // Log only for pages that DID have a (N/M) marker but we couldn't match
      MARKER_RE.lastIndex = 0;
      const anyMarker = MARKER_RE.exec(headingArea);
      if (anyMarker && parseInt(anyMarker[1]) >= 2) {
        const textBefore = headingArea.substring(0, anyMarker.index).replace(NAV_ARROWS, '');
        const segments = textBefore.split('|').map(s => s.trim()).filter(Boolean);
        const debugHeading = segments[segments.length - 1] ?? '';
        console.log(`⚠️ [PageIndex] "${cityKey}" Page ${page.pageNumber}: no registry match for "${debugHeading}"`);
      }
    }
  }

  const count = Object.keys(index).length;
  console.log(`📇 [PageIndex] "${cityKey}": ${count}/${Object.keys(entries).length} services indexed from ${pages.length} pages`);
  if (count > 0) {
    console.log('📇 [PageIndex]', Object.fromEntries(Object.entries(index).map(([k, v]) => [k, `[${v.join(',')}]`])));
  }
  return index;
}

// ── Tiny constructors so we don't repeat the empty-shape boilerplate ─────────
function makeBuildingRegistry(cityKey: string): CityRegistry {
  return {
    city: cityKey, entries: {}, idf: {}, source: 'gemini',
    builtAt: Date.now(), ttlDays: DEFAULT_TTL_DAYS, pdfHash: null,
    services: [], quantities: {}, status: 'building',
  };
}
function makeFailedRegistry(cityKey: string): CityRegistry {
  return {
    city: cityKey, entries: {}, idf: {}, source: 'gemini',
    builtAt: Date.now(), ttlDays: DEFAULT_TTL_DAYS, pdfHash: null,
    services: [], quantities: {}, status: 'failed',
  };
}
