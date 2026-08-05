/**
 * Progressive quote chat — DB-backed matching with short friendly replies.
 * AI (optional) only helps parse intent; prices/services always come from DB.
 */

import {
  CLOUD_CITY_KEYS,
  ConfirmationRow,
  extractCityFromDbService,
  extractQueryWords,
  getMinQuantityFromDbService,
  serviceMatchesQuery,
} from './cloudQuoteValidation';
import { canonicalizeServiceName, KNOWN_CITY_LIST } from './serviceNameUtils';
import type { DbService } from './serviceResolver';
import {
  extractMediumTypeFromDisplayName,
  extractMediumTypeFromServiceId,
  formatServiceDisplayName,
} from './serviceResolver';
import { resolveMediaAgainstCatalog } from '../services/chatIntentAiService';

const REAL_CITY_KEYS = [...new Set([...CLOUD_CITY_KEYS, ...KNOWN_CITY_LIST])]
  .map((c) => c.toLowerCase())
  .sort((a, b) => b.length - a.length);

export type ProgressiveStep =
  | 'related_services'
  | 'did_you_mean'
  | 'pick_city'
  | 'pick_area'
  | 'pick_type'
  | 'pick_direction'
  | 'no_match'
  | 'min_qty_confirm'
  | 'quote_ready'
  | 'small_talk';

export interface ProgressiveOption {
  id: string;
  label: string;
  serviceId?: string;
  city?: string;
  medium?: string;
  /** DB medium_type discriminator (elevated / underground / …). */
  mediumType?: string;
  /** Group header label for grouped checklist (batch multi-select). */
  group?: string;
}

export interface BatchSegment {
  raw: string;
  token: string;
  qty: number | null;
  city: string | null;
}

export interface ProgressiveSession {
  originalText: string;
  medium?: string;
  /** Selected DB medium_type (elevated / underground) after type chip. */
  mediumType?: string;
  /** Browse token from user text (bus, shelter, led) — broader than one medium key. */
  browseToken?: string;
  city?: string;
  area?: string;
  qty: number | null;
  durationText?: string | null;
  candidateServiceIds?: string[];
  bestGuessServiceId?: string;
  bestGuessLabel?: string;
  pendingRows?: ConfirmationRow[];
  /** Remaining media types for multi-service (legacy sequential — prefer segments batch). */
  pendingMedia?: string[];
  collectedRows?: ConfirmationRow[];
  collectedServiceIds?: string[];
  aiReply?: string | null;
  /** Multi-service batch: parsed qty+token segments from one message. */
  segments?: BatchSegment[];
  /** Per service_id quantity from segment parsing. */
  qtyByServiceId?: Record<string, number>;
}

export interface ProgressiveTurnResult {
  step: ProgressiveStep;
  botText: string;
  options: ProgressiveOption[];
  allowMulti?: boolean;
  session: ProgressiveSession;
  /** When set, caller should generate quote immediately */
  quoteRows?: ConfirmationRow[];
  /** Service names auto-confirmed without city question (rendered as a badge list in UI). */
  autoConfirmedList?: string[];
  /** Min-qty details for each service below minimum (rendered as a structured card). */
  belowMinDetails?: Array<{
    service: string;
    requested: number;
    minimum: number;
    serviceId?: string;
  }>;
}

const STOP_WORDS = new Set([
  'need', 'for', 'the', 'a', 'an', 'in', 'at', 'of', 'and', 'i', 'want', 'please',
  'generate', 'quote', 'create', 'price', 'cost', 'services', 'service', 'ads',
  'advertising', 'outdoor', 'some', 'any', 'get', 'me', 'my', 'to', 'with',
  'days', 'day', 'months', 'month', 'weeks', 'week',
]);

