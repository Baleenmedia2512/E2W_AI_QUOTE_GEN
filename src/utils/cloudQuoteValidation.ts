import { QuoteItem } from '../types/quote';
import { canonicalizeServiceName, MEDIA_PLURAL_MAP } from './serviceNameUtils';
import {
  DbService,
  extractCityHint,
  extractMediumTypeFromDisplayName,
  extractMediumTypeFromServiceId,
  extractServiceNameFromItem,
  formatServiceDisplayName,
  resolveServiceIdFromCatalog,
  stripMediumTypeFromDisplayName,
} from './serviceResolver';
import { hasQuotablePricing, pickPreferredDbService } from './dbPricingUtils';

/** Known city keys used across the app (lowercase). DB locations may add more at runtime. */
export const CLOUD_CITY_KEYS = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tiruchirappalli',
  'erode', 'tirunelveli', 'tenkasi', 'vellore', 'thanjavur', 'tiruppur', 'hosur', 'bangalore', 'mumbai',
  'delhi', 'hyderabad', 'pune', 'kolkata', 'ahmedabad', 'surat', 'jaipur', 'lucknow',
  'kochi', 'vizag', 'visakhapatnam', 'nagpur', 'nashik', 'mysore', 'mysuru',
];

const DOC_NAME_SKIP = new Set(['rate', 'card', 'rates', 'proposal', 'btl', 'media']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Vehicle / category keywords that imply quote intent even as a single word. */
export const VEHICLE_CATEGORY_PATTERN =
  /\b(bus|buses|auto|autos|cab|cabs|tempo|tempos|metro|train|hoarding|hoardings|gantry|shelter|shelters|lamp\s*post|lift|apartment|vehicle|vehicles|newspaper|radio|billboard|transit|van|vans)\b/i;

export const FULL_SERVICE_PATTERNS = [
  /bus full branding/i,
  /bus semi branding/i,
  /bus back panel/i,
  /auto full branding/i,
  /auto semi branding/i,
  /auto back stickers/i,
  /metro interior/i,
  /cab\s+(?:full|back|interior)/i,
  /tempo\s+(?:full|back)/i,
  /apartment\s+lift/i,
  /traffic\s+(?:awareness|signal)/i,
];

function titleCaseCity(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Plural → singular map for vehicle/category keywords only. */
const PLURAL_NORMALIZE_MAP: Record<string, string> = { ...MEDIA_PLURAL_MAP };

/** Extract meaningful query words (supports single-word queries like "bus"). */
export function extractQueryWords(query: string): string[] {
  return query
    .replace(/\d+/g, '')
    .replace(/\b(need|for|the|a|an|in|at|of|and|i|want|please|generate|quote|services?|ads?|advertising|outdoor|some|any)\b/gi, '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => PLURAL_NORMALIZE_MAP[w] ?? w);
}

/** True when the user typed a category (e.g. "bus") rather than a full service name. */
export function isVagueCategoryQuery(query: string): boolean {
  if (FULL_SERVICE_PATTERNS.some((p) => p.test(query))) return false;
  const words = extractQueryWords(query);
  if (words.length === 0) return false;
  if (VEHICLE_CATEGORY_PATTERN.test(query) && words.length <= 3) return true;
  return words.length <= 2 && !/\b(full|semi|back|interior|panel|stickers?|insertion)\b/i.test(query);
}

/** Normalize a raw location string to a display city label. */
export function normalizeCityLabel(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 3 || /\d{4,}/.test(trimmed)) return null;
  if (!/^[a-zA-Z][a-zA-Z\s.-]*$/.test(trimmed)) return null;
  return trimmed
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Extract a city slug from a DB service row (locations, service_id, or document_name). */
export function extractCityFromDbService(svc: DbService): string | null {
  const locs: string[] = svc.metadata?.locations || [];
  for (const loc of locs) {
    const lower = loc.toLowerCase();
    const key = CLOUD_CITY_KEYS.find((c) => lower.includes(c));
    if (key) return titleCaseCity(key);
    const direct = normalizeCityLabel(loc);
    if (direct) return direct;
  }

  // metadata.city (vendor_rate_chunks)
  const metaCity = (svc.metadata as { city?: string } | undefined)?.city;
  if (metaCity) {
    const lower = String(metaCity).toLowerCase();
    const key = CLOUD_CITY_KEYS.find((c) => lower.includes(c));
    if (key) return titleCaseCity(key);
  }

  // Trailing city on service_id / medium id: bus-shelter-single-panel-non-lit-chennai
  const sid = (svc.service_id || '').toLowerCase();
  if (sid) {
    const cities = [...CLOUD_CITY_KEYS].sort((a, b) => b.length - a.length);
    for (const city of cities) {
      if (sid.endsWith(`-${city}`) || sid.includes(`-${city}-`)) {
        return titleCaseCity(city);
      }
    }
  }

  const docName = (svc.document_name || '').toLowerCase();
  for (const key of CLOUD_CITY_KEYS) {
    if (docName.includes(key)) return titleCaseCity(key);
  }
  const docBase = (svc.document_name || '').replace(/\.(pdf|xlsx?|jpeg|jpg|png)$/i, '');
  for (const part of docBase.split(/[_\-\s]+/)) {
    if (part.length < 3 || DOC_NAME_SKIP.has(part.toLowerCase())) continue;
    if (/^[a-zA-Z]+$/.test(part)) {
      const label = titleCaseCity(part.toLowerCase());
      if (CLOUD_CITY_KEYS.includes(part.toLowerCase()) || part.length >= 4) return label;
    }
  }
  return null;
}

/** Collect distinct city labels from DB service rows. */
export function collectCitiesFromDbServices(services: DbService[]): string[] {
  const citySet = new Set<string>();
  for (const svc of services) {
    for (const loc of svc.metadata?.locations || []) {
      const label = normalizeCityLabel(loc) || extractCityFromDbService({ ...svc, metadata: { locations: [loc] } });
      if (label) citySet.add(label);
    }
    const fromRow = extractCityFromDbService(svc);
    if (fromRow) citySet.add(fromRow);
  }
  return [...citySet];
}

/** Merge city lists case-insensitively, preserving first-seen display casing. */
export function mergeCityLists(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const c of list) {
      const trimmed = c.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Detect first matching city from a list (longest match first). */
export function detectCityInTextList(text: string, cities: string[]): string | null {
  if (!text || cities.length === 0) return null;
  const sorted = [...cities].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  return sorted.find((c) => new RegExp(`\\b${escapeRegExp(c)}\\b`, 'i').test(lower)) || null;
}

/** City-only query: returns lowercase city keys when text is only city names + filler. */
export function detectCityOnlyInList(text: string, cityListLower: string[]): string[] {
  if (cityListLower.length === 0) return [];
  if (/\d/.test(text)) return [];

  // If the user mentioned a service/medium, this is not a city-only list query
  if (
    /\b(bus|auto|van|cab|taxi|hoarding|booth|shelter|gantry|pole|branding|display|printing|mounting|qty|quantity|units?)\b/i.test(
      text,
    )
  ) {
    return [];
  }

  const cleaned = text
    .toLowerCase()
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\b(show|me|all|list|services?|in|for|of|the|a|an|please|what|whats|which|available|need|want|i|about|tell|give|and|&)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  // Longest city names first so "tiruchirappalli" wins over shorter overlaps
  const sortedCities = [...cityListLower].sort((a, b) => b.length - a.length);
  const cities: string[] = [];
  let rest = ` ${cleaned} `;
  for (const c of sortedCities) {
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(rest)) {
      if (!cities.includes(c)) cities.push(c);
      rest = rest.replace(re, ' ');
    }
  }

  // Leftover tokens (typos like "rotn") are ignored when at least one city matched
  // and nothing service-like remains
  rest = rest.replace(/\s+/g, ' ').trim();
  if (cities.length === 0) return [];
  return cities;
}

function citiesMatch(svcCity: string, selectedCity: string): boolean {
  const a = svcCity.toLowerCase();
  const b = selectedCity.toLowerCase();
  return a.includes(b) || b.includes(a);
}

/** Medium-type tokens that should filter matches, not require literal name inclusion. */
const QUERY_MEDIUM_TOKENS = new Set([
  'elevated',
  'underground',
  'interior',
  'inside',
  'outside',
  'wrap',
  'platform',
]);

/** Optional filler words that often appear in prompts but not catalog titles. */
const QUERY_FILLER_WORDS = new Set([
  'branding',
  'ads',
  'advertising',
  'service',
  'services',
  'campaign',
]);

/** Spelling variants so catalog typos still match user wording. */
const WORD_VARIANTS: Record<string, string[]> = {
  awareness: ['awareness', 'awarness'],
  awarness: ['awarness', 'awareness'],
  apartment: ['apartment', 'appartment'],
  appartment: ['appartment', 'apartment'],
  apartments: ['apartments', 'appartments', 'apartment', 'appartment'],
  appartments: ['appartments', 'apartments', 'appartment', 'apartment'],
};

function expandQueryWord(word: string): string[] {
  const w = word.toLowerCase();
  const variants = new Set<string>([w, canonicalizeServiceName(w)]);
  for (const v of WORD_VARIANTS[w] || []) variants.add(v);
  return [...variants].filter(Boolean);
}

function haystackHasWord(haystacks: string[], word: string): boolean {
  return expandQueryWord(word).some((v) =>
    haystacks.some((h) => {
      if (!v) return false;
      if (h.includes(v)) return true;
      if (v.length >= 4 && new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(h)) {
        return true;
      }
      return false;
    }),
  );
}

/** Pull elevated/underground (etc.) from free text for medium filtering. */
export function extractMediumHintFromQuery(text: string): string | null {
  const lower = text.toLowerCase();
  for (const token of QUERY_MEDIUM_TOKENS) {
    if (new RegExp(`\\b${token}\\b`, 'i').test(lower)) {
      return token.charAt(0).toUpperCase() + token.slice(1);
    }
  }
  return null;
}

export function serviceMatchesQuery(svc: DbService, words: string[]): boolean {
  if (words.length === 0) return false;
  const name = (svc.service_name || '').toLowerCase();
  const sid = (svc.service_id || '').toLowerCase();
  const sidSpaced = sid.replace(/-/g, ' ');
  const display = formatServiceDisplayName(svc).toLowerCase();
  const canonical = canonicalizeServiceName(svc.service_name || '');
  const displayCanon = canonicalizeServiceName(formatServiceDisplayName(svc));
  const queryCanonical = canonicalizeServiceName(words.join(' '));
  const haystacks = [name, sid, sidSpaced, display, canonical, displayCanon];

  if (words.length === 1) {
    const w = words[0];
    if (haystackHasWord(haystacks, w)) return true;
    if (canonical && queryCanonical && (canonical.includes(queryCanonical) || queryCanonical.includes(canonical))) {
      return true;
    }
    return false;
  }

  if (canonical && queryCanonical && (canonical.includes(queryCanonical) || queryCanonical.includes(canonical))) {
    return true;
  }
  if (displayCanon && queryCanonical && (displayCanon.includes(queryCanonical) || queryCanonical.includes(displayCanon))) {
    return true;
  }
  // Every content word must appear in name, id, or display (with spelling variants)
  return words.every((w) => haystackHasWord(haystacks, w));
}

function filterServicesByMediumHint(services: DbService[], mediumHint: string | null): DbService[] {
  if (!mediumHint || services.length === 0) return services;
  const hintCanon = canonicalizeServiceName(mediumHint);
  const filtered = services.filter((svc) => {
    const medium =
      extractMediumTypeFromServiceId(svc.service_id, svc.service_name) ||
      extractMediumTypeFromDisplayName(formatServiceDisplayName(svc));
    if (!medium) return false;
    return canonicalizeServiceName(medium) === hintCanon
      || canonicalizeServiceName(medium).includes(hintCanon)
      || hintCanon.includes(canonicalizeServiceName(medium));
  });
  return filtered.length > 0 ? filtered : services;
}

/**
 * Deduplicate DB rows for the service picker.
 * - Same city + same product name → one row (fixes Bus Shelter duplicate ids)
 * - Same name but different medium type in service_id (elevated/underground) → keep both
 */
export function dedupeDbServices(services: DbService[]): DbService[] {
  const byKey = new Map<string, DbService>();
  for (const svc of services) {
    const city = (extractCityFromDbService(svc) || '').toLowerCase();
    const nameKey = canonicalizeServiceName(svc.service_name || '');
    const metaType = String(
      (svc.metadata as { medium_type?: string } | undefined)?.medium_type || '',
    ).trim();
    const medium =
      extractMediumTypeFromServiceId(svc.service_id, svc.service_name) ||
      (metaType && metaType.toUpperCase() !== 'NA' ? metaType : null);
    const mediumKey =
      medium && !nameKey.includes(canonicalizeServiceName(medium))
        ? canonicalizeServiceName(medium)
        : '';
    const key = `${city}|${nameKey}|${mediumKey}` || (svc.service_id || '').toLowerCase();

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, svc);
      continue;
    }
    // Prefer exact service_id that matches a clean product slug, then better pricing
    const preferred = pickPreferredDbService([existing, svc]);
    if (preferred) byKey.set(key, preferred);
  }
  return [...byKey.values()];
}

/** Strip detected city names from segment text before service matching. */
export function stripCitiesFromSegment(segmentRaw: string, cities: string[]): string {
  let out = segmentRaw;
  for (const city of [...cities].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(city)}\\b`, 'gi'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Find distinct cities in DB that carry the service described by the user query.
 */
export function getCitiesForServiceQuery(query: string, services: DbService[]): string[] {
  const allCities = collectCitiesFromDbServices(services);
  const detected = detectCityInTextList(query, allCities);
  const queryBody = detected ? stripCitiesFromSegment(query, allCities) : query;
  const words = extractQueryWords(queryBody);
  if (words.length === 0 || services.length === 0) return [];

  const matched = services.filter(
    (svc) => serviceMatchesQuery(svc, words) && hasQuotablePricing(svc),
  );
  if (matched.length === 0) return [];

  const citySet = new Set<string>();
  for (const svc of matched) {
    const city = extractCityFromDbService(svc);
    if (city) citySet.add(city);
  }
  return [...citySet];
}

/** Per-segment variant — uses only that clause's service words. */
export function getCitiesForSegmentQuery(segmentRaw: string, services: DbService[]): string[] {
  return getCitiesForServiceQuery(segmentRaw, services);
}

export interface CloudSegmentPlan {
  raw: string;
  cityNeeded: boolean;
  detectedCity: string | null;
  matchedCities?: string[];
}

/** True when the message has multiple clauses joined by "and" or ",". */
export function isMultiSegmentQuoteRequest(text: string): boolean {
  return /,|\band\b/i.test(text.trim());
}

/** Cities for parsing user-typed city names (catalog + known keys). */
export function getCityDetectionList(dbServices: DbService[]): string[] {
  const fromDb = collectCitiesFromDbServices(dbServices);
  const known = CLOUD_CITY_KEYS.map(titleCaseCity);
  return mergeCityLists(fromDb, known);
}

/** Auto-assign city when a segment's service exists in exactly one DB city. */
export function buildCloudSegmentCityPlan(
  segments: CloudSegmentPlan[],
  dbServices: DbService[],
  forcePickerForSingleCityless: boolean,
): CloudSegmentPlan[] {
  const knownCityLabels = CLOUD_CITY_KEYS.map(titleCaseCity);

  return segments.map((seg) => {
    if (!seg.cityNeeded || seg.detectedCity) return seg;

    const typedCity = detectCityInTextList(seg.raw, knownCityLabels);
    if (typedCity) {
      return {
        ...seg,
        cityNeeded: false,
        detectedCity: typedCity,
        matchedCities: getCitiesForSegmentQuery(seg.raw, dbServices),
      };
    }

    const matchedCities = getCitiesForSegmentQuery(seg.raw, dbServices);
    if (matchedCities.length === 1 && !forcePickerForSingleCityless) {
      return {
        ...seg,
        cityNeeded: false,
        detectedCity: matchedCities[0],
        matchedCities,
      };
    }
    return { ...seg, matchedCities };
  });
}

export type SegmentDbState = 'not_found' | 'specific' | 'vague';

/** Toggle multi-service drop debugging (filter console by `[MultiSvcDebug]`). */
export const MULTI_SVC_DEBUG = true;

function multiSvcLog(...args: unknown[]): void {
  if (!MULTI_SVC_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log('[MultiSvcDebug]', ...args);
}

/** Classify one segment against DB for a known city. */
export function classifySegmentByDb(
  segmentRaw: string,
  city: string,
  services: DbService[],
): { state: SegmentDbState; matches: DbService[]; reason?: string } {
  const matched = getMatchingServicesForCity(segmentRaw, city, services);
  if (matched.length === 0) {
    const words = extractQueryWords(stripCitiesFromSegment(segmentRaw, [city]));
    multiSvcLog('classify → not_found', {
      segmentRaw,
      city,
      words,
      reason: 'no_db_matches',
    });
    return { state: 'not_found', matches: [], reason: 'no_db_matches' };
  }

  const words = extractQueryWords(stripCitiesFromSegment(segmentRaw, [city]));
  const contentWords = words.filter(
    (w) => !QUERY_MEDIUM_TOKENS.has(w.toLowerCase()) && !QUERY_FILLER_WORDS.has(w.toLowerCase()),
  );
  const queryCanon = canonicalizeServiceName(
    (contentWords.length > 0 ? contentWords : words).join(' '),
  );
  const exactMatches = matched.filter((s) => {
    const nameCanon = canonicalizeServiceName(s.service_name || '');
    const displayCanon = canonicalizeServiceName(
      stripMediumTypeFromDisplayName(formatServiceDisplayName(s)),
    );
    const fullDisplayCanon = canonicalizeServiceName(formatServiceDisplayName(s));
    return (
      nameCanon === queryCanon
      || displayCanon === queryCanon
      || fullDisplayCanon === queryCanon
    );
  });

  const matchSummary = matched.slice(0, 8).map((s) => ({
    name: s.service_name,
    display: formatServiceDisplayName(s),
    id: s.service_id,
    medium: extractMediumTypeFromServiceId(s.service_id, s.service_name),
  }));

  // Exact catalog / display name → specific (unless multiple medium types)
  if (exactMatches.length === 1) {
    multiSvcLog('classify → specific', {
      segmentRaw,
      city,
      words,
      queryCanon,
      reason: 'exact_single',
      pick: exactMatches[0].service_name,
      matchedCount: matched.length,
    });
    return { state: 'specific', matches: exactMatches, reason: 'exact_single' };
  }
  if (exactMatches.length > 1) {
    const mediums = new Set(
      exactMatches
        .map((s) => extractMediumTypeFromServiceId(s.service_id, s.service_name))
        .filter(Boolean),
    );
    if (mediums.size > 1) {
      multiSvcLog('classify → vague', {
        segmentRaw,
        city,
        words,
        queryCanon,
        reason: 'exact_name_multiple_mediums',
        mediums: [...mediums],
        matches: matchSummary,
      });
      return { state: 'vague', matches: exactMatches, reason: 'exact_name_multiple_mediums' };
    }
    multiSvcLog('classify → specific', {
      segmentRaw,
      city,
      words,
      queryCanon,
      reason: 'exact_multi_same_medium',
      pick: exactMatches[0].service_name,
    });
    return { state: 'specific', matches: [exactMatches[0]], reason: 'exact_multi_same_medium' };
  }

  // Single fuzzy match overall → specific
  if (matched.length === 1) {
    multiSvcLog('classify → specific', {
      segmentRaw,
      city,
      words,
      queryCanon,
      reason: 'fuzzy_single',
      pick: matched[0].service_name,
    });
    return { state: 'specific', matches: matched, reason: 'fuzzy_single' };
  }

  // Medium already narrowed in getMatchingServicesForCity — if still multiple
  // mediums without a hint, keep vague; otherwise prefer a single preferred row
  // for intentional multi-word prompts (e.g. "bus shelter", "pamphlet").
  const mediumHint = extractMediumHintFromQuery(segmentRaw);
  if (!mediumHint && contentWords.length >= 2) {
    const preferred = pickPreferredDbService(matched);
    if (preferred) {
      multiSvcLog('classify → specific', {
        segmentRaw,
        city,
        words,
        queryCanon,
        reason: 'fuzzy_preferred_multiword',
        pick: preferred.service_name,
        matchedCount: matched.length,
        matches: matchSummary,
      });
      return {
        state: 'specific',
        matches: [preferred],
        reason: 'fuzzy_preferred_multiword',
      };
    }
  }

  // Legacy whitelist: near-full names that still fuzzy-match multiple rows
  if (FULL_SERVICE_PATTERNS.some((p) => p.test(segmentRaw))) {
    const best = pickPreferredDbService(matched);
    multiSvcLog('classify → specific', {
      segmentRaw,
      city,
      words,
      queryCanon,
      reason: 'full_service_pattern_whitelist',
      pick: best?.service_name || matched[0]?.service_name,
      matchedCount: matched.length,
      matches: matchSummary,
    });
    return {
      state: 'specific',
      matches: best ? [best] : matched.slice(0, 1),
      reason: 'full_service_pattern_whitelist',
    };
  }

  multiSvcLog('classify → vague', {
    segmentRaw,
    city,
    words,
    queryCanon,
    reason: 'multiple_fuzzy_no_exact',
    exactMatchCount: exactMatches.length,
    matchedCount: matched.length,
    matches: matchSummary,
  });
  return { state: 'vague', matches: matched, reason: 'multiple_fuzzy_no_exact' };
}

/** True when every comma/and part contains a known city name. */
export function isMultiCityFullySpecified(message: string, cities: string[]): boolean {
  const parts = message
    .toLowerCase()
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length <= 1) return false;
  const cityLower = cities.map((c) => c.toLowerCase());
  return parts.every((part) => cityLower.some((c) => part.includes(c)));
}

/** Build clickable service catalogue for one city from DB rows. */
export function buildCityServiceListFromDb(
  cityKey: string,
  services: DbService[],
): { city: string; services: Array<{ name: string; minQty: number }> } | null {
  const matched = dedupeDbServices(
    services
      .filter((svc) => {
        const svcCity = extractCityFromDbService(svc);
        return svcCity != null && citiesMatch(svcCity, cityKey);
      })
      .filter(hasQuotablePricing),
  );
  if (matched.length === 0) return null;

  const cityLabel = cityKey.charAt(0).toUpperCase() + cityKey.slice(1);
  return {
    city: cityLabel,
    services: matched.map((svc) => ({
      name: formatServiceDisplayName(svc),
      serviceId: svc.service_id,
      minQty: getMinQuantityFromDbService(svc) ?? 1,
    })),
  };
}

export interface CloudSegmentRow {
  raw: string;
  city: string;
  qty: number;
}

export interface CloudPreGeminiResult {
  preAlerts: Array<{ city: string; service: string }>;
  validSegmentRaws: string[];
  validSegmentLabels: string[];
  vagueGroups: Array<{
    vehicleType: string;
    requestedQuantity: number;
    services: Array<{ name: string; category: string }>;
  }>;
  belowMinSegments: Array<{
    rawSegment: string;
    requestedQty: number;
    minQty: number;
    svcLabel: string;
    cityLabel: string;
  }>;
}

/** DB-backed pre-Gemini validation for resolved multi-segment requests. */
export function runCloudPreGeminiValidation(
  rows: CloudSegmentRow[],
  services: DbService[],
): CloudPreGeminiResult {
  const preAlerts: Array<{ city: string; service: string }> = [];
  const validSegmentRaws: string[] = [];
  const validSegmentLabels: string[] = [];
  const vagueGroups: CloudPreGeminiResult['vagueGroups'] = [];
  const belowMinSegments: CloudPreGeminiResult['belowMinSegments'] = [];

  const titleCaseSvc = (s: string) =>
    s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  multiSvcLog('── preGemini START ──', {
    inputRowCount: rows.length,
    dbServiceCount: services.length,
    rows: rows.map((r) => ({ qty: r.qty, city: r.city, raw: r.raw })),
  });

  const perRowDebug: Array<{
    raw: string;
    qty: number;
    city: string;
    state: string;
    reason?: string;
    outcome: string;
    matchNames?: string[];
  }> = [];

  for (const row of rows) {
    const cityLabel = row.city.charAt(0).toUpperCase() + row.city.slice(1);
    const cls = classifySegmentByDb(row.raw, row.city, services);

    if (cls.state === 'not_found') {
      const svcLabel =
        stripCitiesFromSegment(row.raw, [row.city])
          .replace(/\d+/g, '')
          .replace(/\b(need|for|the|a|an|in|at|of)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ') || row.raw.trim();
      preAlerts.push({ city: cityLabel, service: svcLabel });
      perRowDebug.push({
        raw: row.raw,
        qty: row.qty,
        city: row.city,
        state: 'not_found',
        reason: cls.reason,
        outcome: `DROPPED → preAlert "${svcLabel}"`,
      });
      continue;
    }

    if (cls.state === 'vague') {
      const group = buildGroupedServicesFromDb(row.raw, row.city, row.qty, services);
      if (group) vagueGroups.push(group);
      perRowDebug.push({
        raw: row.raw,
        qty: row.qty,
        city: row.city,
        state: 'vague',
        reason: cls.reason,
        outcome: group
          ? `CHECKBOX group "${group.vehicleType}" (${group.services.length} options)`
          : 'DROPPED → vague but buildGroupedServicesFromDb returned null',
        matchNames: (group?.services || cls.matches.slice(0, 8)).map((s: any) =>
          typeof s.name === 'string' ? s.name : s.service_name,
        ),
      });
      continue;
    }

    const svc = cls.matches[0];
    const svcName = formatServiceDisplayName(svc) || titleCaseSvc(svc.service_name || '');
    const minimum = getMinQuantityFromDbService(svc);
    let outcome = `KEEP specific → "${svcName}"`;
    if (minimum != null && row.qty < minimum) {
      belowMinSegments.push({
        rawSegment: row.raw,
        requestedQty: row.qty,
        minQty: minimum,
        svcLabel: svcName,
        cityLabel,
      });
      outcome += ` (BELOW MIN ${row.qty} < ${minimum})`;
    }
    validSegmentRaws.push(`${row.qty} ${svcName} ${cityLabel}`);
    validSegmentLabels.push(`${row.qty} ${svcName} (${cityLabel})`);
    perRowDebug.push({
      raw: row.raw,
      qty: row.qty,
      city: row.city,
      state: 'specific',
      reason: cls.reason,
      outcome,
      matchNames: [svcName],
    });
  }

  const result: CloudPreGeminiResult = {
    preAlerts,
    validSegmentRaws,
    validSegmentLabels,
    vagueGroups: mergeGroupedServicesByCategory(vagueGroups),
    belowMinSegments,
  };

  multiSvcLog('── preGemini SUMMARY ──', {
    input: rows.length,
    specificKept: result.validSegmentLabels.length,
    vagueGroups: result.vagueGroups.length,
    vagueServiceOptions: result.vagueGroups.reduce((n, g) => n + g.services.length, 0),
    notFoundAlerts: result.preAlerts.length,
    belowMin: result.belowMinSegments.length,
    droppedOrDeferred: rows.length - result.validSegmentLabels.length,
  });
  multiSvcLog('── preGemini PER-ROW ──');
  console.table?.(perRowDebug);
  multiSvcLog('specific labels:', result.validSegmentLabels);
  multiSvcLog(
    'vague groups:',
    result.vagueGroups.map((g) => ({
      group: g.vehicleType,
      qty: g.requestedQuantity,
      services: g.services.map((s) => s.name),
    })),
  );
  multiSvcLog('not_found alerts:', result.preAlerts);
  multiSvcLog(
    'belowMin:',
    result.belowMinSegments.map((b) => `${b.svcLabel} req=${b.requestedQty} min=${b.minQty}`),
  );

  return result;
}

/** All DB services matching query scoped to one city. */
export function getMatchingServicesForCity(
  query: string,
  city: string,
  services: DbService[],
): DbService[] {
  const allCities = collectCitiesFromDbServices(services);
  const queryBody = stripCitiesFromSegment(query, allCities.length ? allCities : [city]);
  const mediumHint = extractMediumHintFromQuery(queryBody);
  const allWords = extractQueryWords(queryBody);
  if (allWords.length === 0 || !city) return [];

  // Medium tokens are applied as a filter — do not require them in the title.
  const wordsWithoutMedium = allWords.filter((w) => !QUERY_MEDIUM_TOKENS.has(w.toLowerCase()));
  const primaryWords =
    wordsWithoutMedium.length > 0 ? wordsWithoutMedium : allWords;

  const matchWithWords = (words: string[]) =>
    dedupeDbServices(
      services
        .filter((svc) => {
          if (!serviceMatchesQuery(svc, words)) return false;
          const svcCity = extractCityFromDbService(svc);
          return svcCity != null && citiesMatch(svcCity, city);
        })
        .filter(hasQuotablePricing),
    );

  let matched = matchWithWords(primaryWords);

  // Retry without filler ("branding") so "Metro Station Branding Elevated"
  // can match catalog "Metro Station" + elevated service_id.
  if (matched.length === 0) {
    const withoutFiller = primaryWords.filter(
      (w) => !QUERY_FILLER_WORDS.has(w.toLowerCase()),
    );
    if (withoutFiller.length > 0 && withoutFiller.length < primaryWords.length) {
      matched = matchWithWords(withoutFiller);
      if (MULTI_SVC_DEBUG && matched.length > 0) {
        multiSvcLog('getMatchingServicesForCity: matched after dropping filler words', {
          query,
          city,
          primaryWords,
          withoutFiller,
          matchCount: matched.length,
        });
      }
    }
  }

  matched = filterServicesByMediumHint(matched, mediumHint);

  if (MULTI_SVC_DEBUG && mediumHint) {
    multiSvcLog('getMatchingServicesForCity: medium filter', {
      query,
      city,
      mediumHint,
      matchCount: matched.length,
      matches: matched.slice(0, 5).map((s) => ({
        name: s.service_name,
        id: s.service_id,
        medium: extractMediumTypeFromServiceId(s.service_id, s.service_name),
      })),
    });
  }

  return matched;
}

/** Build checkbox service entries from DB rows for one city. */
export function buildGroupedServicesFromDb(
  query: string,
  city: string,
  qty: number,
  services: DbService[],
): {
  vehicleType: string;
  requestedQuantity: number;
  services: Array<{ name: string; category: string; serviceId?: string; requestedQuantity?: number }>;
} | null {
  const matched = getMatchingServicesForCity(query, city, services);
  if (matched.length === 0) return null;

  const preferred = pickPreferredDbService(matched);
  const ordered = preferred
    ? [preferred, ...matched.filter((s) => s.service_id !== preferred.service_id)]
    : matched;

  const words = extractQueryWords(query);
  const baseWord = words[0] || 'Service';
  const groupLabel = baseWord.charAt(0).toUpperCase() + baseWord.slice(1);
  const cityLabel = city.charAt(0).toUpperCase() + city.slice(1);

  return {
    vehicleType: `${groupLabel}|${cityLabel}`,
    requestedQuantity: qty,
    services: ordered.map((svc) => ({
      name: formatServiceDisplayName(svc),
      serviceId: svc.service_id,
      category: groupLabel,
      requestedQuantity: qty,
    })),
  };
}

/**
 * Normalize "Bus Semi|Chennai" / "Bus Shelter|Chennai" → "Bus|Chennai"
 * so same category+city shares one checkbox group.
 */
export function normalizeGroupedServiceKey(vehicleType: string): string {
  const [vehiclePart, cityPart] = vehicleType.includes('|')
    ? vehicleType.split('|')
    : [vehicleType, ''];
  const category = (vehiclePart.trim().split(/\s+/)[0] || vehiclePart).trim();
  const catLabel = category
    ? category.charAt(0).toUpperCase() + category.slice(1)
    : 'Service';
  const cityLabel = (cityPart || '').trim();
  return cityLabel ? `${catLabel}|${cityLabel}` : catLabel;
}

/**
 * Merge multi-match groups that share the same category+city.
 * Preserves per-service requestedQuantity from each segment.
 */
export function mergeGroupedServicesByCategory<
  T extends {
    vehicleType: string;
    requestedQuantity?: number;
    services: Array<{ name: string; category: string; serviceId?: string; requestedQuantity?: number }>;
  },
>(groups: T[]): T[] {
  if (!groups.length) return groups;
  const map = new Map<string, T>();

  for (const g of groups) {
    const key = normalizeGroupedServiceKey(g.vehicleType);
    const category = key.split('|')[0];
    const servicesWithQty = g.services.map((s) => ({
      ...s,
      category,
      requestedQuantity: s.requestedQuantity ?? g.requestedQuantity,
    }));

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...g,
        vehicleType: key,
        services: servicesWithQty,
      });
      continue;
    }

    for (const s of servicesWithQty) {
      const idx = existing.services.findIndex((e) => {
        if (s.serviceId && e.serviceId) {
          return e.serviceId === s.serviceId;
        }
        return e.name.toLowerCase() === s.name.toLowerCase();
      });
      if (idx === -1) {
        existing.services.push(s);
      } else {
        const prev = existing.services[idx];
        existing.services[idx] = {
          ...prev,
          ...s,
          requestedQuantity: s.requestedQuantity ?? prev.requestedQuantity,
        };
      }
    }
  }

  return Array.from(map.values());
}

/** Read minimum order quantity from vendor top-level metadata only (never pricing.min_qty). */
export function getMinQuantityFromDbService(svc: DbService | null | undefined): number | null {
  if (!svc) return null;
  const m = svc.metadata || {};
  const raw =
    (m as { min_qty?: number | string }).min_qty ??
    (m as { min_quantity?: number | string }).min_quantity;
  if (raw == null || (typeof raw === 'string' && (raw === '' || raw.toUpperCase() === 'NA'))) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? n : null;
}

export interface MinQtyViolation {
  description: string;
  requested: number;
  originalRequested: number;
  minimum: number;
}

export interface ConfirmationRow {
  service: string;
  qty: number | string;
  city: string;
  /** Optional — when set, quote build uses this exact catalog row */
  serviceId?: string;
}

/** Min-qty check for confirm-table rows BEFORE sending to Gemini. */
export function dedupeConfirmationRows(rows: ConfirmationRow[]): ConfirmationRow[] {
  const seen = new Set<string>();
  const out: ConfirmationRow[] = [];
  for (const row of rows) {
    const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const svcKey = (row.serviceId || '').trim().toLowerCase()
      || canonicalizeServiceName(row.service)
      || row.service.toLowerCase().trim();
    const cityKey = (row.city && row.city !== '—' ? row.city : '').toLowerCase().trim();
    const key = `${svcKey}|${cityKey}|${qty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, qty });
  }
  return out.sort((a, b) => {
    const byService = a.service.localeCompare(b.service, undefined, { sensitivity: 'base' });
    if (byService !== 0) return byService;
    const byCity = a.city.localeCompare(b.city, undefined, { sensitivity: 'base' });
    if (byCity !== 0) return byCity;
    const qtyA = typeof a.qty === 'number' ? a.qty : parseInt(String(a.qty), 10) || 0;
    const qtyB = typeof b.qty === 'number' ? b.qty : parseInt(String(b.qty), 10) || 0;
    return qtyA - qtyB;
  });
}