function titleCase(s: string): string {
  return s
    .split(/[\s_/]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^(led|lcd|fm|tv|ac)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function matchKnownCityLabel(value: string): string | null {
  const lower = value.toLowerCase().trim();
  if (!lower) return null;
  const exact = REAL_CITY_KEYS.find((c) => lower === c);
  if (exact) return exact.charAt(0).toUpperCase() + exact.slice(1);
  // "Chennai North" ok — but not "PAN India (except Mumbai)" via substring
  const prefixed = REAL_CITY_KEYS.find(
    (c) =>
      lower.startsWith(`${c} `)
      || lower.startsWith(`${c},`)
      || lower.startsWith(`${c}-`)
      || lower.startsWith(`${c}/`),
  );
  if (prefixed) return prefixed.charAt(0).toUpperCase() + prefixed.slice(1);
  return null;
}

function isKnownCityKey(value: string): boolean {
  return !!matchKnownCityLabel(value);
}

function metaFieldClean(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s || s.toUpperCase() === 'NA') return null;
  return s;
}

/** Raw metadata.city (may be a metro OR a locality like Padur). */
function getMetaCityRaw(svc: DbService): string | null {
  return metaFieldClean((svc.metadata as { city?: string } | undefined)?.city);
}

/**
 * Neighbourhood-level area from metadata.area / area_name.
 * Skips numeric-only values (size/rate codes like "1000", "400") — those are not places.
 * Does NOT include direction_remarks (street-level; used in direction step).
 */
function getMetaAreaRaw(svc: DbService): string | null {
  const meta = svc.metadata as {
    area?: string;
    area_name?: string;
    direction_remarks?: string;
  } | undefined;
  const raw = metaFieldClean(meta?.area) || metaFieldClean(meta?.area_name);
  if (!raw || isNumericOnlyLabel(raw)) return null;
  return raw;
}

/** True when the label is only digits / measurements — not a real place name. */
function isNumericOnlyLabel(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  // "1000", "400", "12x8", "20 x 10"
  if (/^\d+(\.\d+)?$/.test(t)) return true;
  if (/^\d+\s*[x×]\s*\d+$/i.test(t)) return true;
  if (/^\d+(\s*(ft|feet|m|meter|metres|sq|sqft|cm))?$/i.test(t)) return true;
  return false;
}

/**
 * Street/direction label for the final "which direction?" step.
 * Returns direction_remarks only when it is a real value.
 */
export function getDirectionLabel(svc: DbService): string | null {
  const meta = svc.metadata as { direction_remarks?: string } | undefined;
  return metaFieldClean(meta?.direction_remarks);
}

/**
 * When vendor rows put a locality in metadata.city (Padur, Vadapalani…)
 * instead of a metro, return that locality.
 */
function getLocalityFromMetaCity(svc: DbService): string | null {
  const raw = getMetaCityRaw(svc);
  if (!raw) return null;
  if (matchKnownCityLabel(raw)) return null;
  return titleCase(raw);
}

/** Real city only (Chennai/Madurai…) — never area names like Anna Nagar / Padur. */
export function extractRealCityFromDbService(svc: DbService): string | null {
  const metaCity = getMetaCityRaw(svc);
  if (metaCity) {
    const known = matchKnownCityLabel(metaCity);
    if (known) return known;
  }

  const locs: string[] = svc.metadata?.locations || [];
  for (const loc of locs) {
    const known = matchKnownCityLabel(loc);
    if (known) return known;
  }

  const sid = (svc.service_id || '').toLowerCase();
  for (const city of REAL_CITY_KEYS) {
    if (sid.endsWith(`-${city}`) || sid.includes(`-${city}-`)) {
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }

  const docName = (svc.document_name || '').toLowerCase();
  for (const key of REAL_CITY_KEYS) {
    if (docName.includes(key)) return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // Fall back to shared extractor, then drop if not a known city key
  const loose = extractCityFromDbService(svc);
  if (loose && REAL_CITY_KEYS.includes(loose.toLowerCase())) return loose;
  return null;
}

/** Distinct real cities present in catalog. */
export function getCatalogCities(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const s of services) {
    const c = extractRealCityFromDbService(s);
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function titleCaseCityKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function parseQtyFromText(text: string): number | null {
  if (!hasExplicitQty(text)) return null;
  // Prefer leading qty: "50 bus" not "3 months" alone
  const leading = text.match(/^\s*(\d+)\b/);
  if (leading) {
    const n = parseInt(leading[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // "bus 50" style (number not part of a duration)
  const mid = text.match(/\b(\d+)\b(?!\s*(?:days?|months?|weeks?)\b)/i);
  if (mid) {
    const n = parseInt(mid[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** True only when user typed a count (not only "3 months"). */
export function hasExplicitQty(text: string): boolean {
  const withoutDuration = text.replace(/\b\d+\s*(days?|months?|weeks?)\b/gi, ' ');
  return /\b\d+\b/.test(withoutDuration);
}

function isSmallTalk(text: string): ProgressiveTurnResult | null {
  const t = text.trim();
  if (!t) return null;

  const session: ProgressiveSession = { originalText: t, qty: null };

  if (/^(hi|hello|hey|hii|hai|howdy|yo|hola)[\s!.]*$/i.test(t)
    || /^(good\s+(morning|afternoon|evening))[\s!.]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: 'Hi! What service do you need?\nTry: bus, hoarding chennai, auto full branding',
      options: [],
      session,
    };
  }

  if (/^(thanks|thank\s*you|thx|ty)[\s!.]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: "You're welcome! Need another quote?",
      options: [],
      session,
    };
  }

  if (/^(help|how\s+(does\s+this\s+work|to\s+use)|what\s+can\s+you\s+do)[\s?.!]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: 'Tell me a service or city.\nEg: bus · hoarding chennai · 50 auto full branding',
      options: [],
      session,
    };
  }

  // Incomplete: "i need a", "i want", "looking for"
  if (/^(i\s+)?(need|want|looking\s+for)\s*(a|an|some)?\s*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: 'Sure — which service?\nEg: bus, hoarding chennai',
      options: [],
      session,
    };
  }

  return null;
}

export function parseDurationFromText(text: string): string | null {
  const m = text.match(/\b(\d+)\s*(days?|months?|weeks?)\b/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

export function detectCityInText(text: string, services: DbService[]): string | null {
  const lower = text.toLowerCase();
  const keys = [
    ...new Set([
      ...REAL_CITY_KEYS,
      ...getCatalogCities(services).map((c) => c.toLowerCase()),
    ]),
  ].sort((a, b) => b.length - a.length);
  for (const city of keys) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      return titleCaseCityKey(city);
    }
  }
  return null;
}

/** Cache localities per services array identity (avoids rebuild on every detect). */
let _localityCacheRef: DbService[] | null = null;
let _localityCache: string[] = [];

/** Distinct localities / areas from DB (Padur, Saidapet, … — not metro cities or service types). */
export function getCatalogLocalities(services: DbService[]): string[] {
  if (services === _localityCacheRef) return _localityCache;

  const mediumKeys = new Set<string>();
  for (const m of getCatalogTypeKeys(services)) {
    const key = canonicalizeServiceName(m);
    if (!key) continue;
    mediumKeys.add(key);
    const first = key.split(/\s+/)[0];
    if (first) mediumKeys.add(first);
  }

  const set = new Set<string>();
  const addIfPlace = (raw: string | null | undefined) => {
    if (!raw || isNumericOnlyLabel(raw) || matchKnownCityLabel(raw)) return;
    const key = canonicalizeServiceName(raw);
    if (!key) return;
    const first = key.split(/\s+/)[0] || '';
    // Cheap medium-token check only (no O(n) family filter per label)
    if (mediumKeys.has(key) || (first.length >= 3 && mediumKeys.has(first))) return;
    set.add(titleCase(raw));
  };

  for (const s of services) {
    addIfPlace(getMetaCityRaw(s));
    addIfPlace(getMetaAreaRaw(s));
    addIfPlace(getLocalityFromMetaCity(s));
    // Note: direction_remarks tokens are NOT pre-indexed here (too expensive / noisy).
    // detectLocalityInText falls back to a one-pass direction scan for unknown single words.
  }

  _localityCacheRef = services;
  _localityCache = [...set].sort((a, b) => a.localeCompare(b));
  return _localityCache;
}

/** Detect a DB locality/area name in free text (e.g. "saidapet", "muttukadu"). */
export function detectLocalityInText(text: string, services: DbService[]): string | null {
  const words = extractQueryWords(text).filter((w) => !STOP_WORDS.has(w));
  // Fast path: if this is clearly a medium/type word, never treat as locality
  if (words.length === 1) {
    const w = words[0];
    if (filterByMediumFamily(services, w).length > 0) return null;
    const mediumKeys = getCatalogTypeKeys(services).map((m) => canonicalizeServiceName(m));
    if (mediumKeys.some((m) => m === w || m.startsWith(`${w} `) || m.split(/\s+/)[0] === w)) {
      return null;
    }
  }

  const lower = text.toLowerCase();
  const keys = getCatalogLocalities(services)
    .map((l) => l.toLowerCase())
    .filter((l) => l.length >= 3 && !isNumericOnlyLabel(l))
    .sort((a, b) => b.length - a.length);
  for (const loc of keys) {
    if (new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      return titleCase(loc);
    }
  }
  // Fallback: single query word appears inside any direction_remarks (e.g. muttukadu)
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 4) return null;
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    for (const s of services) {
      const dir = getDirectionLabel(s);
      if (dir && re.test(dir)) return titleCase(w);
      const area = getMetaAreaRaw(s) || getLocalityFromMetaCity(s);
      if (area && re.test(area)) return titleCase(w);
    }
  }
  return null;
}

function filterByLocality(services: DbService[], locality: string): DbService[] {
  const a = canonicalizeServiceName(locality);
  if (!a) return [];
  const aRe = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return services.filter((s) => {
    const label = canonicalizeServiceName(getAreaLabel(s) || '');
    const loc = canonicalizeServiceName(getLocalityFromMetaCity(s) || '');
    const meta = canonicalizeServiceName(getMetaCityRaw(s) || '');
    const area = canonicalizeServiceName(getMetaAreaRaw(s) || '');
    const dir = canonicalizeServiceName(getDirectionLabel(s) || '');
    return label === a || loc === a || meta === a || area === a
      || aRe.test(label) || aRe.test(loc) || aRe.test(meta) || aRe.test(area) || aRe.test(dir);
  });
}

/** Locality-only (or metro-only) → list service types at that place. */
function startPlaceTypeBrowse(
  place: string,
  isMetroCity: boolean,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const hits = isMetroCity
    ? filterByCity(services, place)
    : filterByLocality(services, place);
  const types = uniqueMediumLabelsWithExamples(hits.length ? hits : []);
  if (types.length === 0) {
    return {
      step: 'no_match',
      botText: `No services in ${place}. Try another place or a service name.`,
      options: [],
      session: {
        ...session,
        city: isMetroCity ? place : session.city,
        area: isMetroCity ? session.area : place,
      },
    };
  }
  // Carry resolved city from hits when it's a locality
  // Prefer not inventing a metro when any hit stores locality in metadata.city
  // (Apartment: city=adyar / navalur / perungudi) — forcing Chennai would drop those rows.
  const localityOnlyHits = hits.filter(
    (h) => !!getLocalityFromMetaCity(h) && !extractRealCityFromDbService(h),
  );
  let inferredCity: string | undefined;
  if (isMetroCity) {
    inferredCity = place;
  } else if (localityOnlyHits.length === 0) {
    const cities = [
      ...new Set(
        hits
          .map((h) => extractRealCityFromDbService(h))
          .filter(Boolean) as string[],
      ),
    ];
    inferredCity = cities.length === 1 ? cities[0] : (session.city || undefined);
  } else {
    inferredCity = session.city || undefined;
  }
  return {
    step: 'pick_type',
    botText: reply || `${place} — which type of service do you need?`,
    options: types,
    allowMulti: types.length > 1,
    session: {
      ...session,
      city: inferredCity,
      area: isMetroCity ? undefined : place,
      pendingMedia: [],
      candidateServiceIds: hits.map((s) => s.service_id),
    },
  };
}

export function getMediumKey(svc: DbService): string {
  const meta = svc.metadata as { medium?: string; medium_type?: string } | undefined;
  const medium = String(meta?.medium || '').trim();
  if (medium && medium.toUpperCase() !== 'NA') {
    return canonicalizeServiceName(medium.split(/[·|]/)[0] || medium);
  }
  const name = (svc.service_name || '').split(/[·—–]/)[0] || '';
  const first = canonicalizeServiceName(name).split(/\s+/)[0] || '';
  if (first) return first;
  const sid = (svc.service_id || '').toLowerCase();
  return sid.split('-')[0] || 'service';
}

/**
 * DB medium_type (elevated / underground / …) for chip merge.
 * Prefers metadata; falls back to service_id / display-name discriminators.
 */
export function getMediumTypeFromDb(svc: DbService): string | null {
  const meta = svc.metadata as {
    medium_type?: string;
    mediumType?: string;
    type_of_medium?: string;
    subtype?: string;
    sub_type?: string;
    structure?: string;
  } | undefined;
  const raw = String(
    meta?.medium_type
      || meta?.mediumType
      || meta?.type_of_medium
      || meta?.subtype
      || meta?.sub_type
      || '',
  ).trim();
  if (raw && raw.toUpperCase() !== 'NA') {
    return titleCase(raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim());
  }
  const structure = String(meta?.structure || '').trim();
  const fromStructure = structure.match(
    /\b(elevated|underground|interior|inside|outside|wrap|platform|lobby)\b/i,
  );
  if (fromStructure) return titleCase(fromStructure[1]);
  return (
    extractMediumTypeFromServiceId(svc.service_id, svc.service_name)
    || extractMediumTypeFromDisplayName(svc.service_name || '')
  );
}

/** Parse `medium:Foo` or `medium:Foo|elevated` chip ids. */
function parseMediumChipToken(token: string): { medium: string; mediumType?: string } {
  const raw = token.trim();
  const pipe = raw.indexOf('|');
  if (pipe >= 0) {
    const medium = raw.slice(0, pipe).trim();
    const mediumType = raw.slice(pipe + 1).trim();
    return { medium, mediumType: mediumType || undefined };
  }
  return { medium: raw };
}

function serviceMatchesMediumChip(
  svc: DbService,
  chip: { medium: string; mediumType?: string },
): boolean {
  const mk = canonicalizeServiceName(getMediumKey(svc));
  const want = canonicalizeServiceName(chip.medium);
  if (!want) return false;
  const mediumOk =
    mk === want
    || isSameMediumFamily(mk, want)
    || canonicalizeServiceName(formatServiceDisplayName(svc)).includes(want);
  if (!mediumOk) return false;
  if (!chip.mediumType) return true;
  const got = getMediumTypeFromDb(svc);
  if (!got) return false;
  return canonicalizeServiceName(got) === canonicalizeServiceName(chip.mediumType);
}

export function getAreaLabel(svc: DbService): string | null {
  // Prefer explicit area fields (including metadata.area from vendor_rate_chunks)
  const fromMeta = getMetaAreaRaw(svc);
  if (fromMeta) return fromMeta;

  // Locality wrongly stored in metadata.city (Padur, Vadapalani, …)
  const locality = getLocalityFromMetaCity(svc);
  if (locality) return locality;

  // Parse trailing location from service_id: medium-city-area_slug
  // e.g. appartment_demo-padur-happiness_to → Padur
  const sid = (svc.service_id || '').toLowerCase().replace(/_/g, '-');
  if (!sid) return null;
  const city = (extractRealCityFromDbService(svc) || '').toLowerCase();
  const medium = getMediumKey(svc).replace(/\s+/g, '-');
  let rest = sid;
  if (city && rest.includes(`-${city}-`)) {
    rest = rest.slice(rest.indexOf(`-${city}-`) + city.length + 2);
  } else if (city && rest.endsWith(`-${city}`)) {
    return null;
  } else if (medium && rest.startsWith(`${medium}-`)) {
    rest = rest.slice(medium.length + 1);
    if (city && rest.startsWith(`${city}-`)) rest = rest.slice(city.length + 1);
    else if (city && rest === city) return null;
  } else {
    const parts = sid.split('-').filter(Boolean);
    // Drop leading medium-ish tokens until we hit a locality candidate
    if (parts.length >= 2) {
      const candidate = parts.find(
        (p, idx) => idx >= 1 && p.length >= 3 && !REAL_CITY_KEYS.includes(p) && !CLOUD_CITY_KEYS.includes(p),
      );
      if (candidate) return titleCase(candidate.replace(/_/g, ' '));
    }
  }
  rest = rest.replace(/^-+|-+$/g, '');
  if (!rest || rest.length < 3) return null;
  const firstSeg = rest.split('-')[0] || rest;
  if (CLOUD_CITY_KEYS.includes(firstSeg) || REAL_CITY_KEYS.includes(firstSeg) || (city && firstSeg === city)) {
    return null;
  }
  return titleCase(firstSeg.replace(/_/g, ' '));
}

/**
 * Display place for chips: localities as-is; metro+area as "Chennai · Area".
 */
function resolveDisplayPlace(
  svc: DbService,
  token: string,
): ProgressiveOption | null {
  const realCity = extractRealCityFromDbService(svc);
  const locality = getLocalityFromMetaCity(svc);
  const areaFromMeta = getMetaAreaRaw(svc);
  const area = areaFromMeta || (!locality ? getAreaLabel(svc) : null);

  // Locality stored as city → chip "Padur"
  if (locality) {
    const key = canonicalizeServiceName(locality);
    return {
      id: `place:locality|${key}`,
      label: locality,
      city: realCity || undefined,
      medium: token,
    };
  }

  if (realCity && area) {
    const areaKey = canonicalizeServiceName(area);
    return {
      id: `place:${realCity.toLowerCase()}|${areaKey}`,
      label: `${realCity} · ${area}`,
      city: realCity,
      medium: token,
    };
  }

  // Numeric-only or missing area → city chip only (direction asked later)
  if (realCity) {
    return {
      id: `city:${realCity.toLowerCase()}`,
      label: realCity,
      city: realCity,
      medium: token,
    };
  }

  // Last resort: any area-like label (skip numeric codes)
  const fallbackArea = getAreaLabel(svc);
  if (fallbackArea && !isNumericOnlyLabel(fallbackArea)) {
    const key = canonicalizeServiceName(fallbackArea);
    return {
      id: `place:locality|${key}`,
      label: fallbackArea,
      medium: token,
    };
  }

  return null;
}

export function friendlyServiceLabel(svc: DbService): string {
  const area = getAreaLabel(svc);
  const base = (svc.service_name || svc.service_id || 'Service').split('·')[0].trim();
  if (area && !canonicalizeServiceName(base).includes(canonicalizeServiceName(area))) {
    // Prefer short medium + area when name is huge
    const medium = titleCase(getMediumKey(svc));
    return `${medium} · ${area}`;
  }
  return base.length > 80 ? base.slice(0, 77) + '…' : base;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
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

function similarity(a: string, b: string): number {
  const ca = canonicalizeServiceName(a);
  const cb = canonicalizeServiceName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  if (ca.includes(cb) || cb.includes(ca)) return 0.92;
  const dist = levenshtein(ca, cb);
  const maxLen = Math.max(ca.length, cb.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen;
}

function filterByCity(services: DbService[], city: string | null): DbService[] {
  if (!city) return services;
  const key = city.toLowerCase();
  return services.filter((s) => {
    const c = (extractRealCityFromDbService(s) || '').toLowerCase();
    return c === key;
  });
}

function matchServices(services: DbService[], words: string[], city: string | null): DbService[] {
  const scoped = filterByCity(services, city);
  if (words.length === 0) return [];
  const matched = scoped.filter((s) => serviceMatchesQuery(s, words));
  return matched;
}

/**
 * Browse match for user tokens like "bus" / "shelter" / "apartment".
 * Matches word boundary in medium + product name (includes Bus Shelter when asking "bus").
 * Also tolerates spelling variants (apartment ↔ appartment).
 */
function browseTokenVariants(token: string): string[] {
  const t = canonicalizeServiceName(token);
  if (!t) return [];
  const out = new Set<string>([t]);
  if (t === 'apartment') out.add('appartment');
  if (t === 'appartment') out.add('apartment');
  return [...out];
}

function filterByBrowseToken(services: DbService[], token: string): DbService[] {
  const variants = browseTokenVariants(token);
  if (!variants.length) return [];
  const res = variants.map(
    (v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i'),
  );
  return services.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    const name = canonicalizeServiceName((s.service_name || '').split(/[·—–|]/)[0] || '');
    const sid = canonicalizeServiceName(s.service_id || '');
    const hay = `${med} ${name} ${sid}`;
    return res.some((re) => re.test(hay));
  });
}

/** Prefer browse hits; fall back to strict family for exact medium chips. */
function filterForBrowseOrFamily(services: DbService[], token: string): DbService[] {
  const browse = filterByBrowseToken(services, token);
  if (browse.length) return browse;
  return filterByMediumFamily(services, token);
}

function normalizeSegmentPhrase(text: string): string {
  return text
    .replace(/mobile\s*vans?/gi, 'mobile van')
    .replace(/mobilevan/gi, 'mobile van')
    .replace(/awarness/gi, 'awareness')
    .replace(/elevetaed/gi, 'elevated')
    .replace(/app?art+ment/gi, 'apartment')
    // Glue fixes: "2and" / "100and" / "poster2 and" → proper spaces for qty+and splits
    .replace(/(\d)\s*(and|&|\+)\s*/gi, '$1 $2 ')
    .replace(/(\d)(and|&|\+)/gi, '$1 $2 ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match DB rows for a multi-word segment token (e.g. "bus semi", "apartment lift"). */
function matchSegmentHits(
  services: DbService[],
  token: string,
  city: string | null,
): DbService[] {
  const words = canonicalizeServiceName(normalizeSegmentPhrase(token))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (!words.length) return [];

  let hits = services.filter((s) => {
    const hay = canonicalizeServiceName(
      `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|]/)[0] || ''} ${s.service_id || ''}`,
    );
    return words.every((w) => {
      const variants = browseTokenVariants(w);
      return variants.some((v) => {
        if (hay.includes(v)) return true;
        return new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(hay);
      });
    });
  });

  if (!hits.length) {
    hits = filterByBrowseToken(services, words.join(' '));
  }
  if (!hits.length && words.length > 1) {
    hits = filterByBrowseToken(services, words[0]);
  }

  if (city) {
    const c = city.toLowerCase();
    const filtered = hits.filter((s) => {
      const real = (extractRealCityFromDbService(s) || '').toLowerCase();
      const loc = (getLocalityFromMetaCity(s) || '').toLowerCase();
      const meta = (getMetaCityRaw(s) || '').toLowerCase();
      return real === c || loc === c || meta === c;
    });
    if (filtered.length) hits = filtered;
  }
  return hits;
}

/**
 * Split "50 bus semi and 10 bus shelter and auto 100" into qty+token segments.
 * Returns [] when the message is not a multi-service list.
 */
export function parseServiceSegments(text: string, services: DbService[]): BatchSegment[] {
  const normalized = normalizeSegmentPhrase(text);
  const parts = normalized
    .split(/\s*(?:\band\b|,|&|\+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  if (parts.length < 2) return [];

  const segments: BatchSegment[] = [];
  for (const part of parts) {
    const city = detectCityInText(part, services);
    const qty = parseQtyFromText(part);
    const stripped = stripQtyCityDuration(part, city);
    const token = canonicalizeServiceName(stripped);
    if (!token || token.length < 2) continue;

    const hits = matchSegmentHits(services, token, city);
    if (hits.length > 0) {
      segments.push({ raw: part, token, qty, city });
      continue;
    }
    const media = detectMediaLocal(stripped, services);
    if (media.length) {
      segments.push({ raw: part, token: media[0], qty, city });
      continue;
    }
    // Keep phrase so batch UI can still try fuzzy browse
    segments.push({ raw: part, token, qty, city });
  }
  return segments.length >= 2 ? segments : [];
}

/**
 * Group key for deduplication: medium family + city/locality.
 * All bus shelter sites in Anna Nagar share the same key → one chip.
 */
function batchGroupKey(svc: DbService): string {
  const medium = canonicalizeServiceName(getMediumKey(svc));
  const city = (getLocalityFromMetaCity(svc) || extractRealCityFromDbService(svc) || '').toLowerCase();
  return `${medium}|${city}`;
}

/** One multi-select checklist for all segments.
 *  - Auto-resolves services only in one city (listed in bot message, not shown as options).
 *  - Deduplicates by medium+city — "Bus Shelter · Anna Nagar" shows once, not 14 times.
 *  - Options carry a `group` label so the UI can render section headers per service type.
 */
function startBatchMultiSelect(
  segments: BatchSegment[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  interface SegGroup {
    rep: DbService;
    ids: string[];
    qty: number | null;
    /** City/locality label shown on the chip */
    cityLabel: string | null;
    /** Section header: the service type name (e.g. "Bus Shelter") */
    segmentName: string;
    medium: string;
    autoResolved: boolean;
  }
  // key = segmentToken + "|" + city/locality
  const groups = new Map<string, SegGroup>();
  const qtyByServiceId: Record<string, number> = { ...(session.qtyByServiceId || {}) };

  for (const seg of segments) {
    const hits = matchSegmentHits(services, seg.token, seg.city);
    if (!hits.length) continue;

    const segName = titleCase(seg.token);
    // Count DISTINCT display places (same labels shown on chips) — do not
    // auto-resolve when chips would still show Chennai + Rotn etc.
    const displayPlaceKeys = new Set<string>();
    const hitPlaces: Array<{ h: DbService; displayPlace: string | null; cityLabel: string | null }> = [];
    for (const h of hits) {
      const cityLabel = getLocalityFromMetaCity(h) || extractRealCityFromDbService(h) || null;
      const areaLabel = getMetaAreaRaw(h);
      const displayPlace =
        getLocalityFromMetaCity(h)
        || (areaLabel && !isNumericOnlyLabel(areaLabel)
          ? (extractRealCityFromDbService(h) ? `${extractRealCityFromDbService(h)} · ${areaLabel}` : areaLabel)
          : null)
        || cityLabel;
      if (displayPlace) displayPlaceKeys.add(canonicalizeServiceName(displayPlace));
      hitPlaces.push({ h, displayPlace, cityLabel });
    }
    const singlePlace = displayPlaceKeys.size <= 1;

    for (const { h, displayPlace, cityLabel } of hitPlaces) {
      const gk = `${canonicalizeServiceName(seg.token)}|${canonicalizeServiceName(displayPlace || cityLabel || '')}`;
      if (!groups.has(gk)) {
        groups.set(gk, {
          rep: h,
          ids: [],
          qty: seg.qty ?? null,
          cityLabel: displayPlace,
          segmentName: segName,
          medium: getMediumKey(h),
          autoResolved: singlePlace,
        });
      }
      const g = groups.get(gk)!;
      if (!g.ids.includes(h.service_id)) g.ids.push(h.service_id);
      if (seg.qty != null && seg.qty > 0) {
        for (const id of g.ids) qtyByServiceId[id] = seg.qty;
      }
    }
  }

  const autoGroups: SegGroup[] = [];
  const pickGroups: SegGroup[] = [];
  for (const g of groups.values()) {
    (g.autoResolved ? autoGroups : pickGroups).push(g);
  }

  // All single-place → skip picker, finalize directly
  if (pickGroups.length === 0) {
    const repSvcs = autoGroups.map((g) => g.rep);
    return finalizeSelection(repSvcs, { ...session, segments, qtyByServiceId, pendingMedia: [] }, services);
  }

  // Build options grouped by segment name (section headers)
  pickGroups.sort((a, b) =>
    a.segmentName.localeCompare(b.segmentName) || (a.cityLabel || '').localeCompare(b.cityLabel || ''),
  );

  const options: ProgressiveOption[] = pickGroups.map((g) => ({
    id: `batch-group:${g.ids.join(',')}`,
    label: g.cityLabel || g.segmentName,
    serviceId: g.rep.service_id,
    city: g.cityLabel || undefined,
    medium: g.medium,
    group: g.segmentName,
  }));

  // Soft auto-line only for services that were actually auto-resolved and
  // are NOT also sitting in the city picker (avoids "only Chennai" + Chennai/Rotn).
  const pickSegNames = new Set(pickGroups.map((g) => g.segmentName));
  const autoOnlyGroups = autoGroups.filter((g) => !pickSegNames.has(g.segmentName));
  const autoServiceNames = [...new Set(autoOnlyGroups.map((g) => g.segmentName))];
  const autoCities = [...new Set(autoOnlyGroups.map((g) => g.cityLabel).filter(Boolean) as string[])];
  const autoCityLabel = autoCities.length === 1 ? autoCities[0]! : autoCities.join(' / ');

  const autoLine = autoServiceNames.length
    ? `These are available only in ${autoCityLabel || 'one city'}, so I added them for you:\n${autoServiceNames.join(', ')}.\n\n`
    : '';

  const pickSegNamesList = [...new Set(pickGroups.map((g) => g.segmentName))];
  const pickLine =
    pickSegNamesList.length === 1 && autoServiceNames.length === 0
      ? `Which city for ${pickSegNamesList[0]}? Pick one, then Confirm:`
      : `These need a city — pick one per group, then Confirm:`;
  const botText = reply || `${autoLine}${pickLine}`;

  const autoIds = autoOnlyGroups.flatMap((g) => g.ids);
  const autoReps = autoOnlyGroups.map((g) => g.rep);
  const { rows: autoRows } = buildRowsForServices(
    autoReps,
    null,
    session.durationText,
    session.originalText,
    qtyByServiceId,
  );

  return {
    step: 'pick_type',
    botText,
    options,
    allowMulti: true,
    autoConfirmedList: undefined,
    session: {
      ...session,
      segments,
      qtyByServiceId,
      pendingMedia: [],
      qty: null,
      collectedRows: [...(session.collectedRows || []), ...autoRows],
      collectedServiceIds: [...(session.collectedServiceIds || []), ...autoIds],
      candidateServiceIds: options.map((o) => o.serviceId!).filter(Boolean),
    },
  };
}

/** Family match: "bus" → bus full/semi; not bus stand. Name fallback uses same rule. */
function filterByMediumFamily(services: DbService[], medium: string): DbService[] {
  const m = canonicalizeServiceName(medium);
  if (!m) return [];
  const byMedium = filterByExactMedium(services, m);
  if (byMedium.length) return byMedium;
  return services.filter((s) => {
    const nameBase = canonicalizeServiceName((s.service_name || '').split(/[·—–|]/)[0] || '');
    return isSameMediumFamily(nameBase, m);
  });
}

function uniqueMediumLabels(services: DbService[]): ProgressiveOption[] {
  return uniqueMediumLabelsWithExamples(services);
}

/** Type chips — catalog medium, merged with DB medium_type when present. */
function uniqueMediumLabelsWithExamples(services: DbService[]): ProgressiveOption[] {
  const map = new Map<string, ProgressiveOption>();
  for (const s of services) {
    const medium = getMediumKey(s);
    if (!medium) continue;
    const mType = getMediumTypeFromDb(s);
    // Avoid "Metro Train Inside Branding — Inside"
    const typeAlreadyInMedium =
      !!mType
      && canonicalizeServiceName(medium).includes(canonicalizeServiceName(mType));
    const typeForChip = mType && !typeAlreadyInMedium ? mType : null;
    const key = typeForChip
      ? `${canonicalizeServiceName(medium)}|${canonicalizeServiceName(typeForChip)}`
      : canonicalizeServiceName(medium);
    if (map.has(key)) continue;
    const label = typeForChip
      ? `${titleCase(medium)} — ${titleCase(typeForChip)}`
      : titleCase(medium);
    map.set(key, {
      id: typeForChip
        ? `medium:${medium}|${canonicalizeServiceName(typeForChip)}`
        : `medium:${medium}`,
      label,
      medium,
      mediumType: typeForChip || undefined,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Catalog type keys only — never a hardcoded bus/hoarding list. */
export function getCatalogTypeKeys(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const s of services) {
    const m = getMediumKey(s);
    if (m) set.add(m);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Local multi-type detect using ONLY DB catalog mediums (fallback when AI offline).
 * Matches catalog keys OR their first token ("bus" matches "bus semi branding").
 * Does not treat "bus stand" as Bus (see isAmbiguousPlaceQuery).
 */
export function detectMediaLocal(text: string, services: DbService[]): string[] {
  if (isAmbiguousPlaceQuery(text)) return [];
  // Feature words that span multiple mediums (led, …) → clarify, not one family
  if (detectFeatureClarifyHint(text, services, detectCityInText(text, services))) {
    return [];
  }
  const lower = text.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' and ');
  const catalog = getCatalogTypeKeys(services)
    .map((m) => ({ raw: m, key: canonicalizeServiceName(m) }))
    .filter((m) => m.key.length >= 2)
    .sort((a, b) => b.key.length - a.key.length);

  const found = new Set<string>();
  for (const m of catalog) {
    const words = m.key.split(/\s+/).filter(Boolean);
    const first = words[0] || m.key;
    const fullRe = new RegExp(
      `\\b${m.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
      'i',
    );
    const firstRe = new RegExp(
      `\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
      'i',
    );

    if (fullRe.test(lower)) {
      // Full catalog key matches → use it directly
      found.add(m.key);
    } else if (firstRe.test(lower)) {
      // First word matches → find longest prefix (2+ words) that also matches in text
      let longestMatch = first;
      for (let i = words.length; i >= 2; i--) {
        const prefix = words.slice(0, i).join(' ');
        const prefRe = new RegExp(
          `\\b${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
          'i',
        );
        if (prefRe.test(lower)) {
          longestMatch = prefix;
          break;
        }
      }
      // Use short family token only when first word alone is meaningful (≥3 chars)
      found.add(first.length >= 3 ? longestMatch : m.key);
    }
  }

  // Prefer specific mediums ("bus shelter") over short family ("bus") when both matched
  const ranked = [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const pruned: string[] = [];
  for (const f of ranked) {
    if (pruned.some((p) => p.startsWith(`${f} `))) continue;
    for (let i = pruned.length - 1; i >= 0; i--) {
      if (f.startsWith(`${pruned[i]} `)) pruned.splice(i, 1);
    }
    pruned.push(f);
  }
  return pruned;
}

/** Ambiguous place/context — prefer AI; local fallback for common multi-type feature phrases. */
export function isAmbiguousPlaceQuery(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bbus\s*stands?\b/.test(t)) return true;
  return false;
}

/**
 * Local: single feature word (led) that hits multiple mediums via name/medium → clarify.
 * Does not trigger for clear families like "bus" when all hits share that family.
 */
export function detectFeatureClarifyHint(
  text: string,
  services: DbService[],
  city: string | null,
): string | null {
  if (/\b(and|&|\+)\b/i.test(text)) return null;
  if (isAmbiguousPlaceQuery(text)) {
    if (/\bbus\s*stands?\b/i.test(text)) return 'bus stand';
    return 'that';
  }
  const cityDetected = city || detectCityInText(text, services);
  const stripped = stripQtyCityDuration(text, cityDetected);
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  if (words.length !== 1) return null;
  const hint = words[0];
  // Locality name (saidapet, padur) — not a feature; place-browse handles it
  if (detectLocalityInText(hint, services) || detectLocalityInText(text, services)) {
    return null;
  }
  const familyRows = filterByMediumFamily(services, hint);
  const familyScoped = cityDetected ? filterByCity(familyRows, cityDetected) : familyRows;
  // Clear product family in DB ("bus", "auto") → let medium flow ask city / areas
  if (familyScoped.length > 0) return null;

  const featureTypes = typesForClarify(services, cityDetected, hint);
  // Feature/feature word only (e.g. led) spanning multiple catalog types
  if (featureTypes.length > 1) return hint;
  return null;
}

/** Types related to a feature/hint — search medium + product name only (not area text). */
function typesForClarify(
  services: DbService[],
  city: string | null,
  hint: string | null,
): ProgressiveOption[] {
  const scoped = city ? filterByCity(services, city) : services;
  if (!hint || !hint.trim()) {
    return uniqueMediumLabelsWithExamples(scoped);
  }
  const h = canonicalizeServiceName(hint);
  const words = h.split(/\s+/).filter((w) => w.length >= 2);
  const matchedSvcs = scoped.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    const name = canonicalizeServiceName((s.service_name || '').split(/[·—–]/)[0] || '');
    const hay = `${med} ${name}`;
    if (words.length > 1) {
      return words.every((w) => hay.includes(w));
    }
    // "led" must not match "non led"
    if (h === 'led' && /\bnon\s+led\b/.test(hay)) return false;
    // single feature token: word boundary in medium or product name
    return new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay);
  });
  const fromHint = uniqueMediumLabelsWithExamples(matchedSvcs);
  // Never fall back to the full catalog — empty means "not a feature clarify"
  return fromHint;
}

function isCityOnlyQuery(text: string, services: DbService[]): string | null {
  const city = detectCityInText(text, services);
  if (!city) return null;
  if (isAmbiguousPlaceQuery(text)) return null;
  if (detectMediaLocal(text, services).length > 0) return null;
  const stripped = stripQtyCityDuration(text, city);
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  const cityTokens = new Set(city.toLowerCase().split(/\s+/));
  const rest = words.filter((w) => !cityTokens.has(w));
  if (rest.length === 0) return city;
  if (rest.every((w) => ['service', 'services', 'available', 'list', 'show', 'all', 'options'].includes(w))) {
    return city;
  }
  return null;
}

/** Locality-only query e.g. "saidapet" / "padur" → browse types at that place. */
function isLocalityOnlyQuery(text: string, services: DbService[]): string | null {
  if (isCityOnlyQuery(text, services)) return null;
  // Service/medium words (apartment, bus, hoarding…) are never localities
  if (detectMediaLocal(text, services).length > 0) return null;
  if (filterByMediumFamily(services, text.trim()).length > 0) return null;

  const locality = detectLocalityInText(text, services);
  if (!locality) return null;
  if (isAmbiguousPlaceQuery(text)) return null;

  // If the detected "locality" is itself a known medium/type token, ignore
  const locKey = canonicalizeServiceName(locality);
  if (filterByMediumFamily(services, locKey).length > 0) return null;
  if (detectMediaLocal(locKey, services).length > 0) return null;

  // Don't treat as locality-only if user also named a clear ad medium (bus, auto, …)
  const stripped = text.replace(
    new RegExp(`\\b${locality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'),
    ' ',
  );
  const media = detectMediaLocal(stripped, services);
  if (media.length > 0) return null;
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  const locTokens = new Set(locality.toLowerCase().split(/\s+/));
  const rest = words.filter((w) => !locTokens.has(w));
  if (rest.length === 0) return locality;
  if (rest.every((w) => ['service', 'services', 'available', 'list', 'show', 'all', 'options', 'near', 'in', 'at'].includes(w))) {
    return locality;
  }
  return null;
}

function mediumLabelsForCity(services: DbService[], city: string): ProgressiveOption[] {
  return uniqueMediumLabelsWithExamples(filterByCity(services, city));
}

/** Size/finish style tokens — same family as "bus full", not different products like "bus stand". */
const MEDIUM_STYLE_TOKENS = new Set([
  'full', 'semi', 'branding', 'wrap', 'wrapping', 'panel', 'back', 'front',
  'interior', 'exterior', 'non', 'led', 'lcd', 'digital', 'static', 'premium',
  'standard', 'basic', 'partial', 'complete', 'side', 'rear', 'top', 'outside',
]);

function isSameMediumFamily(mediumKey: string, familyToken: string): boolean {
  const mk = canonicalizeServiceName(mediumKey);
  const m = canonicalizeServiceName(familyToken);
  if (!m || !mk) return false;
  if (mk === m) return true;
  const parts = mk.split(/\s+/).filter(Boolean);
  if (parts[0] !== m) return false;
  if (parts.length === 1) return true;
  // Remaining tokens must all be style words (not "stand", "booth", "shelter", …)
  return parts.slice(1).every((p) => MEDIUM_STYLE_TOKENS.has(p));
}

/** Strict family filter: "auto" → auto full / auto semi. Not "bus stand" when asking "bus". */
function filterByExactMedium(services: DbService[], medium: string): DbService[] {
  const m = canonicalizeServiceName(medium);
  if (!m) return [];
  const exact = services.filter((s) => canonicalizeServiceName(getMediumKey(s)) === m);
  if (exact.length) return exact;
  return services.filter((s) => isSameMediumFamily(getMediumKey(s), m));
}

function uniqueServiceOptions(services: DbService[], limit = Number.POSITIVE_INFINITY): ProgressiveOption[] {
  const seen = new Set<string>();
  const out: ProgressiveOption[] = [];
  for (const s of services) {
    const id = s.service_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: friendlyServiceLabel(s),
      serviceId: id,
      city: extractRealCityFromDbService(s) || undefined,
      medium: getMediumKey(s),
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function uniqueProductOptions(services: DbService[]): ProgressiveOption[] {
  // Prefer medium + medium_type merge; keep Elevated / Underground distinct.
  const byLabel = new Map<string, ProgressiveOption>();
  for (const s of services) {
    const medium = getMediumKey(s);
    const mType = getMediumTypeFromDb(s);
    const typeAlreadyInMedium =
      !!mType
      && !!medium
      && canonicalizeServiceName(medium).includes(canonicalizeServiceName(mType));
    const merged =
      medium && mType && !typeAlreadyInMedium
        ? `${titleCase(medium)} — ${titleCase(mType)}`
        : null;
    const label = (
      merged
      || formatServiceDisplayName(s)
      || (s.service_name || '').split('·')[0]
      || friendlyServiceLabel(s)
    ).trim();
    const key = canonicalizeServiceName(label);
    if (!key || byLabel.has(key)) continue;
    byLabel.set(key, {
      id: `product:${key}`,
      label: label.length > 60 ? label.slice(0, 57) + '…' : label,
      medium: medium || getMediumKey(s),
      mediumType: mType && !typeAlreadyInMedium ? mType : undefined,
      serviceId: getAreaLabel(s) ? undefined : s.service_id,
      city: extractRealCityFromDbService(s) || undefined,
    });
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label)).slice(0, 40);
}

function citiesForMedium(services: DbService[], medium: string): ProgressiveOption[] {
  const cities = new Set<string>();
  for (const s of filterForBrowseOrFamily(services, medium)) {
    const c = extractRealCityFromDbService(s);
    if (c) cities.add(c);
  }
  return [...cities]
    .sort()
    .map((c) => ({ id: `city:${c.toLowerCase()}`, label: c, city: c, medium }));
}

function areasForMediumCity(services: DbService[], medium: string, city: string): DbService[] {
  const c = city.toLowerCase();
  return filterForBrowseOrFamily(services, medium).filter((s) => {
    const real = (extractRealCityFromDbService(s) || '').toLowerCase();
    return real === c;
  });
}

/** Unique place chips: localities as-is; metro+area as "City · Area". */
function uniquePlaceOptions(services: DbService[], token: string): ProgressiveOption[] {
  const hits = filterForBrowseOrFamily(services, token);
  const byPlace = new Map<string, ProgressiveOption>();

  for (const s of hits) {
    const place = resolveDisplayPlace(s, token);
    if (!place) continue;
    if (!byPlace.has(place.id)) byPlace.set(place.id, place);
  }

  if (byPlace.size === 0) {
    return citiesForMedium(services, token);
  }

  return [...byPlace.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Distinct area chips within a city for a browse token. */
function uniqueAreaOptions(services: DbService[], token: string, city: string): ProgressiveOption[] {
  const hits = areasForMediumCity(services, token, city);
  const map = new Map<string, ProgressiveOption>();
  for (const s of hits) {
    const area = getAreaLabel(s);
    if (!area || isNumericOnlyLabel(area)) continue;
    const key = canonicalizeServiceName(area);
    if (map.has(key)) continue;
    map.set(key, {
      id: `area:${key}`,
      label: area,
      city,
      medium: token,
      serviceId: undefined,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** After city (+ optional area) resolved: ask type if multiple, else quote. */
function afterLocationResolved(
  hits: DbService[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const token = session.browseToken || session.medium || '';
  const where = [session.city, session.area].filter(Boolean).join(' · ');

  if (hits.length === 0) {
    return softPickTypes(
      services,
      session,
      session.city,
      `Nothing for ${titleCase(token)}${where ? ` in ${where}` : ''}. Pick a type:`,
    );
  }

  if (hits.length === 1) {
    return finalizeSelection(hits, session, services);
  }

  const types = uniqueMediumLabelsWithExamples(hits);
  if (types.length > 1) {
    return {
      step: 'pick_type',
      botText: reply || `In ${where || session.city || 'that location'} — which ${titleCase(token)} type?`,
      options: types,
      allowMulti: true,
      session: {
        ...session,
        candidateServiceIds: hits.map((s) => s.service_id),
      },
    };
  }

  const products = uniqueProductOptions(hits);
  if (products.length > 1) {
    return {
      step: 'related_services',
      botText: reply || `Which ${titleCase(token)} in ${where || session.city || ''}?`,
      options: products,
      allowMulti: true,
      session: {
        ...session,
        medium: types[0]?.medium || session.medium,
        candidateServiceIds: hits.map((s) => s.service_id),
      },
    };
  }

  // Same type, multiple rows differ only by direction — ask direction
  const withDirection = hits.filter((s) => !!getDirectionLabel(s));
  if (withDirection.length > 1) {
    return buildDirectionPicker(withDirection, session, where || session.city || '');
  }

  // Same type, multiple site rows without distinct products — list services
  return {
    step: 'related_services',
    botText: reply || `Which one in ${where || session.city || ''}?`,
    options: uniqueServiceOptions(hits),
    allowMulti: true,
    session: {
      ...session,
      medium: getMediumKey(hits[0]),
      candidateServiceIds: hits.map((s) => s.service_id),
    },
  };
}

/** Build direction picker options from a set of services that have direction_remarks. */
function buildDirectionPicker(
  hits: DbService[],
  session: ProgressiveSession,
  locationLabel: string,
): ProgressiveTurnResult {
  const seen = new Set<string>();
  const options: ProgressiveOption[] = [];
  for (const s of hits) {
    const dir = getDirectionLabel(s);
    if (!dir) continue;
    const key = canonicalizeServiceName(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: `direction:${s.service_id}`,
      label: dir,
      serviceId: s.service_id,
      city: extractRealCityFromDbService(s) || undefined,
      medium: getMediumKey(s),
    });
  }
  options.sort((a, b) => a.label.localeCompare(b.label));
  const mediumName = titleCase(getMediumKey(hits[0]));
  return {
    step: 'pick_direction',
    botText: `Which direction in ${locationLabel} for ${mediumName}?`,
    options,
    allowMulti: true,
    session: {
      ...session,
      medium: getMediumKey(hits[0]),
      candidateServiceIds: hits.map((s) => s.service_id),
    },
  };
}

function filterHitsBySessionLocation(hits: DbService[], session: ProgressiveSession): DbService[] {
  let out = hits;
  if (session.area) {
    const a = canonicalizeServiceName(session.area);
    const aRe = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    out = out.filter((s) => {
      const label = canonicalizeServiceName(getAreaLabel(s) || '');
      const locality = canonicalizeServiceName(getLocalityFromMetaCity(s) || '');
      const metaCity = canonicalizeServiceName(getMetaCityRaw(s) || '');
      const metaArea = canonicalizeServiceName(getMetaAreaRaw(s) || '');
      const dir = canonicalizeServiceName(getDirectionLabel(s) || '');
      return label === a || locality === a || metaCity === a || metaArea === a
        || aRe.test(label) || aRe.test(locality) || aRe.test(metaCity) || aRe.test(metaArea) || aRe.test(dir);
    });
    // Apartment-style rows store locality in metadata.city (Adyar / Navalur) with no metro.
    // Only also require session.city when every remaining hit has a real metro city.
    if (session.city && out.length > 0) {
      const allHaveMetro = out.every((s) => !!extractRealCityFromDbService(s));
      if (allHaveMetro) {
        const c = session.city.toLowerCase();
        out = out.filter((s) => (extractRealCityFromDbService(s) || '').toLowerCase() === c);
      }
    }
    return out;
  }
  if (session.city) {
    const c = session.city.toLowerCase();
    out = out.filter((s) => {
      const real = (extractRealCityFromDbService(s) || '').toLowerCase();
      if (real === c) return true;
      // Locality chips may store metro on session.city occasionally
      return false;
    });
  }
  return out;
}

function bestFuzzyGuess(
  services: DbService[],
  query: string,
  city: string | null,
): { svc: DbService; score: number } | null {
  const scoped = filterByCity(services, city);
  const q = canonicalizeServiceName(query);
  if (!q || q.length < 3) return null;

  let best: { svc: DbService; score: number } | null = null;
  const seen = new Set<string>();

  for (const s of scoped) {
    const labels = [
      s.service_name || '',
      (s.service_name || '').split('·')[0],
      getMediumKey(s),
      friendlyServiceLabel(s),
    ];
    for (const label of labels) {
      const score = similarity(q, label);
      if (score < 0.72) continue;
      const id = s.service_id;
      if (seen.has(id) && best && best.svc.service_id === id) continue;
      if (!best || score > best.score) {
        best = { svc: s, score };
        seen.add(id);
      }
    }
  }
  return best && best.score < 0.98 ? best : null;
}

function buildRowsForServices(
  selected: DbService[],
  qty: number | null,
  durationText: string | null | undefined,
  originalText: string,
  qtyByServiceId?: Record<string, number>,
): { rows: ConfirmationRow[]; belowMin: Array<{ svc: DbService; requested: number; minimum: number }> } {
  const belowMin: Array<{ svc: DbService; requested: number; minimum: number }> = [];
  const rows: ConfirmationRow[] = [];

  for (const svc of selected) {
    const minQty = getMinQuantityFromDbService(svc);
    const city =
      extractRealCityFromDbService(svc)
      || getLocalityFromMetaCity(svc)
      || extractCityFromDbService(svc)
      || '—';
    const perSvcQty =
      qtyByServiceId && qtyByServiceId[svc.service_id] != null
        ? qtyByServiceId[svc.service_id]
        : qty;
    let useQty: number;
    if (perSvcQty == null) {
      useQty = minQty && minQty > 1 ? minQty : 1;
    } else if (minQty && minQty > 1 && perSvcQty < minQty) {
      belowMin.push({ svc, requested: perSvcQty, minimum: minQty });
      useQty = perSvcQty; // pending until user confirms
    } else {
      useQty = perSvcQty;
    }
    rows.push({
      service: (svc.service_name || '').split('·')[0].trim() || friendlyServiceLabel(svc),
      qty: useQty,
      city,
      serviceId: svc.service_id,
    });
  }

  void durationText;
  void originalText;
  return { rows, belowMin };
}

function stripQtyCityDuration(text: string, city: string | null): string {
  let t = text;
  if (city) {
    t = t.replace(new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), ' ');
  }
  t = t.replace(/\b\d+\s*(days?|months?|weeks?)\b/gi, ' ');
  t = t.replace(/\b\d+\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export interface IntentOverlay {
  kind?: string | null;
  media?: string[] | null;
  medium?: string | null;
  city?: string | null;
  areaHint?: string | null;
  ambiguous?: boolean;
  clarifyHint?: string | null;
  qty?: number | null;
  duration?: string | null;
  shortReply?: string | null;
}

function softPickTypes(
  services: DbService[],
  session: ProgressiveSession,
  city: string | undefined,
  botText: string,
): ProgressiveTurnResult {
  const types = city
    ? mediumLabelsForCity(services, city)
    : uniqueMediumLabelsWithExamples(services);
  return {
    step: 'pick_type',
    botText,
    options: types,
    allowMulti: types.length > 1,
    session: { ...session, city, pendingMedia: [] },
  };
}

/** Prefer common BTL media for help examples when present in catalog. */
function pickExampleServiceLabels(services: DbService[], n = 3): string[] {
  const all = uniqueMediumLabelsWithExamples(services);
  if (!all.length) return ['Bus Semi', 'Metro Station', 'Apartment Lift'];
  const prefer = [
    'bus semi',
    'metro station',
    'apartment lift',
    'auto semi',
    'cab',
    'hoarding',
    'lamp post',
    'bus shelter',
  ];
  const picked: string[] = [];
  const used = new Set<string>();
  for (const p of prefer) {
    const hit = all.find((o) => {
      const hay = canonicalizeServiceName(`${o.label} ${o.medium || ''}`);
      return hay.includes(p) || hay.startsWith(p.split(/\s+/)[0] || p);
    });
    if (hit && !used.has(hit.id)) {
      used.add(hit.id);
      picked.push(hit.label);
      if (picked.length >= n) return picked;
    }
  }
  for (const o of all) {
    if (used.has(o.id)) continue;
    picked.push(o.label);
    if (picked.length >= n) break;
  }
  return picked;
}

function pickExamplePlaces(services: DbService[], n = 3): string[] {
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    const c = extractRealCityFromDbService(s);
    if (!c) continue;
    const key = canonicalizeServiceName(c);
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(c);
    if (cities.length >= n) return cities;
  }
  for (const loc of getCatalogLocalities(services)) {
    const key = canonicalizeServiceName(loc);
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(titleCase(loc));
    if (cities.length >= n) break;
  }
  return cities.length ? cities : ['Chennai', 'Madurai', 'Coimbatore'];
}

/**
 * Wrong / unreadable input — no wall of chips; ask again with DB examples.
 */
function softClarifyNeed(
  services: DbService[],
  session: ProgressiveSession,
  reply?: string | null,
): ProgressiveTurnResult {
  const svcEx = pickExampleServiceLabels(services, 3);
  const places = pickExamplePlaces(services, 3);
  const examples = [
    'Which service and location do you need?',
    '',
    'Example services:',
    ...svcEx.map((s) => `• ${s}`),
    '',
    'Example locations:',
    ...places.map((p) => `• ${p}`),
    '',
    `Try like: 50 ${canonicalizeServiceName(svcEx[0] || 'bus semi')} in ${(places[0] || 'chennai').toLowerCase()}`,
  ].join('\n');

  const intro =
    (reply && reply.trim())
    || "Sorry — I didn't understand that. What do you mean?";

  return {
    step: 'no_match',
    botText: `${intro}\n\n${examples}`,
    options: [],
    allowMulti: false,
    session: { ...session, pendingMedia: [] },
  };
}

function startMediumFlow(
  medium: string,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const medKey = canonicalizeServiceName(medium);
  const browseToken = canonicalizeServiceName(session.browseToken || medium);
  const nextSession: ProgressiveSession = {
    ...session,
    medium: medKey,
    browseToken,
  };

  const pool = filterForBrowseOrFamily(services, browseToken);

  // 0) Locality already known (text or session) — e.g. "apartment in adyar"
  // where DB city=adyar / navalur / perungudi. Skip the full place wall.
  if (!nextSession.city && !nextSession.area) {
    const locFromText = detectLocalityInText(session.originalText || '', services);
    if (locFromText) nextSession.area = locFromText;
  }
  if (!nextSession.city && nextSession.area) {
    const atPlace = filterByLocality(pool, nextSession.area);
    if (atPlace.length > 0) {
      const localityOnly = atPlace.some(
        (h) => !!getLocalityFromMetaCity(h) && !extractRealCityFromDbService(h),
      );
      return afterLocationResolved(
        atPlace,
        {
          ...nextSession,
          city: localityOnly
            ? nextSession.city
            : (extractRealCityFromDbService(atPlace[0]) || nextSession.city),
        },
        services,
        reply || `In ${nextSession.area} — which ${titleCase(browseToken)} type?`,
      );
    }
    // Named place but no rows for this medium there — don't dump 100+ places
    return {
      step: 'no_match',
      botText: `No ${titleCase(browseToken)} in ${nextSession.area}. Try another place or a different service.`,
      options: [],
      session: nextSession,
    };
  }

  // 1) No city yet → show City · Area (or cities) from DB
  if (!nextSession.city) {
    const places = uniquePlaceOptions(services, browseToken);
    if (places.length >= 1) {
      const allAreCities = places.every((p) => p.id.startsWith('city:'));
      return {
        step: allAreCities ? 'pick_city' : 'pick_area',
        botText:
          reply
          || (allAreCities
            ? `Which city for ${titleCase(browseToken)}?`
            : `Which city & area for ${titleCase(browseToken)}?`),
        options: places,
        allowMulti: true,
        session: {
          ...nextSession,
          candidateServiceIds: pool.map((s) => s.service_id),
        },
      };
    }
  }

  // 2) City set, area not set → ask area if DB has areas in that city
  if (nextSession.city && !nextSession.area) {
    const areaOpts = uniqueAreaOptions(services, browseToken, nextSession.city);
    if (areaOpts.length > 1) {
      return {
        step: 'pick_area',
        botText: reply || `Nice — ${nextSession.city}. Which area?`,
        options: areaOpts,
        allowMulti: true,
        session: {
          ...nextSession,
          candidateServiceIds: areasForMediumCity(services, browseToken, nextSession.city).map(
            (s) => s.service_id,
          ),
        },
      };
    }
    if (areaOpts.length === 1) {
      // Only one area — select it and continue
      nextSession.area = areaOpts[0].label;
    }
  }

  // 3) Location resolved → ask type if multiple, else quote
  const hits = filterHitsBySessionLocation(pool, nextSession);
  if (hits.length === 0) {
    const rest = (session.pendingMedia || []).filter(
      (m) => canonicalizeServiceName(m) !== medKey,
    );
    if (rest.length > 0) {
      return startMediumFlow(
        rest[0],
        { ...nextSession, pendingMedia: rest, area: undefined },
        services,
        `No ${titleCase(browseToken)}${nextSession.city ? ` in ${nextSession.city}` : ''}. Next — ${titleCase(rest[0])}:`,
      );
    }
    return softPickTypes(
      services,
      nextSession,
      nextSession.city,
      `Nothing for ${titleCase(browseToken)}${nextSession.city ? ` in ${nextSession.city}` : ''}. Pick a type:`,
    );
  }

  return afterLocationResolved(hits, nextSession, services, reply);
}

/**
 * Resolve one user free-text turn into the next progressive step.
 */
export function resolveProgressiveText(
  userText: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  const originalText = normalizeSegmentPhrase(userText.trim());

  // AI greeting / help shortcuts
  if (intent?.kind === 'greeting') {
    return {
      step: 'small_talk',
      botText: intent.shortReply || 'Hi! What service do you need?\nTry: bus, hoarding chennai, auto full branding',
      options: [],
      session: { originalText, qty: null, aiReply: intent.shortReply },
    };
  }
  if (intent?.kind === 'help') {
    return {
      step: 'small_talk',
      botText:
        intent.shortReply
        || 'Tell me a service or city.\nEg: bus · hoarding chennai · bus and auto in madurai',
      options: [],
      session: { originalText, qty: null, aiReply: intent.shortReply },
    };
  }

  const talk = isSmallTalk(originalText);
  if (talk) return talk;

  const qty = hasExplicitQty(originalText)
    ? (parseQtyFromText(originalText)
      ?? (intent?.qty != null ? Number(intent.qty) : null))
    : null;
  const durationText = intent?.duration ?? parseDurationFromText(originalText);
  const city =
    (intent?.city ? titleCase(String(intent.city)) : null)
    || detectCityInText(originalText, services)
    || null;

  const catalogTypes = getCatalogTypeKeys(services);
  const mediaFromAi = (intent?.media || [])
    .map((m) => String(m).trim())
    .filter(Boolean);
  // Prefer AI media (already catalog-resolved by caller); else local catalog-only detect
  const mediaLocal = detectMediaLocal(originalText, services);
  let media =
    mediaFromAi.length > 0
      ? mediaFromAi
      : intent?.medium
        ? [String(intent.medium)]
        : mediaLocal;

  // Map free labels onto catalog keys when needed
  if (media.length && catalogTypes.length) {
    const resolved = resolveMediaAgainstCatalog(media, catalogTypes);
    if (resolved.length) media = resolved;
  }

  const shortReply = intent?.shortReply || null;

  // Locality-only ("saidapet") → ask which service type there (before medium/feature flows)
  const earlyLocality = isLocalityOnlyQuery(originalText, services);
  if (earlyLocality) {
    return startPlaceTypeBrowse(
      earlyLocality,
      false,
      {
        originalText,
        qty,
        durationText,
        pendingMedia: [],
        collectedRows: [],
        collectedServiceIds: [],
        aiReply: shortReply,
      },
      services,
      shortReply,
    );
  }

  // Multi-service "X and Y and Z" → batch multi-select (before clarify / single-medium flows)
  const earlySegments = parseServiceSegments(originalText, services);
  if (earlySegments.length >= 2) {
    return startBatchMultiSelect(
      earlySegments,
      {
        originalText,
        city: city || undefined,
        qty: null,
        durationText,
        pendingMedia: [],
        collectedRows: [],
        collectedServiceIds: [],
        aiReply: shortReply,
      },
      services,
      null, // let startBatchMultiSelect build the message with auto-confirmed summary
    );
  }

  const featureHint =
    (intent?.kind === 'clarify_type' || intent?.ambiguous
      ? (intent?.clarifyHint || detectFeatureClarifyHint(originalText, services, city))
      : null)
    || detectFeatureClarifyHint(originalText, services, city);

  // Ambiguous place (bus stand) without a clear browse → ask type.
  // Otherwise city+area first via browse flow (bus, shelter, led, …).
  if (featureHint && mediaFromAi.length < 2) {
    const hint = intent?.clarifyHint || featureHint;
    const browseHits =
      hint && hint !== 'that' ? filterByBrowseToken(services, hint) : [];
    if (browseHits.length > 0 && !isAmbiguousPlaceQuery(originalText)) {
      return startMediumFlow(
        hint,
        {
          originalText,
          medium: canonicalizeServiceName(hint),
          browseToken: canonicalizeServiceName(hint),
          city: city || undefined,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          aiReply: shortReply,
        },
        services,
        shortReply,
      );
    }
    const types = typesForClarify(services, city, hint === 'that' ? null : hint);
    const where = city ? ` in ${city}` : '';
    return {
      step: 'pick_type',
      botText:
        shortReply
        || `Got it — ${hint === 'that' ? 'that' : hint}${where}. Which type do you want?`,
      options: types,
      allowMulti: types.length > 1,
      session: {
        originalText,
        city: city || undefined,
        qty,
        durationText,
        pendingMedia: [],
        aiReply: shortReply,
      },
    };
  }

  // AI city browse, metro-only, or locality-only → list DB types at that place
  const cityOnly = isCityOnlyQuery(originalText, services);
  const localityOnly = isLocalityOnlyQuery(originalText, services);
  if (intent?.kind === 'city_browse' || cityOnly || localityOnly) {
    if (localityOnly) {
      return startPlaceTypeBrowse(
        localityOnly,
        false,
        {
          originalText,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          aiReply: shortReply,
        },
        services,
        shortReply,
      );
    }
    const browseCity = cityOnly || city;
    if (browseCity) {
      return startPlaceTypeBrowse(
        browseCity,
        true,
        {
          originalText,
          city: browseCity,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          aiReply: shortReply,
        },
        services,
        shortReply,
      );
    }
  }

  const stripped = stripQtyCityDuration(originalText, city);
  let words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  if (intent?.areaHint) {
    const aWords = extractQueryWords(String(intent.areaHint));
    if (aWords.length) words = [...new Set([...words, ...aWords])];
  }

  if (words.length === 0 && !city && media.length === 0) {
    return {
      step: 'small_talk',
      botText: shortReply || 'Sure — which service?\nEg: bus, hoarding chennai, bus and auto madurai',
      options: [],
      session: { originalText, qty: null },
    };
  }

  const sessionBase: ProgressiveSession = {
    originalText,
    medium: media[0] ? canonicalizeServiceName(media[0]) : undefined,
    browseToken: media[0] ? canonicalizeServiceName(media[0]) : undefined,
    city: city || undefined,
    qty,
    durationText,
    pendingMedia: media.length > 1 ? media.slice(1) : media.length === 1 ? [] : [],
    collectedRows: [],
    collectedServiceIds: [],
    aiReply: shortReply,
  };

  if (!services.length) {
    return {
      step: 'no_match',
      botText: 'No services loaded yet. Upload rate cards first.',
      options: [],
      session: sessionBase,
    };
  }

  // Multi-service list ("50 bus and 10 shelter and …") → one multi-select chip list
  const segments = parseServiceSegments(originalText, services);
  if (segments.length >= 2) {
    return startBatchMultiSelect(segments, sessionBase, services, null);
  }

  // AI returned multiple media without "and"-parsed segments → same batch UI
  if (media.length >= 2) {
    const fromMedia: BatchSegment[] = media.map((m) => ({
      raw: m,
      token: canonicalizeServiceName(m),
      qty,
      city,
    }));
    return startBatchMultiSelect(fromMedia, sessionBase, services, null);
  }

  // Single media → resolve locality in same text (apartment in adyar) inside startMediumFlow
  if (media.length === 1) {
    const first = media[0];
    const locInText = detectLocalityInText(originalText, services);
    // Locality-only message that is NOT also a catalog medium → place type browse
    const mediaInText = detectMediaLocal(stripQtyCityDuration(originalText, city), services);
    if (locInText && mediaInText.length === 0) {
      return startPlaceTypeBrowse(locInText, false, sessionBase, services, shortReply);
    }
    return startMediumFlow(
      first,
      {
        ...sessionBase,
        pendingMedia: [],
        medium: canonicalizeServiceName(first),
        browseToken: canonicalizeServiceName(first),
        // Pass locality when user typed it with the medium (DB may store it as city)
        area: locInText || sessionBase.area,
      },
      services,
      shortReply,
    );
  }

  // Single word that is a locality → types at that place (not "city for Saidapet")
  if (words.length === 1) {
    const token = words[0];
    const asLocality = detectLocalityInText(token, services);
    if (asLocality) {
      return startPlaceTypeBrowse(asLocality, false, sessionBase, services, shortReply);
    }
    if (filterByBrowseToken(services, token).length > 0) {
      return startMediumFlow(
        token,
        {
          ...sessionBase,
          medium: canonicalizeServiceName(token),
          browseToken: canonicalizeServiceName(token),
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }
  }

  // If first word is a catalog family, use medium flow
  if (words.length >= 1) {
    const familyTry = detectMediaLocal(words.join(' '), services);
    if (familyTry.length >= 2) {
      return startBatchMultiSelect(
        familyTry.map((m) => ({
          raw: m,
          token: m,
          qty,
          city,
        })),
        sessionBase,
        services,
        shortReply,
      );
    }
    if (familyTry.length === 1) {
      return startMediumFlow(
        familyTry[0],
        {
          ...sessionBase,
          medium: familyTry[0],
          browseToken: familyTry[0],
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }
  }

  // Fallback: word match against catalog
  const mediumHint = words[0] || prior?.medium;
  const matched = matchServices(
    services,
    words.length ? words : mediumHint ? [mediumHint] : [],
    city,
  );

  if (matched.length === 0) {
    const guess = bestFuzzyGuess(services, stripped || originalText, city);
    if (guess && guess.score >= 0.72) {
      const label = friendlyServiceLabel(guess.svc);
      return {
        step: 'did_you_mean',
        botText: shortReply || `Did you mean ${label}?`,
        options: [
          {
            id: 'yes',
            label: 'Yes',
            serviceId: guess.svc.service_id,
            city: extractRealCityFromDbService(guess.svc) || undefined,
          },
          { id: 'no', label: 'No' },
        ],
        session: {
          ...sessionBase,
          bestGuessServiceId: guess.svc.service_id,
          bestGuessLabel: label,
          medium: getMediumKey(guess.svc),
        },
      };
    }

    return softClarifyNeed(
      services,
      sessionBase,
      shortReply
        || (city
          ? `Sorry — nothing matched in ${city}. What do you mean?`
          : undefined),
    );
  }

  if (matched.length === 1) {
    return finalizeSelection([matched[0]], sessionBase, services);
  }

  const mediums = new Set(matched.map(getMediumKey).map(canonicalizeServiceName));
  if (!city && mediums.size === 1) {
    const medium = getMediumKey(matched[0]);
    return startMediumFlow(medium, { ...sessionBase, medium }, services, shortReply);
  }

  if (city) {
    const medium =
      (getMediumKey(matched[0]) || '').split(/\s+/)[0]
      || words[0]
      || sessionBase.medium
      || '';
    return startMediumFlow(
      medium,
      { ...sessionBase, medium },
      services,
      shortReply,
    );
  }

  return softClarifyNeed(services, sessionBase, shortReply);
}

function minQtyConfirmBotText(
  details: Array<{ service: string; requested: number; minimum: number }>,
  stillBelow = false,
): string {
  const tip = 'You can also tap the pencil to edit qty.';
  if (details.length === 1) {
    const d = details[0];
    if (stillBelow) {
      return `Still below minimum for ${d.service} (${d.minimum.toLocaleString()}). You entered ${d.requested.toLocaleString()}. Use ${d.minimum.toLocaleString()}, or edit qty again with the pencil.`;
    }
    return `Minimum quantity for ${d.service} is ${d.minimum.toLocaleString()}. You requested ${d.requested.toLocaleString()}. Use ${d.minimum.toLocaleString()} instead? ${tip}`;
  }
  if (stillBelow) {
    return `Some qtys are still below minimum. Use minimums, or edit again with the pencil.`;
  }
  return `Some services have minimum quantities. Use minimums instead? ${tip}`;
}

function minQtyConfirmOptions(): ProgressiveOption[] {
  return [
    { id: 'yes_min', label: 'Yes, use minimums' },
    { id: 'no_min', label: "No, I'll adjust" },
  ];
}

/**
 * Apply pencil-edited qtys on a min-qty card.
 * Still below min → same-card re-ask. All OK → quote_ready with edited qtys.
 */
export function resolveMinQtyEdits(
  session: ProgressiveSession,
  edits: Record<string, number>,
  currentDetails: Array<{ service: string; requested: number; minimum: number; serviceId?: string }>,
): ProgressiveTurnResult {
  const pending = [...(session.pendingRows || [])];
  const stillBelow: Array<{ service: string; requested: number; minimum: number; serviceId?: string }> = [];

  for (const d of currentDetails) {
    const key = d.serviceId || d.service;
    const edited = edits[key];
    const requested = edited != null && Number.isFinite(edited) && edited > 0
      ? Math.floor(edited)
      : d.requested;

    if (requested < d.minimum) {
      stillBelow.push({
        service: d.service,
        requested,
        minimum: d.minimum,
        serviceId: d.serviceId,
      });
      continue;
    }

    // Valid qty (≥ min) — write onto matching pending row
    const idx = pending.findIndex((r) =>
      (d.serviceId && r.serviceId === d.serviceId)
      || (!d.serviceId && r.service === d.service),
    );
    if (idx >= 0) {
      pending[idx] = { ...pending[idx], qty: requested };
    }
  }

  if (stillBelow.length > 0) {
    return {
      step: 'min_qty_confirm',
      botText: minQtyConfirmBotText(stillBelow, true),
      belowMinDetails: stillBelow,
      options: minQtyConfirmOptions(),
      session: {
        ...session,
        pendingRows: pending,
        collectedRows: pending,
      },
    };
  }

  return {
    step: 'quote_ready',
    botText: '',
    options: [],
    session: {
      ...session,
      pendingRows: pending,
      collectedRows: pending,
      pendingMedia: [],
      segments: undefined,
    },
    quoteRows: pending,
  };
}

function finalizeSelection(
  selected: DbService[],
  session: ProgressiveSession,
  services?: DbService[],
): ProgressiveTurnResult {
  const { rows, belowMin } = buildRowsForServices(
    selected,
    session.qty,
    session.durationText,
    session.originalText,
    session.qtyByServiceId,
  );

  const collectedRows = [...(session.collectedRows || []), ...rows];
  const collectedServiceIds = [
    ...(session.collectedServiceIds || []),
    ...selected.map((s) => s.service_id),
  ];

  // Batch multi-select already finished — never sequential "Next — pick"
  const isBatch = !!(session.segments && session.segments.length >= 2);

  const currentMed = canonicalizeServiceName(session.medium || getMediumKey(selected[0]) || '');
  const restMedia = isBatch
    ? []
    : (session.pendingMedia || []).filter(
        (m) => canonicalizeServiceName(m) !== currentMed,
      );

  // More media types left (legacy single-path multi only)
  if (restMedia.length > 0 && services) {
    return startMediumFlow(
      restMedia[0],
      {
        ...session,
        pendingMedia: restMedia.slice(1),
        collectedRows,
        collectedServiceIds,
        medium: canonicalizeServiceName(restMedia[0]),
        browseToken: canonicalizeServiceName(restMedia[0]),
        area: undefined,
        candidateServiceIds: undefined,
        pendingRows: undefined,
      },
      services,
      `Next — pick ${titleCase(restMedia[0])}${session.city ? ` in ${session.city}` : ''}:`,
    );
  }

  // Ask min-qty when user typed qty and any collected row is below DB minimum
  const anyExplicitQty =
    session.qty != null
    || Object.keys(session.qtyByServiceId || {}).length > 0;
  if (anyExplicitQty && restMedia.length === 0 && services) {
    const mergedRows = [...(session.collectedRows || []), ...rows];
    // Dedupe by serviceId keeping last
    const byId = new Map<string, ConfirmationRow>();
    for (const r of mergedRows) {
      if (r.serviceId) byId.set(r.serviceId, r);
      else byId.set(`${r.service}|${r.city}|${r.qty}`, r);
    }
    const allRows = [...byId.values()];
    const belowAll: Array<{ service: string; requested: number; minimum: number; serviceId?: string }> = [];
    const fixedRows = allRows.map((r) => {
      if (!r.serviceId) return r;
      const svc = services.find((s) => s.service_id === r.serviceId);
      if (!svc) return r;
      const minQty = getMinQuantityFromDbService(svc);
      const requested = typeof r.qty === 'number' ? r.qty : parseInt(String(r.qty), 10) || 0;
      const hasExplicit =
        session.qtyByServiceId?.[r.serviceId] != null
        || session.qty != null;
      if (hasExplicit && minQty && minQty > 1 && requested < minQty) {
        belowAll.push({
          service: (svc.service_name || '').split('·')[0].trim() || friendlyServiceLabel(svc),
          requested,
          minimum: minQty,
          serviceId: r.serviceId,
        });
        return { ...r, qty: minQty };
      }
      return r;
    });

    if (belowAll.length > 0) {
      return {
        step: 'min_qty_confirm',
        botText: minQtyConfirmBotText(belowAll),
        belowMinDetails: belowAll.map((b) => ({
          service: b.service,
          requested: b.requested,
          minimum: b.minimum,
          serviceId: b.serviceId,
        })),
        options: minQtyConfirmOptions(),
        session: {
          ...session,
          pendingRows: fixedRows,
          collectedRows: fixedRows,
          collectedServiceIds,
          candidateServiceIds: selected.map((s) => s.service_id),
        },
      };
    }

    return {
      step: 'quote_ready',
      botText: '',
      options: [],
      session: {
        ...session,
        pendingRows: allRows,
        collectedRows: allRows,
        collectedServiceIds,
        pendingMedia: [],
        segments: undefined,
      },
      quoteRows: allRows,
    };
  }

  if (anyExplicitQty && belowMin.length > 0 && restMedia.length === 0) {
    const fixedBatch = rows.map((r) => {
      const hit = belowMin.find((b) => b.svc.service_id === r.serviceId);
      return hit ? { ...r, qty: hit.minimum } : r;
    });
    const pendingRows = [
      ...(session.collectedRows || []),
      ...fixedBatch,
    ];
    const svcName = (svc: DbService) =>
      ((svc.service_name || '').split('·')[0] || friendlyServiceLabel(svc)).trim();
    return {
      step: 'min_qty_confirm',
      botText: minQtyConfirmBotText(
        belowMin.map((b) => ({
          service: svcName(b.svc),
          requested: b.requested,
          minimum: b.minimum,
        })),
      ),
      belowMinDetails: belowMin.map((b) => ({
        service: svcName(b.svc),
        requested: b.requested,
        minimum: b.minimum,
        serviceId: b.svc.service_id,
      })),
      options: minQtyConfirmOptions(),
      session: {
        ...session,
        pendingRows,
        collectedRows: pendingRows,
        collectedServiceIds,
        candidateServiceIds: selected.map((s) => s.service_id),
      },
    };
  }

  return {
    step: 'quote_ready',
    botText: '',
    options: [],
    session: {
      ...session,
      pendingRows: collectedRows,
      collectedRows,
      collectedServiceIds,
      pendingMedia: [],
      segments: undefined,
    },
    quoteRows: collectedRows,
  };
}

/**
 * Continue after chip / Yes-No selection.
 */
export function continueProgressiveAction(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  // Did you mean
  if (actionId === 'yes' && session.bestGuessServiceId) {
    const svc = services.find((s) => s.service_id === session.bestGuessServiceId);
    if (svc) return finalizeSelection([svc], session, services);
  }
  if (actionId === 'no') {
    return softClarifyNeed(services, session);
  }

  if (actionId === 'show_others') {
    return softClarifyNeed(
      services,
      session,
      "Sure — what do you mean? Which service and location do you need?",
    );
  }

  if (actionId === 'try_again') {
    return softClarifyNeed(services, session, 'Sure — type what you need.');
  }

  if (actionId === 'yes_min' && session.pendingRows?.length) {
    return {
      step: 'quote_ready',
      botText: '',
      options: [],
      session,
      quoteRows: session.pendingRows,
    };
  }

  if (actionId === 'no_min') {
    const minQty = session.pendingRows?.[0]?.qty;
    return {
      step: 'no_match',
      botText: `Please enter a qty of ${minQty || 'min'} or more.`,
      options: [],
      session: { ...session, pendingRows: undefined },
    };
  }

  // Combined City · Area / locality place pick — supports multi Confirm
  if (
    actionId.startsWith('place:')
    || (selectedIds?.length && selectedIds.every((id) => id.startsWith('place:') || id.startsWith('area:') || id.startsWith('city:')))
  ) {
    const ids = (selectedIds?.length ? selectedIds : [actionId]).filter((id) =>
      id.startsWith('place:') || id.startsWith('area:') || id.startsWith('city:'),
    );
    const token = session.browseToken || session.medium || '';
    const pool = filterForBrowseOrFamily(services, token);
    let allHits: DbService[] = [];
    let lastSession = session;

    for (const id of ids) {
      if (id.startsWith('city:')) {
        const city = titleCase(id.slice(5));
        const nextSession: ProgressiveSession = { ...session, city, area: undefined, browseToken: token, medium: session.medium || token };
        const cityHits = filterHitsBySessionLocation(pool, nextSession);
        // If only city and many have direction → keep accumulating; else accumulate
        for (const h of cityHits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      if (id.startsWith('area:')) {
        const areaKey = id.slice(5);
        const areaPool = session.city
          ? areasForMediumCity(services, token, session.city)
          : pool;
        const areaLabel =
          areaPool
            .map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s))
            .find((a) => a && canonicalizeServiceName(a) === areaKey)
          || titleCase(areaKey.replace(/-/g, ' '));
        const nextSession: ProgressiveSession = {
          ...session,
          area: areaLabel,
          browseToken: token,
          medium: session.medium || token,
        };
        const hits = filterHitsBySessionLocation(areaPool.length ? areaPool : pool, nextSession);
        for (const h of hits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      // place:
      const payload = id.slice(6);
      const pipe = payload.indexOf('|');
      const cityKey = pipe >= 0 ? payload.slice(0, pipe) : payload;
      const areaKey = pipe >= 0 ? payload.slice(pipe + 1) : '';
      const isLocality = cityKey === 'locality';
      const areaLabel =
        pool
          .map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s))
          .find((a) => a && canonicalizeServiceName(a) === areaKey)
        || titleCase(areaKey.replace(/-/g, ' '));
      let city: string | undefined;
      if (isLocality) {
        const localityHits = pool.filter((s) => {
          const loc = getLocalityFromMetaCity(s) || getAreaLabel(s);
          return loc && canonicalizeServiceName(loc) === areaKey;
        });
        city = (localityHits.length > 0 ? extractRealCityFromDbService(localityHits[0]) : null) || undefined;
        // Prefer matching by locality for hits
        const locHits = filterByLocality(pool, areaLabel);
        for (const h of locHits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
      } else {
        city = titleCase(cityKey);
        const nextSession: ProgressiveSession = {
          ...session,
          city,
          area: areaLabel,
          browseToken: token || session.browseToken,
          medium: session.medium || token,
        };
        const hits = filterHitsBySessionLocation(pool, nextSession);
        for (const h of hits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      lastSession = {
        ...session,
        city,
        area: areaLabel,
        browseToken: token || session.browseToken,
        medium: session.medium || token,
      };
    }

    // Single city chip → continue medium flow (may ask named areas, then direction)
    if (ids.length === 1 && ids[0].startsWith('city:')) {
      const city = titleCase(ids[0].slice(5));
      const nextSession: ProgressiveSession = { ...session, city, area: undefined };
      if (token) {
        return startMediumFlow(token, {
          ...nextSession,
          browseToken: token,
          medium: session.medium || token,
        }, services);
      }
      const types = mediumLabelsForCity(services, city);
      return {
      step: 'pick_type',
      botText: `Services in ${city} — pick a type:`,
      options: types,
      allowMulti: types.length > 1,
      session: nextSession,
    };
  }

  // Multi-place: if directions exist → direction picker for union
    if (ids.length > 1) {
      const withDir = allHits.filter((s) => !!getDirectionLabel(s));
      if (withDir.length > 1) {
        const where = lastSession.city || lastSession.area || 'selected areas';
        return buildDirectionPicker(withDir, { ...lastSession, candidateServiceIds: allHits.map((s) => s.service_id) }, where);
      }
      // One representative per unique medium+city+area group
      const reps = new Map<string, DbService>();
      for (const h of allHits) {
        const gk = `${canonicalizeServiceName(getMediumKey(h))}|${(getLocalityFromMetaCity(h) || getAreaLabel(h) || extractRealCityFromDbService(h) || '').toLowerCase()}`;
        if (!reps.has(gk)) reps.set(gk, h);
      }
      return finalizeSelection([...reps.values()], lastSession, services);
    }

    return afterLocationResolved(allHits, lastSession, services);
  }

  // City pick (single — multi already handled above when mixed with place/area)
  if (actionId.startsWith('city:') && !(selectedIds && selectedIds.length > 1)) {
    const city = titleCase(actionId.slice(5));
    const token = session.browseToken || session.medium || '';
    const nextSession: ProgressiveSession = { ...session, city, area: undefined };
    if (token) {
      return startMediumFlow(token, {
        ...nextSession,
        browseToken: token,
        medium: session.medium || token,
      }, services);
    }
    // City chosen without medium → show types in city
    const types = mediumLabelsForCity(services, city);
    return {
      step: 'pick_type',
      botText: `Services in ${city} — pick a type:`,
      options: types,
      allowMulti: types.length > 1,
      session: nextSession,
    };
  }

  // Area-only pick (after city) — single; multi handled in place block above
  if (actionId.startsWith('area:') && !(selectedIds && selectedIds.length > 1)) {
    const areaKey = actionId.slice(5);
    const token = session.browseToken || session.medium || '';
    const pool = session.city
      ? areasForMediumCity(services, token, session.city)
      : filterForBrowseOrFamily(services, token);
    const areaLabel =
      pool
        .map((s) => getAreaLabel(s))
        .find((a) => a && canonicalizeServiceName(a) === areaKey)
      || titleCase(areaKey.replace(/-/g, ' '));
    const nextSession: ProgressiveSession = {
      ...session,
      area: areaLabel,
      browseToken: token,
      medium: session.medium || token,
    };
    const hits = filterHitsBySessionLocation(pool.length ? pool : filterForBrowseOrFamily(services, token), nextSession);
    return afterLocationResolved(hits, nextSession, services);
  }

  // Medium / type chip (from city type list or catalog) — after location, narrow to type
  if (actionId.startsWith('medium:') || (selectedIds?.length && selectedIds.every((id) => id.startsWith('medium:')))) {
    // Collect all selected medium tokens (multi-select confirm may send several)
    // Tokens may be "Metro Station" or "Metro Station|elevated" (medium + medium_type).
    const allChips = (selectedIds?.length ? selectedIds : [actionId])
      .filter((id) => id.startsWith('medium:'))
      .map((id) => parseMediumChipToken(id.slice(7)));
    const primary = allChips[0];
    const primaryMedium = primary?.medium || '';
    const pending = session.pendingMedia || [];
    const nextSession: ProgressiveSession = {
      ...session,
      medium: canonicalizeServiceName(primaryMedium),
      mediumType: primary?.mediumType
        ? canonicalizeServiceName(primary.mediumType)
        : undefined,
      pendingMedia: pending.filter(
        (m) => !allChips.some((c) => canonicalizeServiceName(c.medium) === canonicalizeServiceName(m)),
      ),
    };

    // If location already chosen, filter candidates by exact medium(s) (+ medium_type)
    if (session.city || session.area || session.candidateServiceIds?.length) {
      const basePool = session.candidateServiceIds?.length
        ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
        : filterForBrowseOrFamily(services, session.browseToken || primaryMedium);
      const locPool = filterHitsBySessionLocation(basePool, nextSession);

      if (allChips.length > 1) {
        // Multi-medium confirm: collect reps for each medium(+type) and finalize together
        const allSelected: DbService[] = [];
        const seen = new Set<string>();
        for (const chip of allChips) {
          const use = locPool.filter((s) => serviceMatchesMediumChip(s, chip));
          for (const svc of use) {
            if (!seen.has(svc.service_id)) {
              seen.add(svc.service_id);
              allSelected.push(svc);
              break;
            }
          }
        }
        // If any selected medium still has multiple directions, ask direction first
        const withDir = allSelected.length
          ? locPool.filter((s) =>
              allChips.some((c) => serviceMatchesMediumChip(s, c))
              && !!getDirectionLabel(s),
            )
          : [];
        const uniqueDirs = new Set(withDir.map((s) => canonicalizeServiceName(getDirectionLabel(s) || '')));
        if (uniqueDirs.size > 1) {
          const where = [session.area, session.city].filter(Boolean).join(' · ') || 'that location';
          return buildDirectionPicker(withDir, { ...nextSession, candidateServiceIds: withDir.map((s) => s.service_id) }, where);
        }
        if (allSelected.length) return finalizeSelection(allSelected, nextSession, services);
      }

      const use = locPool.filter((s) => serviceMatchesMediumChip(s, primary!));
      if (use.length === 0) {
        // Stay scoped to this place's candidates — never dump the whole catalog
        const placePool = basePool.length ? basePool : locPool;
        const placeTypes = uniqueMediumLabelsWithExamples(placePool);
        const where = [session.area, session.city].filter(Boolean).join(' · ');
        if (placeTypes.length > 0) {
          return {
            step: 'pick_type',
            botText: `Nothing for ${titleCase(primaryMedium)}${where ? ` in ${where}` : ''}. Pick another type:`,
            options: placeTypes,
            allowMulti: placeTypes.length > 1,
            session: {
              ...nextSession,
              candidateServiceIds: placePool.map((s) => s.service_id),
            },
          };
        }
        return softClarifyNeed(
          services,
          nextSession,
          `Nothing for ${titleCase(primaryMedium)}${where ? ` in ${where}` : ''}.`,
        );
      }
      // Direction step when multiple direction_remarks (ECR / area browse → type → direction)
      const withDir = use.filter((s) => !!getDirectionLabel(s));
      const uniqueDirs = new Set(withDir.map((s) => canonicalizeServiceName(getDirectionLabel(s) || '')));
      if (uniqueDirs.size > 1) {
        const where = [session.area, session.city].filter(Boolean).join(' · ') || titleCase(primaryMedium);
        return buildDirectionPicker(withDir, { ...nextSession, candidateServiceIds: use.map((s) => s.service_id) }, where);
      }
      if (use.length === 1) return finalizeSelection(use, nextSession, services);
      const products = uniqueProductOptions(use);
      if (products.length > 1) {
        return {
          step: 'related_services',
          botText: `Which ${titleCase(primaryMedium)}?`,
          options: products,
          allowMulti: true,
          session: {
            ...nextSession,
            candidateServiceIds: use.map((s) => s.service_id),
          },
        };
      }
      return finalizeSelection(use, nextSession, services);
    }

    // No location yet — ask city+area for this type
    return startMediumFlow(primaryMedium, {
      ...nextSession,
      browseToken: canonicalizeServiceName(primaryMedium),
    }, services);
  }

  // Product chip without serviceId — resolve by label against candidates (multi-select ok)
  if (actionId.startsWith('product:') || (selectedIds?.length && selectedIds.every((id) => id.startsWith('product:')))) {
    const keys = (selectedIds?.length ? selectedIds : [actionId])
      .filter((id) => id.startsWith('product:'))
      .map((id) => id.slice(8));
    const pool = session.candidateServiceIds?.length
      ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
      : services;
    const hits = pool.filter((s) => {
      const label = canonicalizeServiceName((s.service_name || '').split('·')[0] || '');
      return keys.some((key) => label === key || label.includes(key) || key.includes(label));
    });
    if (hits.length === 0) {
      return softPickTypes(
        services,
        session,
        session.city,
        'Nothing matched. Pick a type:',
      );
    }
    if (keys.length > 1) {
      // One rep per product key
      const reps: DbService[] = [];
      const seen = new Set<string>();
      for (const key of keys) {
        const match = hits.find((s) => {
          const label = canonicalizeServiceName((s.service_name || '').split('·')[0] || '');
          return label === key || label.includes(key) || key.includes(label);
        });
        if (match && !seen.has(match.service_id)) {
          seen.add(match.service_id);
          reps.push(match);
        }
      }
      if (reps.length) return finalizeSelection(reps, session, services);
    }
    // Need city?
    if (!session.city) {
      const cities = new Set(
        hits.map((s) => extractRealCityFromDbService(s)).filter(Boolean) as string[],
      );
      if (cities.size >= 1) {
        const medium = getMediumKey(hits[0]);
        const family = (medium || '').split(/\s+/)[0] || medium;
        return {
          step: 'pick_city',
          botText: `Which city for ${titleCase(family || medium)}?`,
          options: [...cities].sort().map((c) => ({
            id: `city:${c.toLowerCase()}`,
            label: c,
            city: c,
            medium: family || medium,
          })),
          allowMulti: true,
          session: { ...session, medium: family || medium, candidateServiceIds: hits.map((s) => s.service_id) },
        };
      }
    }
    const city = session.city;
    const cityHits = city
      ? hits.filter((s) => (extractRealCityFromDbService(s) || '').toLowerCase() === city.toLowerCase())
      : hits;
    const use = cityHits.length ? cityHits : hits;
    const withAreas = use.filter((s) => {
      const a = getAreaLabel(s);
      return !!a && !isNumericOnlyLabel(a);
    });
    if (withAreas.length > 1) {
      return {
        step: 'pick_area',
        botText: `Nice — ${(city || extractRealCityFromDbService(use[0]) || '')} ${titleCase(getMediumKey(use[0]))}. Which area?`,
        options: uniqueServiceOptions(withAreas),
        allowMulti: true,
        session: { ...session, medium: getMediumKey(use[0]), candidateServiceIds: withAreas.map((s) => s.service_id) },
      };
    }
    const withDir = use.filter((s) => !!getDirectionLabel(s));
    if (withDir.length > 1 && withAreas.length <= 1) {
      return buildDirectionPicker(withDir, session, city || session.area || '');
    }
    if (use.length > 1) {
      return {
        step: 'related_services',
        botText: 'Sure — related options:',
        options: uniqueServiceOptions(use),
        allowMulti: true,
        session: { ...session, medium: getMediumKey(use[0]), candidateServiceIds: use.map((s) => s.service_id) },
      };
    }
    return finalizeSelection(use, session, services);
  }

  // Direction pick — single or multi confirm
  if (actionId.startsWith('direction:') || (selectedIds?.length && selectedIds[0]?.startsWith('direction:'))) {
    const ids = selectedIds?.length
      ? selectedIds.map((id) => id.startsWith('direction:') ? id.slice(10) : id)
      : [actionId.slice(10)];
    const selected = services.filter((s) => ids.includes(s.service_id));
    if (selected.length) return finalizeSelection(selected, session, services);
  }

  // Batch-group confirm: each selectedId is "batch-group:id1,id2,..."
  const hasBatchGroup = (selectedIds || [actionId]).some((id) => id.startsWith('batch-group:'));
  if (hasBatchGroup) {
    const pickedIds: string[] = [];
    for (const id of (selectedIds || [actionId])) {
      if (id.startsWith('batch-group:')) {
        pickedIds.push(...id.slice(12).split(',').filter(Boolean));
      } else {
        pickedIds.push(id);
      }
    }
    const picked = services.filter((s) => pickedIds.includes(s.service_id));
    if (!picked.length) {
      // Only autos — finalize those
      const autoOnly = services.filter((s) => (session.collectedServiceIds || []).includes(s.service_id));
      const autoRepMap = new Map<string, DbService>();
      for (const svc of autoOnly) {
        const gk = batchGroupKey(svc);
        if (!autoRepMap.has(gk)) autoRepMap.set(gk, svc);
      }
      if (autoRepMap.size) {
        return finalizeSelection([...autoRepMap.values()], {
          ...session,
          collectedRows: session.collectedRows, // already built
          collectedServiceIds: [], // rows already collected — avoid double-merge of ids into confusion
        }, services);
      }
      return {
        step: 'no_match',
        botText: 'Sure — type what you need.',
        options: [],
        session,
      };
    }

    // Same path as single-medium: medium chips → product chips (Elevated / Train
    // Inside / Wrap) → direction → quote. Do not finalize one metro rep early.
    const place =
      getLocalityFromMetaCity(picked[0])
      || extractRealCityFromDbService(picked[0])
      || session.city
      || 'that location';
    const areaRaw = getMetaAreaRaw(picked[0]);
    return afterLocationResolved(
      picked,
      {
        ...session,
        city: extractRealCityFromDbService(picked[0]) || session.city,
        area:
          getLocalityFromMetaCity(picked[0])
          || (areaRaw && !isNumericOnlyLabel(areaRaw) ? areaRaw : undefined)
          || session.area,
        browseToken: canonicalizeServiceName(getMediumKey(picked[0]) || session.browseToken || ''),
        medium: getMediumKey(picked[0]) || session.medium,
        candidateServiceIds: picked.map((s) => s.service_id),
      },
      services,
      `In ${place} — which type?`,
    );
  }

  // Direct service_id selection (area chips) — multi
  if (selectedIds && selectedIds.length > 0) {
    const selected = services.filter((s) => selectedIds.includes(s.service_id));
    if (selected.length) return finalizeSelection(selected, session, services);
  }

  const byId = services.find((s) => s.service_id === actionId);
  if (byId) return finalizeSelection([byId], session, services);

  return {
    step: 'no_match',
    botText: 'Sure — type what you need.',
    options: [],
    session,
  };
}