export function validateConfirmationRowsMinQty(
  rows: ConfirmationRow[],
  services: DbService[],
): MinQtyViolation[] {
  if (!rows.length || !services.length) return [];

  const violations: MinQtyViolation[] = [];
  for (const row of rows) {
    const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const cityHint = row.city && row.city !== '—' ? row.city.toLowerCase() : undefined;

    let svc: DbService | undefined;
    if (row.serviceId) {
      svc = services.find((s) => s.service_id === row.serviceId);
    }
    if (!svc) {
      const resolved = resolveServiceIdFromCatalog(row.service, services, cityHint);
      if (resolved) {
        svc = services.find((s) => s.service_id === resolved.serviceId);
      }
    }
    if (!svc) continue;

    const minimum = getMinQuantityFromDbService(svc);
    if (minimum == null || qty >= minimum) continue;

    violations.push({
      description: `${row.service} - ${row.city}`,
      requested: qty,
      originalRequested: qty,
      minimum,
    });
  }
  return violations;
}

/**
 * Compare generated quote line items against DB min_quantity (cloud source of truth).
 * One warning row per service section (not every duplicated line item).
 */
export function validateQuoteItemsAgainstDbMinQty(
  items: QuoteItem[],
  services: DbService[],
): MinQtyViolation[] {
  if (!items.length || !services.length) return [];

  const violations: MinQtyViolation[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const cityHint = extractCityHint(item.description);
    const lookupName = extractServiceNameFromItem(item);
    const sectionKey = (item.serviceId || canonicalizeServiceName(lookupName) || lookupName).toLowerCase();
    if (seen.has(sectionKey)) continue;

    let svc: DbService | null = null;
    if (item.serviceId) {
      svc = services.find((s) => s.service_id === item.serviceId) || null;
    }
    if (!svc) {
      const resolved = resolveServiceIdFromCatalog(lookupName, services, cityHint);
      if (resolved) {
        svc = services.find((s) => s.service_id === resolved.serviceId) || null;
      }
    }
    if (!svc) continue;

    const minimum = getMinQuantityFromDbService(svc);
    if (minimum == null) continue;

    if (item.quantity < minimum) {
      seen.add(sectionKey);
      violations.push({
        description: item.description,
        requested: item.quantity,
        originalRequested: item.quantity,
        minimum,
      });
    }
  }

  return violations;
}
