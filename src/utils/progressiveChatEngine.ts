/**
 * Progressive quote chat — DB-backed matching with short friendly replies.
 * AI (optional) only helps parse intent; prices/services always come from DB.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * STRICT FUNNEL RULES (mandatory — do not weaken these without product sign-off)
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. Order: Service → Type → City → Area → Direction → Quote
 *    (Type ALWAYS before City — never ask city first then type then city again)
 * 2. City UI: when 2+ cities/places → checkbox multi-select (allowMulti=true) + Confirm
 * 3. Exactly 1 city → Yes/No Continue ("We currently offer … in X only") — never silent
 * 4. 0 / NA city → skip city step
 * 5. Multi-city Confirm → ONE quote with one line per selected city (when each resolves);
 *    otherwise workQueue until all collected, then one quote_ready — never orphan "Next"
 * 6. detectCityInText = known metros only (never Padur/Vadapalani/Hosur as typed "city")
 * 7. Service + locality in text (e.g. "near omr hoarding") → set area, needsContinueConfirm;
 *    after Type → Continue for that place’s city only — never reopen full city list /
 *    never offer Coimbatore when place is OMR/Chennai; keep area; skip area re-ask
 * 8. Locking mediumType (type chip) MUST preserve city / area / placeHint / candidates
 * 9. Changing medium (new service chip) MAY clear stale area/place/candidates
 * 10. City chip pool MUST use same medium (+ mediumType if locked) filters as matching
 * 11. Direction: ask when 2+ distinct direction_remarks
 * 12. Family tokens (bus/led/booth/metro): ask which catalog type before city;
 *     never match via substring in direction / long service_name lines
 *     "led" clarify also lists Non LED siblings (Mobile Van Non LED)
 * 13. Continue Yes/No: keep needsContinueConfirm until Yes — never quote without click
 * 14. City match = metadata.city / locations / metro / locality-as-city (serviceMatchesCityLabel)
 * 15. Place/area filters NEVER use direction_remarks — "TOWARDS VADAPALANI" ≠ Vadapalani;
 *     direction_remarks only for Direction step + detectDirectionInText (multi-word sites)
 * 16. Batch: Metro CITY chips = known metros only; Bus Shelter keeps locality chips
 *     (Anna Nagar). Metro Type = Station Elevated/Underground + Train Inside + Train Wrap
 * ═══════════════════════════════════════════════════════════════════════════
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
  /** Selected DB medium_type (elevated / underground / Nonlit …) after type chip. */
  mediumType?: string;
  /** Browse token from user text (bus, shelter, led) — broader than one medium key. */
  browseToken?: string;
  city?: string;
  area?: string;
  /**
   * Site / direction phrase from free text (e.g. "Gemini Flyover").
   * Used to narrow pool before asking Service → Type → City → Area.
   */
  directionHint?: string;
  /** Confirmed place hint from Did-you-mean (e.g. Gandhi Nagar) for batch/area. */
  placeHint?: string;
  qty: number | null;
  durationText?: string | null;
  candidateServiceIds?: string[];
  bestGuessServiceId?: string;
  bestGuessLabel?: string;
  /** Did-you-mean target: place name or service medium. */
  bestGuessKind?: 'place' | 'service';
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
  /**
   * Remaining cities to process sequentially after multi-city Confirm
   * (area → direction for each).
   */
  pendingCityQueue?: string[];
  /**
   * Remaining batch work items (service + city) after multi-select Confirm.
   */
  workQueue?: Array<{
    medium: string;
    browseToken?: string;
    qty: number | null;
    city?: string;
    candidateServiceIds?: string[];
  }>;
  /**
   * Place-only browse (e.g. "hosur"/"madurai") — block silent quote finalize
   * until the user picks a service chip or Continue.
   */
  needsContinueConfirm?: boolean;
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

/** Long road / direction-style labels — not city or area chips. */
function isDirectionLikeLabel(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (/\b(towards|toward|opp\.?|opposite)\b/i.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 6) return true;
  if ((t.match(/,/g) || []).length >= 1 && words.length >= 4) return true;
  return false;
}

/**
 * City for funnel chips — metadata.city as stored (Pallavaram, Chennai, …).
 * Does not require KNOWN_CITY_LIST. Skips NA / direction-like junk.
 */
export function getDbCityLabel(svc: DbService): string | null {
  const raw = getMetaCityRaw(svc);
  if (!raw || isNumericOnlyLabel(raw) || isDirectionLikeLabel(raw)) return null;
  // Prefer known metro spelling when applicable
  const known = matchKnownCityLabel(raw);
  if (known) return known;
  return titleCase(raw);
}

/**
 * When vendor rows put a locality in metadata.city (Padur, Vadapalani…)
 * instead of a metro, return that locality.
 * @deprecated Prefer getDbCityLabel for city chips; kept for locality browse.
 */
function getLocalityFromMetaCity(svc: DbService): string | null {
  const raw = getMetaCityRaw(svc);
  if (!raw) return null;
  if (matchKnownCityLabel(raw)) return null;
  if (isDirectionLikeLabel(raw)) return null;
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

/** Distinct cities for funnel — raw DB city values. */
export function getCatalogCities(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const s of services) {
    const c = getDbCityLabel(s) || extractRealCityFromDbService(s);
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

export function detectCityInText(text: string, _services?: DbService[]): string | null {
  const lower = text.toLowerCase();
  // Known metros only — do NOT use getCatalogCities (Padur/Vadapalani/Hosur are areas)
  const keys = [...REAL_CITY_KEYS].sort((a, b) => b.length - a.length);
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
    // NEVER index direction_remarks — "TOWARDS VADAPALANI" must not create a Vadapalani place.
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
  // Fallback: single query word appears inside area / locality only (never direction_remarks).
  // Prefer the FULL place label (Gandhi Nagar), never return the partial word alone.
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 4) return null;
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const exact = new Set<string>();
    const partial = new Set<string>();
    for (const s of services) {
      const area = getMetaAreaRaw(s) || getLocalityFromMetaCity(s);
      if (area && re.test(area)) {
        if (canonicalizeServiceName(area) === w) exact.add(titleCase(area));
        else partial.add(titleCase(area));
      }
    }
    if (exact.size === 1) return [...exact][0];
    if (exact.size === 0 && partial.size === 1) return [...partial][0];
    return null;
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
    // Place match = area / locality / city only — NEVER direction_remarks
    // ("…TOWARDS VADAPALANI" ≠ service in Vadapalani)
    return label === a || loc === a || meta === a || area === a
      || aRe.test(label) || aRe.test(loc) || aRe.test(meta) || aRe.test(area);
  });
}

/** Locality-only (or metro-only) → funnel asks City (if many) → Service → Type → … */
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
  if (!hits.length) {
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
  // Multi-city for this place → ask immediately
  if (!isMetroCity) {
    const cities = [
      ...new Set(
        hits
          .map((h) => getDbCityLabel(h) || extractRealCityFromDbService(h))
          .filter(Boolean) as string[],
      ),
    ];
    if (cities.length > 1) {
      const cityOpts = cities.sort().map((c) => ({
        id: `city:${c.toLowerCase()}`,
        label: c,
        city: c,
      }));
      return {
        step: 'pick_city',
        botText: reply || `${place} is in more than one city. Which city?`,
        options: cityOpts,
        allowMulti: true, // RULE 2
        session: {
          ...session,
          area: place,
          placeHint: place,
          pendingMedia: [],
          candidateServiceIds: hits.map((s) => s.service_id),
        },
      };
    }
    // Exactly 1 (or 0) city — do NOT silent-set; advanceFunnel confirms 1-city
  }

  return advanceFunnel(
    {
      ...session,
      // Only set city when user typed a known metro; localities (Hosur, Padur…) stay as area
      city: isMetroCity ? place : session.city,
      area: isMetroCity ? session.area : place,
      placeHint: isMetroCity ? session.placeHint : place,
      pendingMedia: [],
      candidateServiceIds: hits.map((s) => s.service_id),
      // Starting a new free-text place browse — drop leftover multi-city / batch queues
      needsContinueConfirm: true,
      pendingCityQueue: undefined,
      workQueue: undefined,
      collectedRows: [],
      collectedServiceIds: [],
    },
    services,
    reply || `We provide these services in ${place}. Which one do you want?`,
  );
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
 * DB medium_type for funnel Type step only.
 * Uses explicit metadata — never display-name / building-name fallbacks.
 */
const REAL_MEDIUM_TYPE_TOKENS = new Set([
  'lit', 'nonlit', 'non lit', 'non-led', 'non led', 'led', 'lcd', 'digital', 'static',
  'elevated', 'underground', 'interior', 'inside', 'outside', 'wrap', 'platform',
  'lobby', 'full', 'semi', 'premium', 'standard', 'basic',
  'train', 'train inside', 'train interior',
]);

export function getMediumTypeFromDb(svc: DbService): string | null {
  const meta = svc.metadata as {
    medium_type?: string;
    mediumType?: string;
    type_of_medium?: string;
  } | undefined;
  const raw = String(
    meta?.medium_type
      || meta?.mediumType
      || meta?.type_of_medium
      || '',
  ).trim();
  if (!raw || raw.toUpperCase() === 'NA') {
    // Only known tokens from service_id / safe name tokens — never free-text suffixes
    const fromSid = extractMediumTypeFromServiceId(svc.service_id, svc.service_name);
    if (fromSid) {
      const sidKey = canonicalizeServiceName(fromSid);
      if (
        REAL_MEDIUM_TYPE_TOKENS.has(sidKey)
        || [...REAL_MEDIUM_TYPE_TOKENS].some((t) => sidKey === t || sidKey.includes(t))
      ) {
        return titleCase(fromSid);
      }
    }
    return null;
  }
  const cleaned = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const key = canonicalizeServiceName(cleaned);
  // Reject place / building names stored wrongly as medium_type
  if (isDirectionLikeLabel(cleaned) || cleaned.split(/\s+/).length > 3) return null;
  if (
    REAL_MEDIUM_TYPE_TOKENS.has(key)
    || [...REAL_MEDIUM_TYPE_TOKENS].some((t) => key === t || key.includes(t))
  ) {
    return titleCase(cleaned);
  }
  return null;
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

/** True when service belongs to the given city (label, metro, or locations). */
function serviceMatchesCityLabel(svc: DbService, city: string): boolean {
  const c = city.toLowerCase().trim();
  if (!c) return false;
  const candidates = [
    getDbCityLabel(svc),
    extractRealCityFromDbService(svc),
    getMetaCityRaw(svc),
    getLocalityFromMetaCity(svc),
    ...((svc.metadata?.locations || []) as string[]),
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase().trim());
  return candidates.some((l) => l === c);
}

function filterByCity(services: DbService[], city: string | null): DbService[] {
  if (!city) return services;
  return services.filter((s) => serviceMatchesCityLabel(s, city));
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

/** True when word is a catalog medium / first token (metro, bus, hoarding…). */
function isCatalogMediumToken(word: string, services: DbService[]): boolean {
  const w = canonicalizeServiceName(word);
  if (!w || w.length < 2) return false;
  return getCatalogTypeKeys(services).some((m) => {
    const key = canonicalizeServiceName(m);
    return key === w || key.startsWith(`${w} `) || key.split(/\s+/)[0] === w;
  });
}

function filterByBrowseToken(services: DbService[], token: string): DbService[] {
  const variants = browseTokenVariants(token);
  if (!variants.length) return [];
  const res = variants.map(
    (v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i'),
  );
  // Short family tokens (metro, bus) — ONLY match medium / id / short name head.
  // Never scan long service_name lines that embed "Metro Station" in a bus-shelter title.
  const tok = canonicalizeServiceName(token);
  const shortFamily = tok.split(/\s+/).length === 1 && tok.length <= 8;
  return services.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    if (res.some((re) => re.test(med))) return true;
    const sid = canonicalizeServiceName(s.service_id || '');
    if (res.some((re) => re.test(sid))) return true;
    const nameRaw = (s.service_name || '').split(/[·—–|]/)[0] || '';
    const name = canonicalizeServiceName(nameRaw);
    if (shortFamily) {
      // First 3 tokens only ("metro station elevated", not full direction-in-name)
      const head = name.split(/\s+/).slice(0, 3).join(' ');
      return res.some((re) => re.test(head));
    }
    return res.some((re) => re.test(name));
  });
}

/** Prefer browse hits; fall back to strict family for exact medium chips. */
function filterForBrowseOrFamily(services: DbService[], token: string): DbService[] {
  const browse = filterByBrowseToken(services, token);
  const family = filterByMediumFamily(services, token);
  let hits = browse.length ? browse : family;
  const t = canonicalizeServiceName(token);
  // "metro" also covers Train Inside / Train Wrap (may not contain the word metro)
  if (t === 'metro' || t.startsWith('metro ')) {
    hits = mergeMetroFamilyServices(services, hits);
  }
  return hits;
}

/** Train Inside / Train Wrap + Metro Station variants under the metro family. */
function isMetroFamilyHay(hay: string): boolean {
  const h = canonicalizeServiceName(hay);
  if (/\bmetro\b/.test(h)) return true;
  if (/\btrain\s+inside\b/.test(h) || /\btrain\s+wrap\b/.test(h)) return true;
  if (/\btrain\b/.test(h) && /\b(inside|wrap)\b/.test(h)) return true;
  return false;
}

function mergeMetroFamilyServices(services: DbService[], base: DbService[]): DbService[] {
  const map = new Map(base.map((s) => [s.service_id, s]));
  for (const s of services) {
    if (map.has(s.service_id)) continue;
    const hay = `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|/]/)[0] || ''} ${s.service_id || ''}`;
    if (isMetroFamilyHay(hay)) map.set(s.service_id, s);
  }
  return [...map.values()];
}

function isMetroSegmentToken(token: string): boolean {
  const t = canonicalizeServiceName(token);
  return t === 'metro' || t.startsWith('metro ') || t === 'train' || t.startsWith('train ');
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

  // "metro" segment → include Train Inside / Train Wrap even without the word "metro"
  if (isMetroSegmentToken(words.join(' ')) || isMetroSegmentToken(token)) {
    hits = mergeMetroFamilyServices(services, hits);
    if (city) {
      const c = city.toLowerCase();
      hits = hits.filter((s) => {
        const real = (extractRealCityFromDbService(s) || '').toLowerCase();
        const loc = (getLocalityFromMetaCity(s) || '').toLowerCase();
        return !c || real === c || loc === c || !real;
      });
    }
  }
  return hits;
}

/**
 * Split "50 bus semi and 10 bus shelter and auto 100" into qty+token segments.
 * Returns [] when the message is not a multi-service list.
 * Unknown short tokens (e.g. trailing "gandhi") are omitted from segments
 * and returned via extractBatchPlaceHint().
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
    // Unmatched short place-like token (gandhi) — skip as service segment
    if (isShortAmbiguousQuery(stripped) && !qty) continue;
    // Keep phrase so batch UI can still try fuzzy browse
    segments.push({ raw: part, token, qty, city });
  }
  return segments.length >= 2 ? segments : [];
}

/** Trailing / unmatched short place hint from a multi-service message (e.g. "… and gandhi"). */
export function extractBatchPlaceHint(text: string, services: DbService[]): string | null {
  const normalized = normalizeSegmentPhrase(text);
  const parts = normalized
    .split(/\s*(?:\band\b|,|&|\+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  for (const part of parts) {
    const city = detectCityInText(part, services);
    const qty = parseQtyFromText(part);
    const stripped = stripQtyCityDuration(part, city);
    if (qty || !isShortAmbiguousQuery(stripped)) continue;
    if (matchSegmentHits(services, canonicalizeServiceName(stripped), city).length > 0) continue;
    if (detectMediaLocal(stripped, services).length > 0) continue;
    const place = suggestPartialPlace(stripped, services) || detectLocalityInText(stripped, services);
    if (place) return place;
    if (suggestPartialService(stripped, services)) continue;
  }
  return null;
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
    const metroSeg = isMetroSegmentToken(seg.token);
    // Expand metro family (Train Inside / Train Wrap) into segment hits
    const segHits = metroSeg ? mergeMetroFamilyServices(services, hits) : hits;

    // Metro: city chips = known metros only (Chennai).
    // Bus Shelter / site media: keep locality chips (Anna Nagar) — do NOT auto-collapse to Chennai.
    const realCitiesOnHits = [
      ...new Set(
        segHits
          .map((h) => extractRealCityFromDbService(h))
          .filter(Boolean) as string[],
      ),
    ];
    const soleRealCity = realCitiesOnHits.length === 1 ? realCitiesOnHits[0] : null;

    const displayPlaceKeys = new Set<string>();
    const hitPlaces: Array<{ h: DbService; displayPlace: string | null; cityLabel: string | null }> = [];
    for (const h of segHits) {
      const realCity = extractRealCityFromDbService(h);
      let displayPlace: string | null = null;
      if (metroSeg) {
        displayPlace = realCity || soleRealCity || null;
      } else {
        // Locality / place-first for shelters etc.
        const loc = getLocalityFromMetaCity(h);
        const areaRaw = getMetaAreaRaw(h);
        const areaOk =
          areaRaw
          && !isNumericOnlyLabel(areaRaw)
          && !isDirectionLikeLabel(areaRaw)
          && areaRaw.split(/\s+/).length <= 4
            ? areaRaw
            : null;
        displayPlace = loc || areaOk || realCity || soleRealCity || null;
      }
      if (displayPlace) displayPlaceKeys.add(canonicalizeServiceName(displayPlace));
      hitPlaces.push({ h, displayPlace, cityLabel: displayPlace });
    }
    const singlePlace = displayPlaceKeys.size <= 1;

    for (const { h, displayPlace } of hitPlaces) {
      if (!displayPlace) continue;
      const gk = `${canonicalizeServiceName(seg.token)}|${canonicalizeServiceName(displayPlace)}`;
      if (!groups.has(gk)) {
        groups.set(gk, {
          rep: h,
          ids: [],
          qty: seg.qty ?? null,
          cityLabel: displayPlace,
          segmentName: segName,
          medium: getMediumKey(h),
          // Never auto-resolve metro city; shelters with 2+ places stay pickable
          autoResolved: !metroSeg && singlePlace && displayPlaceKeys.size === 1,
        });
      }
      const g = groups.get(gk)!;
      if (!g.ids.includes(h.service_id)) g.ids.push(h.service_id);
      if (seg.qty != null && seg.qty > 0) {
        for (const id of g.ids) qtyByServiceId[id] = seg.qty;
      }
    }

    if (displayPlaceKeys.size === 0 && segHits.length > 0) {
      const gk = `${canonicalizeServiceName(seg.token)}|_pending`;
      groups.set(gk, {
        rep: segHits[0],
        ids: segHits.map((h) => h.service_id),
        qty: seg.qty ?? null,
        cityLabel: null,
        segmentName: segName,
        medium: getMediumKey(segHits[0]),
        autoResolved: false,
      });
      for (const id of segHits.map((h) => h.service_id)) {
        if (seg.qty != null && seg.qty > 0) qtyByServiceId[id] = seg.qty;
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
      ? `Which city for ${pickSegNamesList[0]}? Pick one or more, then Confirm:`
      : `These need a city — pick one or more, then Confirm:`;
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

  const nameHeadOf = (s: DbService): string => {
    const name = canonicalizeServiceName((s.service_name || '').split(/[·—–|/]/)[0] || '');
    return name.split(/\s+/).slice(0, 4).join(' ');
  };

  /** Strip led / non led so "mobile van led" and "mobile van non led" share a base. */
  const ledProductBase = (medium: string): string =>
    canonicalizeServiceName(medium)
      .replace(/\bnon\s*led\b/g, ' ')
      .replace(/\bled\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  let matchedSvcs = scoped.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    const nameHead = nameHeadOf(s);
    const hay = `${med} ${nameHead}`;
    if (words.length > 1) {
      return words.every((w) => hay.includes(w));
    }
    // Primary pass: "led" must not match "non led"
    if (h === 'led' && /\bnon\s*led\b/.test(hay)) return false;
    const mType = canonicalizeServiceName(getMediumTypeFromDb(s) || '');
    const hayFull = `${hay} ${mType}`;
    return new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hayFull);
  });

  // "led" clarify: also offer Non LED siblings of the same product (Mobile Van Non LED)
  if (h === 'led' && matchedSvcs.length > 0) {
    const bases = new Set(
      matchedSvcs
        .map((s) =>
          ledProductBase(
            `${getMediumKey(s)} ${getMediumTypeFromDb(s) || ''}`,
          ),
        )
        .filter((b) => b.length >= 3),
    );
    const seen = new Set(matchedSvcs.map((s) => s.service_id));
    for (const s of scoped) {
      if (seen.has(s.service_id)) continue;
      const med = canonicalizeServiceName(getMediumKey(s));
      const mType = canonicalizeServiceName(getMediumTypeFromDb(s) || '');
      const hay = `${med} ${nameHeadOf(s)} ${mType}`;
      if (!/\bnon\s*led\b/.test(hay)) continue;
      const base = ledProductBase(`${getMediumKey(s)} ${mType}`);
      if (!base) continue;
      const ok =
        bases.has(base)
        || [...bases].some(
          (b) =>
            base === b
            || base.startsWith(`${b} `)
            || b.startsWith(`${base} `)
            || isSameMediumFamily(base, b)
            || isSameMediumFamily(b, base),
        );
      if (!ok) continue;
      seen.add(s.service_id);
      matchedSvcs = [...matchedSvcs, s];
    }
  }

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
  return uniqueMediumOnlyOptions(filterByCity(services, city));
}

/** Size/finish style tokens — same family as "bus full", not different products like "bus stand". */
const MEDIUM_STYLE_TOKENS = new Set([
  'full', 'semi', 'branding', 'wrap', 'wrapping', 'panel', 'back', 'front',
  'interior', 'exterior', 'non', 'led', 'lcd', 'digital', 'static', 'premium',
  'standard', 'basic', 'partial', 'complete', 'side', 'rear', 'top', 'outside',
  'elevated', 'underground', 'train', 'inside', 'platform',
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
      city: getDbCityLabel(s) || extractRealCityFromDbService(s) || undefined,
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
    const c = getDbCityLabel(s) || extractRealCityFromDbService(s);
    if (c) cities.add(c);
  }
  return [...cities]
    .sort()
    .map((c) => ({ id: `city:${c.toLowerCase()}`, label: c, city: c, medium }));
}

function areasForMediumCity(services: DbService[], medium: string, city: string): DbService[] {
  const c = city.toLowerCase();
  return filterForBrowseOrFamily(services, medium).filter((s) => {
    const db = (getDbCityLabel(s) || '').toLowerCase();
    if (db === c) return true;
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
    const area = getFunnelAreaLabel(s);
    if (!area) continue;
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

/** After location narrowed: continue strict funnel Service → Type → City → Area → Direction. */
function afterLocationResolved(
  hits: DbService[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  return advanceFunnel(
    {
      ...session,
      candidateServiceIds: hits.length
        ? hits.map((s) => s.service_id)
        : session.candidateServiceIds,
    },
    services,
    reply,
  );
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
  const mediumName = titleCase(getMediumKey(hits[0]) || session.medium || 'service');
  return {
    step: 'pick_direction',
    botText: `Which direction in ${locationLabel || 'that area'} for ${mediumName}?`,
    options,
    allowMulti: true,
    session: {
      ...session,
      medium: getMediumKey(hits[0]) || session.medium,
      candidateServiceIds: hits.map((s) => s.service_id),
    },
  };
}

/** Service chips only (medium) — Type is a separate funnel step. */
function uniqueMediumOnlyOptions(services: DbService[]): ProgressiveOption[] {
  const map = new Map<string, ProgressiveOption>();
  for (const s of services) {
    const medium = getMediumKey(s);
    if (!medium) continue;
    const key = canonicalizeServiceName(medium);
    if (!key || map.has(key)) continue;
    map.set(key, {
      id: `medium:${medium}`,
      label: titleCase(medium),
      medium,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** medium_type chips for a selected service (Nonlit / Lit / Elevated …). */
function uniqueTypeOnlyOptions(services: DbService[], medium: string): ProgressiveOption[] {
  const want = canonicalizeServiceName(medium);
  const family = want.split(/\s+/).filter(Boolean)[0] || want;
  const map = new Map<string, ProgressiveOption>();
  for (const s of services) {
    const mk = canonicalizeServiceName(getMediumKey(s));
    if (!mk) continue;
    // "metro station" types + sibling "metro wrap" / "metro train inside" under family "metro"
    const mediumOk =
      mk === want
      || isSameMediumFamily(mk, want)
      || (family.length >= 3 && (isSameMediumFamily(mk, family) || mk.startsWith(`${family} `)));
    if (!mediumOk) continue;
    const mType = getMediumTypeFromDb(s);
    if (!mType) continue;
    const key = canonicalizeServiceName(mType);
    if (map.has(key)) continue;
    map.set(key, {
      id: `medium:${medium}|${key}`,
      label: titleCase(mType),
      medium,
      mediumType: mType,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function uniqueCityOptionsFromPool(services: DbService[], medium?: string): ProgressiveOption[] {
  const map = new Map<string, ProgressiveOption>();
  for (const s of services) {
    const raw = getDbCityLabel(s);
    const real = extractRealCityFromDbService(s);
    const locality = getLocalityFromMetaCity(s);
    // Prefer known metro; else raw city; else locality-as-city (apartment Padur/Hosur)
    const city =
      (raw && matchKnownCityLabel(raw) ? matchKnownCityLabel(raw) : null)
      || real
      || (raw && !isDirectionLikeLabel(raw) ? raw : null)
      || locality;
    if (!city) continue;
    const key = city.toLowerCase();
    if (map.has(key)) continue;
    map.set(key, {
      id: `city:${key}`,
      label: city,
      city,
      medium,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Area chips — raw area_name from DB (long site lines OK; duplicates with direction OK). */
function getFunnelAreaLabel(svc: DbService): string | null {
  const raw = getMetaAreaRaw(svc);
  if (!raw || isNumericOnlyLabel(raw)) return null;
  return raw;
}

function uniqueAreaOptionsFromPool(
  services: DbService[],
  city: string | undefined,
  medium?: string,
): ProgressiveOption[] {
  const scoped = city
    ? services.filter((s) => serviceMatchesCityLabel(s, city))
    : services;
  const map = new Map<string, ProgressiveOption>();
  for (const s of scoped) {
    const area = getFunnelAreaLabel(s);
    if (!area) continue;
    const key = canonicalizeServiceName(area);
    if (map.has(key)) continue;
    map.set(key, {
      id: `area:${key}`,
      label: area,
      city,
      medium,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Match free text against direction_remarks (multi-word sites like "Gemini Flyover").
 * Prefers longest / strongest phrase match.
 */
export function detectDirectionInText(
  text: string,
  services: DbService[],
): { phrase: string; serviceIds: string[]; city?: string; area?: string } | null {
  const lower = text.toLowerCase().trim();
  if (lower.length < 4) return null;

  // "metro" / "bus" / "led" → service flow, never steal a direction that mentions the word
  const bareWords = extractQueryWords(lower).filter((w) => !STOP_WORDS.has(w));
  if (bareWords.length === 1 && isCatalogMediumToken(bareWords[0], services)) {
    return null;
  }
  if (detectMediaLocal(text, services).length > 0) {
    return null;
  }

  type Cand = { phrase: string; len: number; svc: DbService };
  const cands: Cand[] = [];

  for (const s of services) {
    const dir = getDirectionLabel(s);
    if (!dir || dir.length < 4) continue;
    const dLower = dir.toLowerCase();
    // Full-phrase containment only when query is multi-word or long place-like (≥8 chars)
    if (
      (bareWords.length >= 2 || lower.length >= 8)
      && (dLower.includes(lower) || (lower.length >= 8 && lower.includes(dLower)))
    ) {
      cands.push({ phrase: dir, len: Math.min(dLower.length, lower.length), svc: s });
      continue;
    }
    const qWords = bareWords.filter((w) => w.length >= 3);
    if (qWords.length === 0) continue;
    // Skip catalog medium tokens as direction keys (metro ≠ Anna Nagar Metro Station)
    if (qWords.every((w) => isCatalogMediumToken(w, services))) continue;
    const allHit = qWords.every((w) =>
      new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(dLower),
    );
    if (!allHit) continue;
    if (qWords.length >= 2 || (qWords.length === 1 && qWords[0].length >= 6)) {
      cands.push({ phrase: dir, len: qWords.join(' ').length, svc: s });
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.len - a.len || b.phrase.length - a.phrase.length);
  const bestPhrase = cands[0].phrase;
  const bestKey = canonicalizeServiceName(bestPhrase);
  const byDir = services.filter((s) => {
    const d = getDirectionLabel(s);
    return d && canonicalizeServiceName(d) === bestKey;
  });
  const matched = cands
    .filter((c) => {
      const k = canonicalizeServiceName(c.phrase);
      return k === bestKey || k.includes(bestKey) || bestKey.includes(k);
    })
    .map((c) => c.svc);
  const all = byDir.length ? byDir : matched;
  const uniq = [...new Map(all.map((s) => [s.service_id, s])).values()];
  const areas = [
    ...new Set(
      uniq.map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s)).filter(Boolean) as string[],
    ),
  ];
  return {
    phrase: bestPhrase,
    serviceIds: uniq.map((s) => s.service_id),
    // Never silent-set city — funnel confirms when exactly one remains
    city: undefined,
    area: areas.length === 1 ? areas[0] : undefined,
  };
}

/** True when `token` is an exact catalog medium key (e.g. "bus semi", "apartment demo"). */
function isExactCatalogMedium(token: string, services: DbService[]): boolean {
  const t = canonicalizeServiceName(token);
  if (!t) return false;
  return services.some((s) => canonicalizeServiceName(getMediumKey(s)) === t);
}

/** Pool used for the City step — same medium/type scope as the funnel pool. */
function poolForCityOptions(
  services: DbService[],
  session: ProgressiveSession,
  scopedPool: DbService[],
): DbService[] {
  // Place/area already locked → stay scoped
  if (session.area || session.placeHint) return scopedPool;

  const token = session.medium || session.browseToken || '';
  if (!token) return scopedPool;

  let hits: DbService[] = [];
  if (session.medium && isExactCatalogMedium(session.medium, services)) {
    hits = filterByExactMedium(services, session.medium);
  }
  if (!hits.length) {
    hits = filterForBrowseOrFamily(services, token);
  }
  if (!hits.length) return scopedPool;

  // MUST apply mediumType so chips match what filterPoolBySession will keep
  if (session.mediumType) {
    const mt = canonicalizeServiceName(session.mediumType);
    hits = hits.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mt;
    });
  }
  return hits.length ? hits : scopedPool;
}

function buildOneCityContinue(
  sess: ProgressiveSession,
  pool: DbService[],
  onlyCity: string,
  _reply?: string | null,
): ProgressiveTurnResult {
  const svcLabel = titleCase(sess.medium || sess.browseToken || 'this');
  // Prefer short area; never echo direction-length lines into Continue copy
  const areaForCopy =
    sess.area && !isDirectionLikeLabel(sess.area) ? sess.area : undefined;
  const where = areaForCopy ? ` for ${areaForCopy}` : '';
  return {
    step: 'did_you_mean',
    // Never reuse place-browse reply ("Which one do you want?") — always explicit Continue
    botText: `We currently offer ${svcLabel}${where} in ${onlyCity} only. Continue?`,
    options: [
      { id: 'yes_generate', label: 'Yes', city: onlyCity, medium: sess.medium },
      { id: 'no_generate', label: 'No' },
    ],
    allowMulti: false,
    session: {
      ...sess,
      city: onlyCity,
      // KEEP true until Yes — otherwise any re-entry to advanceFunnel finalizes without click
      needsContinueConfirm: true,
      candidateServiceIds: pool.map((s) => s.service_id),
      pendingRows: undefined,
    },
  };
}

function filterPoolBySession(services: DbService[], session: ProgressiveSession): DbService[] {
  let pool = session.candidateServiceIds?.length
    ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
    : [...services];

  if (session.medium || session.browseToken) {
    const token = session.browseToken || session.medium || '';
    // Exact catalog medium ("bus semi", "apartment demo") → exact filter
    // Family token ("bus") → browse so bus shelter / other cities are included
    if (session.medium && isExactCatalogMedium(session.medium, services)) {
      const exactMed = filterByExactMedium(pool, session.medium);
      if (exactMed.length) pool = exactMed;
      else {
        const byBrowse = filterForBrowseOrFamily(pool, token);
        if (byBrowse.length) pool = byBrowse;
      }
    } else {
      const byBrowse = filterForBrowseOrFamily(pool, token);
      if (byBrowse.length) {
        pool = byBrowse;
      } else if (session.medium) {
        const exactMed = filterByExactMedium(pool, session.medium);
        if (exactMed.length) pool = exactMed;
      }
    }
  }

  if (session.mediumType) {
    const mt = canonicalizeServiceName(session.mediumType);
    pool = pool.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mt;
    });
  }

  if (session.directionHint) {
    const hint = canonicalizeServiceName(session.directionHint);
    const hintRe = new RegExp(
      `\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    );
    const dirHits = pool.filter((s) => {
      const dir = getDirectionLabel(s);
      if (!dir) return false;
      const d = canonicalizeServiceName(dir);
      return d === hint || d.includes(hint) || hint.includes(d) || hintRe.test(dir);
    });
    if (dirHits.length) pool = dirHits;
  }

  return filterHitsBySessionLocation(pool, session);
}

/**
 * Strict funnel: Service → Type → City → Area → Direction → Quote.
 * Skip empty/NA steps; auto-select when only one option; ask when many.
 */
export function advanceFunnel(
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  // browseToken alone = family browse (e.g. "bus") — do NOT promote to locked medium
  let sess: ProgressiveSession = {
    ...session,
    medium: session.medium,
    browseToken: session.browseToken || session.medium,
    // Confirmed place hint acts as area when area not set
    area: session.area || session.placeHint,
  };

  for (let guard = 0; guard < 10; guard++) {
    const pool = filterPoolBySession(services, sess);
    if (!pool.length) {
      const where = [sess.city, sess.area].filter(Boolean).join(' · ');
      return {
        step: 'no_match',
        botText:
          reply
          || `No matching services${where ? ` in ${where}` : ''}${
            sess.medium
              ? ` for ${titleCase(sess.medium)}`
              : sess.browseToken
                ? ` for ${titleCase(sess.browseToken)}`
                : ''
          }. Try another option.`,
        options: [],
        session: sess,
      };
    }

    sess = {
      ...sess,
      candidateServiceIds: pool.map((s) => s.service_id),
    };

    // 1) Service (medium)
    if (!sess.medium) {
      const mediums = uniqueMediumOnlyOptions(pool);
      if (mediums.length > 1) {
        const where = [sess.city, sess.area].filter(Boolean).join(' · ');
        return {
          step: 'pick_type',
          botText:
            reply
            || (sess.directionHint
              ? `We provide these services at ${sess.directionHint}. Which one?`
              : where
                ? `We provide these services in ${where}. Which one?`
                : sess.browseToken
                  ? `Which type of ${titleCase(sess.browseToken)}?`
                  : 'Which type of ad / service do you want?'),
          options: mediums,
          allowMulti: true,
          session: sess,
        };
      }
      if (mediums.length === 1) {
        sess = {
          ...sess,
          medium: mediums[0].medium,
          browseToken: mediums[0].medium,
        };
        continue;
      }
    }

    // 2) Type — ALWAYS before City (RULE 1)
    // Metro family: one chip list (Station — Elevated/Underground, Train Inside, Train Wrap)
    if (sess.medium && !sess.mediumType) {
      const familyTok = canonicalizeServiceName(sess.browseToken || sess.medium);
      const metroFamily = isMetroSegmentToken(familyTok);
      if (metroFamily || !isExactCatalogMedium(sess.medium, services)) {
        const typePool = metroFamily ? mergeMetroFamilyServices(services, pool) : pool;
        const familyOpts = uniqueMediumLabelsWithExamples(typePool);
        if (familyOpts.length > 1) {
          return {
            step: 'pick_type',
            botText: reply || `Which type of ${titleCase(sess.browseToken || sess.medium)}?`,
            options: familyOpts,
            allowMulti: true,
            session: {
              ...sess,
              candidateServiceIds: typePool.map((s) => s.service_id),
            },
          };
        }
        if (familyOpts.length === 1) {
          sess = {
            ...sess,
            medium: canonicalizeServiceName(familyOpts[0].medium || sess.medium),
            mediumType: familyOpts[0].mediumType
              ? canonicalizeServiceName(familyOpts[0].mediumType)
              : sess.mediumType,
            browseToken: familyOpts[0].medium || sess.browseToken,
          };
          continue;
        }
      }

      const types = uniqueTypeOnlyOptions(pool, sess.medium);
      if (types.length > 1) {
        return {
          step: 'pick_type',
          botText: reply || `Which type of ${titleCase(sess.medium)}?`,
          options: types,
          allowMulti: false,
          session: sess,
        };
      }
      if (types.length === 1) {
        // Don't auto-lock the single type when the pool also contains untyped services
        // for the same medium (e.g. plain "Police Booth" alongside "Police Booth Inside").
        // Auto-locking would silently narrow city options to only the typed variant's cities.
        const wantedMedium = canonicalizeServiceName(sess.medium || '');
        const hasUntypedSiblings = pool.some(
          (s) =>
            canonicalizeServiceName(getMediumKey(s)) === wantedMedium
            && !getMediumTypeFromDb(s),
        );
        if (!hasUntypedSiblings) {
          sess = {
            ...sess,
            mediumType: canonicalizeServiceName(types[0].mediumType || types[0].label),
          };
          continue;
        }
        // Untyped siblings exist — skip type auto-lock; city step will include all variants
      }
      // 0 types — skip
    }

    // 3) City — when place/area already known, only confirm that place's city (RULE 7)
    if (!sess.city) {
      const cityPool = poolForCityOptions(services, sess, pool);
      const cities = uniqueCityOptionsFromPool(cityPool, sess.medium);
      if (cities.length > 1) {
        // Place already locked (OMR etc.) — Continue that metro only; never full city list
        if (sess.area || sess.placeHint) {
          const metroFromPlace = cityPool
            .map((s) => extractRealCityFromDbService(s))
            .find((c): c is string => !!c);
          const continueCity =
            metroFromPlace || cities[0].city || cities[0].label;
          return buildOneCityContinue(sess, cityPool, continueCity, reply);
        }
        return {
          step: 'pick_city',
          botText:
            reply
            || `We offer ${titleCase(sess.medium || 'this')} in these cities. Select one or more, then Confirm.`,
          options: cities,
          allowMulti: true, // RULE 2: city/place chips = checkboxes
          session: {
            ...sess,
            candidateServiceIds: cityPool.map((s) => s.service_id),
            needsContinueConfirm: false,
          },
        };
      }
      if (cities.length === 1) {
        const onlyCity = cities[0].city || cities[0].label;
        return buildOneCityContinue(sess, cityPool, onlyCity, reply);
      }
      // 0 cities (all NA) — skip city step
    }

    // 4) Area — actual area_name values (ask if 2+ even if text looks like directions)
    if (!sess.area) {
      const areas = uniqueAreaOptionsFromPool(pool, sess.city, sess.medium);
      if (areas.length > 1) {
        return {
          step: 'pick_area',
          botText:
            reply
            || (sess.city
              ? `Nice — ${sess.city}. Which area?`
              : `Which area for ${titleCase(sess.medium || 'this')}?`),
          options: areas,
          allowMulti: true,
          session: sess,
        };
      }
      if (areas.length === 1) {
        sess = { ...sess, area: areas[0].label };
        continue;
      }
    }

    const finalPool = filterPoolBySession(services, sess);
    if (!finalPool.length) {
      return {
        step: 'no_match',
        botText: reply || 'Nothing matched that selection. Try another place or service.',
        options: [],
        session: sess,
      };
    }

    // 5) Direction — ask when 2+ before any finalize
    const withDir = finalPool.filter((s) => !!getDirectionLabel(s));
    const dirKeys = [
      ...new Set(
        withDir
          .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
          .filter(Boolean),
      ),
    ];
    const where = [sess.city, sess.area].filter(Boolean).join(' · ') || sess.directionHint || '';

    // Place/area path with no city in metadata — still Confirm once before directions/quote
    if (sess.needsContinueConfirm && !sess.city) {
      return buildOneCityContinue(
        { ...sess, medium: sess.medium || getMediumKey(finalPool[0]) },
        finalPool,
        sess.area || where || 'this city',
        reply,
      );
    }

    if (dirKeys.length > 1) {
      return buildDirectionPicker(withDir, {
        ...sess,
        needsContinueConfirm: false,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      }, where);
    }

    // Place-only collapse — Confirm before quote when flag still set
    if (sess.needsContinueConfirm) {
      const onlyCity =
        sess.city
        || uniqueCityOptionsFromPool(finalPool, sess.medium)[0]?.city
        || sess.area
        || where
        || 'this city';
      return buildOneCityContinue(
        { ...sess, medium: sess.medium || getMediumKey(finalPool[0]) },
        finalPool,
        onlyCity,
        reply,
      );
    }

    if (dirKeys.length === 1 && withDir.length >= 1) {
      const reps = new Map<string, DbService>();
      for (const s of withDir) {
        const key = canonicalizeServiceName(getDirectionLabel(s) || s.service_id);
        if (!reps.has(key)) reps.set(key, s);
      }
      return finalizeSelection([...reps.values()], {
        ...sess,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      }, services);
    }

    if (finalPool.length === 1) {
      return finalizeSelection(finalPool, sess, services);
    }

    const products = uniqueProductOptions(finalPool);
    if (products.length > 1) {
      return {
        step: 'related_services',
        botText: reply || `Which ${titleCase(sess.medium || 'option')} in ${where || 'that location'}?`,
        options: products,
        allowMulti: true,
        session: {
          ...sess,
          candidateServiceIds: finalPool.map((s) => s.service_id),
        },
      };
    }

    return {
      step: 'related_services',
      botText: reply || `Which one in ${where || 'that location'}?`,
      options: uniqueServiceOptions(finalPool),
      allowMulti: true,
      session: {
        ...sess,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      },
    };
  }

  return {
    step: 'no_match',
    botText: 'Sure — type what you need.',
    options: [],
    session: sess,
  };
}

/** Short / unclear free text → candidate for Did you mean? */
function isShortAmbiguousQuery(text: string): boolean {
  const words = extractQueryWords(text).filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const t = text.trim();
  return words.length >= 1 && words.length <= 2 && t.length <= 28 && !/\band\b/i.test(t);
}

/** Exact catalog medium match (full key), not a partial "booth"→"police booth". */
function isExactMediaQuery(text: string, services: DbService[]): boolean {
  const q = canonicalizeServiceName(text);
  if (!q) return false;
  return getCatalogTypeKeys(services).some((m) => canonicalizeServiceName(m) === q);
}

/** Exact full locality/area name in DB. */
function isExactLocalityQuery(text: string, services: DbService[]): boolean {
  const q = canonicalizeServiceName(text);
  if (!q) return false;
  return getCatalogLocalities(services).some((l) => canonicalizeServiceName(l) === q);
}

function suggestPartialPlace(text: string, services: DbService[]): string | null {
  const q = canonicalizeServiceName(text);
  if (q.length < 3) return null;
  if (isExactLocalityQuery(text, services)) return null;

  // Prefer short area_name values for place hints (unused for DYM — kept for batch hint)
  const areaSet = new Set<string>();
  for (const s of services) {
    const area = getFunnelAreaLabel(s);
    if (area && area.split(/\s+/).length <= 4) areaSet.add(area);
    const loc = getLocalityFromMetaCity(s);
    if (loc && !isDirectionLikeLabel(loc)) areaSet.add(loc);
  }
  const places = [...areaSet]
    .map((p) => ({ raw: p, key: canonicalizeServiceName(p) }))
    .filter((p) => {
      if (p.key.length <= q.length) return false;
      if (isDirectionLikeLabel(p.raw)) return false;
      if (p.raw.split(/\s+/).length > 4) return false;
      return (
        p.key.startsWith(q)
        || p.key.includes(` ${q}`)
        || new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p.key)
      );
    })
    .sort((a, b) => a.key.length - b.key.length || a.key.localeCompare(b.key));
  if (!places.length) return null;
  const starts = places.filter(
    (p) => p.key.startsWith(q) || p.key.includes(` ${q}`),
  );
  return (starts.length ? starts : places)[0].raw;
}

function suggestPartialService(text: string, services: DbService[]): string | null {
  const q = canonicalizeServiceName(text);
  if (q.length < 3) return null;
  if (isExactMediaQuery(text, services)) return null;
  const catalog = getCatalogTypeKeys(services)
    .map((m) => ({ raw: m, key: canonicalizeServiceName(m) }))
    .filter((m) => m.key.length > q.length && (m.key.includes(q) || m.key.split(/\s+/).includes(q)))
    .sort((a, b) => a.key.length - b.key.length);
  if (!catalog.length) {
    // browse: booth → Police Booth via name
    const browse = filterByBrowseToken(services, q);
    const mediums = uniqueMediumOnlyOptions(browse);
    if (mediums.length === 1) {
      const m = mediums[0].medium || '';
      if (canonicalizeServiceName(m) !== q) return m;
    }
    return null;
  }
  return catalog[0].raw;
}

function buildDidYouMeanTurn(
  label: string,
  kind: 'place' | 'service',
  session: ProgressiveSession,
  serviceId?: string,
): ProgressiveTurnResult {
  return {
    step: 'did_you_mean',
    botText: `Did you mean ${titleCase(label)}?`,
    options: [
      {
        id: 'yes',
        label: 'Yes',
        serviceId,
        medium: kind === 'service' ? label : undefined,
        city: kind === 'place' ? undefined : undefined,
      },
      { id: 'no', label: 'No' },
    ],
    session: {
      ...session,
      bestGuessKind: kind,
      bestGuessLabel: titleCase(label),
      bestGuessServiceId: serviceId,
      medium: kind === 'service' ? canonicalizeServiceName(label) : session.medium,
      placeHint: kind === 'place' ? titleCase(label) : session.placeHint,
    },
  };
}

/**
 * After one city/service finishes, continue pending city queue or batch work queue.
 */
function continuePendingWork(
  session: ProgressiveSession,
  collectedRows: ConfirmationRow[],
  collectedServiceIds: string[],
  services: DbService[],
): ProgressiveTurnResult | null {
  const cityQueue = [...(session.pendingCityQueue || [])];
  if (cityQueue.length > 0) {
    const nextCity = cityQueue.shift()!;
    return advanceFunnel(
      {
        ...session,
        city: nextCity,
        area: session.placeHint || undefined,
        directionHint: undefined,
        mediumType: session.mediumType,
        pendingCityQueue: cityQueue,
        collectedRows,
        collectedServiceIds,
        candidateServiceIds: undefined,
        pendingRows: undefined,
      },
      services,
      `Next — ${titleCase(session.medium || 'service')} in ${nextCity}:`,
    );
  }

  const workQueue = [...(session.workQueue || [])];
  if (workQueue.length > 0) {
    const next = workQueue.shift()!;
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(next.medium),
        browseToken: canonicalizeServiceName(next.browseToken || next.medium),
        mediumType: undefined,
        city: next.city,
        area: session.placeHint || undefined,
        qty: next.qty,
        directionHint: undefined,
        pendingCityQueue: undefined,
        workQueue,
        collectedRows,
        collectedServiceIds,
        candidateServiceIds: next.candidateServiceIds,
        pendingRows: undefined,
      },
      services,
      `Next — ${titleCase(next.medium)}${next.city ? ` in ${next.city}` : ''}:`,
    );
  }
  return null;
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
      // Never use direction_remarks for area/place scope
      return label === a || locality === a || metaCity === a || metaArea === a
        || aRe.test(label) || aRe.test(locality) || aRe.test(metaCity) || aRe.test(metaArea);
    });
    if (session.city && out.length > 0) {
      const narrowed = out.filter((s) => serviceMatchesCityLabel(s, session.city!));
      if (narrowed.length > 0) out = narrowed;
    }
    return out;
  }
  if (session.city) {
    const c = session.city.toLowerCase();
    out = out.filter((s) => serviceMatchesCityLabel(s, c));
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
    : uniqueMediumOnlyOptions(services);
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

  // Family token ("bus") covering Bus Semi + Bus Shelter + … → ask which service first
  // Exact catalog medium ("bus semi", "apartment demo") → lock and continue funnel
  if (!isExactCatalogMedium(medKey, services)) {
    const browseHits = filterForBrowseOrFamily(services, browseToken);
    const mediums = uniqueMediumOnlyOptions(browseHits);
    const clearCands = !(session.area || session.placeHint);
    if (mediums.length > 1) {
      return advanceFunnel(
        {
          ...session,
          medium: undefined,
          browseToken,
          candidateServiceIds: clearCands ? undefined : session.candidateServiceIds,
        },
        services,
        reply || `Which type of ${titleCase(browseToken)}?`,
      );
    }
    if (mediums.length === 1) {
      return advanceFunnel(
        {
          ...session,
          medium: canonicalizeServiceName(mediums[0].medium || medKey),
          browseToken: canonicalizeServiceName(mediums[0].medium || browseToken),
          candidateServiceIds: clearCands ? undefined : session.candidateServiceIds,
        },
        services,
        reply,
      );
    }
  }

  const nextSession: ProgressiveSession = {
    ...session,
    medium: medKey,
    browseToken,
    // Fresh service query — do not keep a prior place's candidate ids
    candidateServiceIds: session.area || session.placeHint
      ? session.candidateServiceIds
      : undefined,
  };

  // Pull locality from text if not already on session
  if (!nextSession.city && !nextSession.area) {
    const locFromText = detectLocalityInText(session.originalText || '', services);
    if (locFromText) nextSession.area = locFromText;
  }
  if (!nextSession.city && nextSession.area) {
    const pool = filterForBrowseOrFamily(services, browseToken);
    const atPlace = filterByLocality(pool, nextSession.area);
    if (atPlace.length > 0) {
      // Keep city unset so funnel confirms city; require Continue before quote
      return advanceFunnel(
        {
          ...nextSession,
          city: undefined,
          candidateServiceIds: atPlace.map((s) => s.service_id),
          needsContinueConfirm: true,
          pendingCityQueue: undefined,
          workQueue: undefined,
        },
        services,
        reply,
      );
    }
    return {
      step: 'no_match',
      botText: `No ${titleCase(browseToken)} in ${nextSession.area}. Try another place or a different service.`,
      options: [],
      session: nextSession,
    };
  }

  return advanceFunnel(nextSession, services, reply);
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

  // City only from user text (or AI when that city literally appears in the message).
  // Prevents AI inventing Thoraipakkam/etc. and collapsing the apartment city list.
  const cityFromText = detectCityInText(originalText, services);
  const cityFromAi = intent?.city ? titleCase(String(intent.city)) : null;
  const city =
    cityFromText
    || (cityFromAi
      && new RegExp(
        `\\b${cityFromAi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i',
      ).test(originalText)
      ? cityFromAi
      : null)
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

  // Prefer exact full-phrase catalog medium when user typed it (apartment demo)
  if (mediaLocal.length === 1 && isExactMediaQuery(originalText, services)) {
    media = mediaLocal;
  }

  const shortReply = intent?.shortReply || null;

  // Area only from exact locality in user text — ignore invented AI areaHint
  const localityHint = detectLocalityInText(originalText, services);

  const baseSessionFields: ProgressiveSession = {
    originalText,
    qty,
    durationText,
    pendingMedia: [],
    collectedRows: [],
    collectedServiceIds: [],
    aiReply: shortReply,
  };

  // Partial service name (e.g. "bus semi") → enter funnel directly (no Did you mean)
  // Skip when "led"/feature words span multiple catalog types
  const earlySegmentsCheck = parseServiceSegments(originalText, services);
  const earlyFeatureHint = detectFeatureClarifyHint(originalText, services, city);
  if (
    media.length === 0
    && earlySegmentsCheck.length < 2
    && !isCityOnlyQuery(originalText, services)
    && !isLocalityOnlyQuery(originalText, services)
    && mediaFromAi.length === 0
    && !earlyFeatureHint
  ) {
    const svcSug = suggestPartialService(originalText, services);
    if (svcSug) {
      return startMediumFlow(
        svcSug,
        {
          ...baseSessionFields,
          medium: canonicalizeServiceName(svcSug),
          browseToken: canonicalizeServiceName(svcSug),
        },
        services,
        shortReply,
      );
    }
  }

  // City + Area (no service) → ask Service → Type → Direction
  if (
    city
    && localityHint
    && canonicalizeServiceName(city) !== canonicalizeServiceName(localityHint)
    && media.length === 0
  ) {
    return advanceFunnel(
      {
        ...baseSessionFields,
        city,
        area: localityHint,
        placeHint: localityHint,
      },
      services,
      shortReply || `In ${city} · ${localityHint} — which service do you want?`,
    );
  }

  // Site / direction first (e.g. "Gemini Flyover") → Service → Type → City → Area
  const cityOnlyEarly = isCityOnlyQuery(originalText, services);
  const localityOnlyEarly = isLocalityOnlyQuery(originalText, services);
  if (media.length === 0 && !cityOnlyEarly && !localityOnlyEarly) {
    const directionHit = detectDirectionInText(originalText, services);
    if (directionHit) {
      const textKey = canonicalizeServiceName(originalText);
      const isPureArea =
        !!localityHint && textKey === canonicalizeServiceName(localityHint);
      const isPureCity = !!city && textKey === canonicalizeServiceName(city);
      if (!isPureArea && !isPureCity) {
        return advanceFunnel(
          {
            ...baseSessionFields,
            directionHint: directionHit.phrase,
            city: city || directionHit.city,
            area: localityHint || directionHit.area,
            candidateServiceIds: directionHit.serviceIds,
          },
          services,
          shortReply
            || `We found ${directionHit.phrase}. Which service do you want?`,
        );
      }
    }
  }

  // Locality-only ("saidapet") → ask which service type there (before medium/feature flows)
  const earlyLocality = localityOnlyEarly;
  if (earlyLocality) {
    return startPlaceTypeBrowse(
      earlyLocality,
      false,
      baseSessionFields,
      services,
      shortReply,
    );
  }

  // Multi-service "X and Y and Z" → batch multi-select (before clarify / single-medium flows)
  const earlySegments = parseServiceSegments(originalText, services);
  if (earlySegments.length >= 2) {
    const placeHint = extractBatchPlaceHint(originalText, services) || undefined;
    return startBatchMultiSelect(
      earlySegments,
      {
        ...baseSessionFields,
        city: city || undefined,
        placeHint,
        area: placeHint,
        qty: null,
      },
      services,
      null,
    );
  }

  const featureHint =
    (intent?.kind === 'clarify_type' || intent?.ambiguous
      ? (intent?.clarifyHint || detectFeatureClarifyHint(originalText, services, city))
      : null)
    || detectFeatureClarifyHint(originalText, services, city);

  // Ambiguous place (bus stand) / feature (led) → ask type chips, do not collapse to one medium
  if (featureHint && mediaFromAi.length < 2) {
    const hint = intent?.clarifyHint || featureHint;
    const types = typesForClarify(services, city, hint === 'that' ? null : hint);
    if (types.length > 1) {
      const where = city ? ` in ${city}` : '';
      return {
        step: 'pick_type',
        botText:
          shortReply
          || `Got it — ${hint === 'that' ? 'that' : hint}${where}. Which type do you want?`,
        options: types,
        allowMulti: true,
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
    // Single browse hit for feature → start that medium
    const browseHits =
      hint && hint !== 'that' ? filterByBrowseToken(services, hint) : [];
    if (browseHits.length > 0 && !isAmbiguousPlaceQuery(originalText)) {
      const mediums = uniqueMediumOnlyOptions(browseHits);
      if (mediums.length === 1) {
        return startMediumFlow(
          mediums[0].medium || hint,
          {
            originalText,
            medium: canonicalizeServiceName(mediums[0].medium || hint),
            browseToken: canonicalizeServiceName(mediums[0].medium || hint),
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
      if (mediums.length > 1) {
        return {
          step: 'pick_type',
          botText: shortReply || `Which type of ${titleCase(hint)}?`,
          options: mediums,
          allowMulti: true,
          session: {
            originalText,
            browseToken: canonicalizeServiceName(hint),
            city: city || undefined,
            qty,
            durationText,
            pendingMedia: [],
            aiReply: shortReply,
          },
        };
      }
    }
    return {
      step: 'pick_type',
      botText:
        shortReply
        || `Got it — ${hint === 'that' ? 'that' : hint}. Which type do you want?`,
      options: types.length ? types : uniqueMediumOnlyOptions(services),
      allowMulti: true,
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
      // Known metros (Madurai/Chennai…) → city filter; locality-as-city (Hosur/Padur) → area filter
      const isKnownMetro = REAL_CITY_KEYS.includes(browseCity.toLowerCase());
      return startPlaceTypeBrowse(
        browseCity,
        isKnownMetro,
        {
          originalText,
          city: isKnownMetro ? browseCity : undefined,
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
    // If detectCityInText mis-tagged a locality, clear it (metros-only now, belt-and-suspenders)
    const cityForSession =
      city
      && locInText
      && canonicalizeServiceName(city) === canonicalizeServiceName(locInText)
        ? null
        : city;
    // Locality-only message that is NOT also a catalog medium → place type browse
    const mediaInText = detectMediaLocal(
      stripQtyCityDuration(originalText, cityForSession),
      services,
    );
    if (locInText && mediaInText.length === 0) {
      return startPlaceTypeBrowse(locInText, false, {
        ...sessionBase,
        city: undefined,
      }, services, shortReply);
    }
    return startMediumFlow(
      first,
      {
        ...sessionBase,
        pendingMedia: [],
        medium: canonicalizeServiceName(first),
        browseToken: canonicalizeServiceName(first),
        city: cityForSession || undefined,
        // Pass locality when user typed it with the medium (DB may store it as city)
        area: locInText || sessionBase.area,
        needsContinueConfirm: !!locInText,
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

  // Sequential multi-city / batch queue — continue before quote
  if (services) {
    const pending = continuePendingWork(
      { ...session, pendingRows: undefined },
      collectedRows,
      collectedServiceIds,
      services,
    );
    if (pending) return pending;
  }

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
  if (actionId === 'yes' && session.bestGuessKind === 'place' && session.bestGuessLabel) {
    const place = session.bestGuessLabel;
    // Batch list was stashed with a trailing place hint
    if (session.segments && session.segments.length >= 2) {
      return startBatchMultiSelect(
        session.segments,
        {
          ...session,
          placeHint: place,
          area: place,
          bestGuessKind: undefined,
          bestGuessLabel: undefined,
          pendingMedia: [],
        },
        services,
      );
    }
    return startPlaceTypeBrowse(
      place,
      false,
      {
        ...session,
        placeHint: place,
        area: place,
        bestGuessKind: undefined,
        bestGuessLabel: undefined,
      },
      services,
    );
  }
  if (actionId === 'yes' && session.bestGuessKind === 'service' && (session.bestGuessLabel || session.medium)) {
    const medium = session.bestGuessLabel || session.medium || '';
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(medium),
        browseToken: canonicalizeServiceName(medium),
        bestGuessKind: undefined,
        bestGuessLabel: undefined,
        bestGuessServiceId: undefined,
        // Full catalog for this service — never skip city when DB has many
        candidateServiceIds: undefined,
        city: undefined,
        area: session.placeHint || undefined,
        mediumType: undefined,
      },
      services,
    );
  }
  if (actionId === 'yes' && session.bestGuessServiceId) {
    const svc = services.find((s) => s.service_id === session.bestGuessServiceId);
    if (svc) {
      return advanceFunnel(
        {
          ...session,
          medium: getMediumKey(svc),
          browseToken: getMediumKey(svc),
          bestGuessServiceId: undefined,
          candidateServiceIds: undefined,
          city: undefined,
          area: session.placeHint || undefined,
          mediumType: undefined,
        },
        services,
      );
    }
  }
  if (actionId === 'no') {
    return softClarifyNeed(services, {
      ...session,
      bestGuessKind: undefined,
      bestGuessLabel: undefined,
      bestGuessServiceId: undefined,
    });
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

  // One-city confirm: continue Area → Direction → Quote
  if (actionId === 'yes_generate') {
    return advanceFunnel(
      {
        ...session,
        city: session.city || session.bestGuessLabel,
        needsContinueConfirm: false, // User confirmed — allow finalize
      },
      services,
    );
  }

  if (actionId === 'no_generate') {
    return softClarifyNeed(
      services,
      { ...session, city: undefined, needsContinueConfirm: false },
      'Okay — tell me another city or service.',
    );
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

    // Single city chip → continue funnel (Type → Area → Direction)
    if (ids.length === 1 && ids[0].startsWith('city:')) {
      const city = titleCase(ids[0].slice(5));
      const nextSession: ProgressiveSession = {
        ...session,
        city,
        area: undefined,
        placeHint: undefined,
        needsContinueConfirm: false,
        candidateServiceIds: undefined,
        pendingCityQueue: undefined,
      };
      if (token) {
        return advanceFunnel({
          ...nextSession,
          browseToken: token,
          medium: session.medium || token,
        }, services);
      }
      return advanceFunnel(
        nextSession,
        services,
        `We provide these services in ${city}. Which one?`,
      );
    }

    // Multi-city Confirm → ONE quote with a line per city (RULE 5)
    if (ids.length > 1) {
      const uniqueCities: string[] = [];
      const seenCity = new Set<string>();
      for (const id of ids) {
        let cityLabel = '';
        if (id.startsWith('city:')) cityLabel = titleCase(id.slice(5));
        else if (id.startsWith('area:')) continue;
        else if (id.startsWith('place:')) {
          const payload = id.slice(6);
          const pipe = payload.indexOf('|');
          const cityKey = pipe >= 0 ? payload.slice(0, pipe) : payload;
          if (cityKey === 'locality') continue;
          cityLabel = titleCase(cityKey);
        }
        const key = cityLabel.toLowerCase();
        if (cityLabel && !seenCity.has(key)) {
          seenCity.add(key);
          uniqueCities.push(cityLabel);
        }
      }

      if (uniqueCities.length === 0) {
        return afterLocationResolved(allHits, lastSession, services);
      }

      const medium = canonicalizeServiceName(
        session.medium || token || getMediumKey(allHits[0]) || '',
      );
      type WorkItem = {
        medium: string;
        browseToken?: string;
        qty: number | null;
        city?: string;
        candidateServiceIds?: string[];
      };
      const readyReps: DbService[] = [];
      const needFunnel: WorkItem[] = [];

      for (const cityLabel of uniqueCities) {
        let hits =
          medium && isExactCatalogMedium(medium, services)
            ? filterByExactMedium(services, medium)
            : filterForBrowseOrFamily(services, token || medium);
        if (session.mediumType) {
          const mt = canonicalizeServiceName(session.mediumType);
          hits = hits.filter((s) => {
            const got = getMediumTypeFromDb(s);
            return !!got && canonicalizeServiceName(got) === mt;
          });
        }
        hits = hits.filter((s) => serviceMatchesCityLabel(s, cityLabel));
        if (!hits.length) continue;

        const withDir = hits.filter((s) => !!getDirectionLabel(s));
        const dirKeys = [
          ...new Set(
            withDir
              .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
              .filter(Boolean),
          ),
        ];

        if (dirKeys.length <= 1 || hits.length === 1) {
          const rep = (dirKeys.length === 1 && withDir[0]) || hits[0];
          if (rep) readyReps.push(rep);
        } else {
          needFunnel.push({
            medium: medium || token,
            browseToken: medium || token,
            qty: session.qty,
            city: cityLabel,
            candidateServiceIds: hits.map((s) => s.service_id),
          });
        }
      }

      if (readyReps.length > 0 && needFunnel.length === 0) {
        return finalizeSelection(readyReps, {
          ...session,
          needsContinueConfirm: false,
          workQueue: undefined,
          pendingCityQueue: undefined,
          area: undefined,
          placeHint: undefined,
        }, services);
      }

      let seedRows: ConfirmationRow[] = [...(session.collectedRows || [])];
      let seedIds: string[] = [...(session.collectedServiceIds || [])];
      if (readyReps.length > 0) {
        const built = buildRowsForServices(
          readyReps,
          session.qty,
          session.durationText,
          session.originalText,
          session.qtyByServiceId,
        );
        seedRows = [...seedRows, ...built.rows];
        seedIds = [...seedIds, ...readyReps.map((s) => s.service_id)];
      }

      if (!needFunnel.length) {
        if (seedRows.length) {
          return finalizeSelection([], {
            ...session,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
            pendingCityQueue: undefined,
            workQueue: undefined,
          }, services);
        }
        return {
          step: 'no_match',
          botText: `No matching ${titleCase(medium || 'services')} for those cities. Try another option.`,
          options: [],
          session,
        };
      }

      const [first, ...rest] = needFunnel;
      return advanceFunnel(
        {
          ...session,
          medium: canonicalizeServiceName(first.medium),
          browseToken: canonicalizeServiceName(first.browseToken || first.medium),
          mediumType: session.mediumType,
          city: first.city,
          area: undefined,
          placeHint: undefined,
          qty: first.qty,
          candidateServiceIds: first.candidateServiceIds,
          workQueue: rest,
          pendingCityQueue: undefined,
          collectedRows: seedRows,
          collectedServiceIds: seedIds,
          needsContinueConfirm: false,
        },
        services,
        rest.length
          ? `Starting with ${first.city} (${rest.length} more after this).`
          : undefined,
      );
    }

    return afterLocationResolved(allHits, lastSession, services);
  }

  // City pick (single — multi already handled above when mixed with place/area)
  if (actionId.startsWith('city:') && !(selectedIds && selectedIds.length > 1)) {
    const city = titleCase(actionId.slice(5));
    const token = session.browseToken || session.medium || '';
    // Service-first city pick: clear stale area/place + candidates so Madurai isn't
    // filtered by a previous Vadapalani/Hosur session or a type-skewed id list
    const nextSession: ProgressiveSession = {
      ...session,
      city,
      area: undefined,
      placeHint: undefined,
      needsContinueConfirm: false,
      candidateServiceIds: undefined,
      pendingCityQueue: undefined,
    };
    if (token) {
      return advanceFunnel({
        ...nextSession,
        browseToken: token,
        medium: session.medium || token,
      }, services);
    }
    return advanceFunnel(
      nextSession,
      services,
      `We provide these services in ${city}. Which one?`,
    );
  }

  // Area-only pick (after city) — single; multi handled in place block above
  if (actionId.startsWith('area:') && !(selectedIds && selectedIds.length > 1)) {
    const areaKey = actionId.slice(5);
    const token = session.browseToken || session.medium || '';
    const pool = session.city
      ? areasForMediumCity(services, token || session.medium || '', session.city)
      : (token ? filterForBrowseOrFamily(services, token) : services);
    const areaLabel =
      pool
        .map((s) => getAreaLabel(s))
        .find((a) => a && canonicalizeServiceName(a) === areaKey)
      || titleCase(areaKey.replace(/-/g, ' '));
    const nextSession: ProgressiveSession = {
      ...session,
      area: areaLabel,
      browseToken: token || session.browseToken,
      medium: session.medium || token || undefined,
    };
    return advanceFunnel(nextSession, services);
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

    // Multi-service Confirm → one quote with all lines when each medium can resolve
    if (allChips.length > 1) {
      type WorkItem = {
        medium: string;
        browseToken?: string;
        qty: number | null;
        city?: string;
        candidateServiceIds?: string[];
      };
      const readyReps: DbService[] = [];
      const needFunnel: WorkItem[] = [];

      for (const chip of allChips) {
        const med = canonicalizeServiceName(chip.medium);
        if (!med) continue;
        let hits = filterByExactMedium(services, med);
        if (!hits.length) {
          hits = services.filter((s) => serviceMatchesMediumChip(s, chip));
        }
        if (session.city) {
          const scoped = filterHitsBySessionLocation(hits, { ...session, medium: med, city: session.city });
          if (scoped.length) hits = scoped;
        }
        if (session.area || session.placeHint) {
          const scoped = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            area: session.area || session.placeHint,
          });
          if (scoped.length) hits = scoped;
        }
        if (!hits.length) continue;

        if (chip.mediumType) {
          const mt = canonicalizeServiceName(chip.mediumType);
          const typed = hits.filter((s) => {
            const got = getMediumTypeFromDb(s);
            return !!got && canonicalizeServiceName(got) === mt;
          });
          if (typed.length) hits = typed;
        }

        const cities = uniqueCityOptionsFromPool(hits, med);
        // Shared city on session, or exactly one city in pool → try to pick a rep
        const cityLock =
          session.city
          || (cities.length === 1 ? (cities[0].city || cities[0].label) : undefined);

        let scoped = hits;
        if (cityLock) {
          scoped = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            city: cityLock,
          });
          if (!scoped.length) scoped = hits;
        }

        const withDir = scoped.filter((s) => !!getDirectionLabel(s));
        const dirKeys = [
          ...new Set(
            withDir
              .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
              .filter(Boolean),
          ),
        ];

        // Ready when city known and at most one direction (or no directions / single site)
        if (cityLock && (dirKeys.length <= 1 || scoped.length === 1)) {
          const rep =
            (dirKeys.length === 1 && withDir[0])
            || scoped[0];
          if (rep) readyReps.push(rep);
          continue;
        }

        needFunnel.push({
          medium: med,
          browseToken: med,
          qty: session.qty,
          city: cityLock,
          candidateServiceIds: scoped.map((s) => s.service_id),
        });
      }

      // All resolved → one multi-line quote
      if (readyReps.length > 0 && needFunnel.length === 0) {
        return finalizeSelection(readyReps, {
          ...session,
          needsContinueConfirm: false,
          workQueue: undefined,
          pendingCityQueue: undefined,
        }, services);
      }

      // Some need funnel — queue the rest; seed collectedRows with ready reps
      let seedRows: ConfirmationRow[] = [...(session.collectedRows || [])];
      let seedIds: string[] = [...(session.collectedServiceIds || [])];
      if (readyReps.length > 0) {
        const built = buildRowsForServices(
          readyReps,
          session.qty,
          session.durationText,
          session.originalText,
          session.qtyByServiceId,
        );
        seedRows = [...seedRows, ...built.rows];
        seedIds = [...seedIds, ...readyReps.map((s) => s.service_id)];
      }

      if (needFunnel.length === 0) {
        if (seedRows.length) {
          return finalizeSelection([], {
            ...session,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
          }, services);
        }
      } else {
        const [first, ...rest] = needFunnel;
        return advanceFunnel(
          {
            ...session,
            medium: canonicalizeServiceName(first.medium),
            browseToken: canonicalizeServiceName(first.browseToken || first.medium),
            mediumType: undefined,
            city: first.city || session.city,
            area: session.area || session.placeHint,
            qty: first.qty,
            candidateServiceIds: first.candidateServiceIds,
            workQueue: rest,
            pendingCityQueue: undefined,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
          },
          services,
          rest.length
            ? `Starting with ${titleCase(first.medium)}${first.city ? ` in ${first.city}` : ''} (${rest.length} more after this).`
            : undefined,
        );
      }
    }

    const nextMedium = canonicalizeServiceName(primaryMedium);
    const previousMedium = canonicalizeServiceName(
      session.medium || session.browseToken || '',
    );
    // RULE 8/9: type lock on same medium keeps place; new medium clears stale place
    const mediumChanged = !previousMedium || previousMedium !== nextMedium;
    const lockingType = !!primary?.mediumType;

    const nextSession: ProgressiveSession = {
      ...session,
      medium: nextMedium,
      browseToken: nextMedium,
      needsContinueConfirm: mediumChanged ? false : session.needsContinueConfirm,
      area: mediumChanged ? undefined : session.area,
      placeHint: mediumChanged ? undefined : session.placeHint,
      city: mediumChanged ? undefined : session.city,
      candidateServiceIds: mediumChanged ? undefined : session.candidateServiceIds,
      pendingCityQueue: mediumChanged ? undefined : session.pendingCityQueue,
      mediumType: lockingType
        ? canonicalizeServiceName(primary!.mediumType!)
        : mediumChanged
          ? undefined
          : session.mediumType,
      pendingMedia: pending.filter(
        (m) => !allChips.some((c) => canonicalizeServiceName(c.medium) === canonicalizeServiceName(m)),
      ),
    };

    // Continue strict funnel: Type → City → Area → Direction
    return advanceFunnel(nextSession, services);
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
  if (
    actionId.startsWith('direction:')
    || (selectedIds?.length && selectedIds.every((id) => id.startsWith('direction:')))
  ) {
    const ids = selectedIds?.length
      ? selectedIds.map((id) => (id.startsWith('direction:') ? id.slice(10) : id))
      : [actionId.slice(10)];
    const selected = services.filter((s) => ids.includes(s.service_id));
    if (selected.length) return finalizeSelection(selected, session, services);
  }

  // Batch-group confirm: each selectedId is "batch-group:id1,id2,..."
  // Sequential: process first service+city via funnel; remaining go to workQueue.
  const hasBatchGroup = (selectedIds || [actionId]).some((id) => id.startsWith('batch-group:'));
  if (hasBatchGroup) {
    const selectedChips = (selectedIds || [actionId]).filter((id) => id.startsWith('batch-group:'));

    type WorkItem = {
      medium: string;
      browseToken?: string;
      qty: number | null;
      city?: string;
      candidateServiceIds: string[];
    };
    const workItems: WorkItem[] = [];

    for (const chipId of selectedChips) {
      const ids = chipId.slice(12).split(',').filter(Boolean);
      let candidates = services.filter((s) => ids.includes(s.service_id));
      if (!candidates.length) continue;
      const rep = candidates[0];
      const city =
        extractRealCityFromDbService(rep)
        || (rep && matchKnownCityLabel(getMetaCityRaw(rep) || '') ? matchKnownCityLabel(getMetaCityRaw(rep) || '') : null)
        || undefined;
      // Never lock work-item city to a locality (Anna Nagar) — only known metros
      const cityLock =
        city
        || (ids
          .map((id) => services.find((s) => s.service_id === id))
          .map((s) => (s ? extractRealCityFromDbService(s) : null))
          .find(Boolean) || undefined);
      const medium = getMediumKey(rep) || session.browseToken || session.medium || 'service';
      const family = canonicalizeServiceName(medium).split(/\s+/).filter(Boolean)[0] || medium;

      // Expand to ALL family rows in this real city so Metro shows Elevated/Underground/Wrap/Train Inside
      if (cityLock && family.length >= 3) {
        const broader = filterForBrowseOrFamily(services, family).filter((s) => {
          const real = extractRealCityFromDbService(s);
          if (real && canonicalizeServiceName(real) === canonicalizeServiceName(cityLock)) {
            return true;
          }
          // Locality-only rows promoted when sole city of this chip group
          return !real && ids.includes(s.service_id);
        });
        if (broader.length > candidates.length) candidates = broader;
      }

      let qty: number | null = session.qty;
      for (const id of ids) {
        if (session.qtyByServiceId?.[id] != null) {
          qty = session.qtyByServiceId[id];
          break;
        }
      }
      workItems.push({
        // Lock family token ("metro") so pool includes Station / Wrap / Train Inside
        medium: canonicalizeServiceName(family),
        browseToken: canonicalizeServiceName(family),
        qty,
        city: cityLock || undefined,
        candidateServiceIds: candidates.map((s) => s.service_id),
      });
    }

    // Autos already in collectedRows — keep them
    const autoRows = session.collectedRows || [];
    const autoIds = session.collectedServiceIds || [];

    if (!workItems.length) {
      if (autoIds.length) {
        const autoSvcs = services.filter((s) => autoIds.includes(s.service_id));
        const autoRepMap = new Map<string, DbService>();
        for (const svc of autoSvcs) {
          const gk = batchGroupKey(svc);
          if (!autoRepMap.has(gk)) autoRepMap.set(gk, svc);
        }
        if (autoRepMap.size) {
          return finalizeSelection([...autoRepMap.values()], {
            ...session,
            collectedRows: autoRows,
            collectedServiceIds: [],
            segments: undefined,
            workQueue: undefined,
          }, services);
        }
      }
      return {
        step: 'no_match',
        botText: 'Sure — type what you need.',
        options: [],
        session,
      };
    }

    // Deduplicate work by medium+city
    const uniqWork: WorkItem[] = [];
    const seenW = new Set<string>();
    for (const w of workItems) {
      const key = `${canonicalizeServiceName(w.medium)}|${(w.city || '').toLowerCase()}`;
      if (seenW.has(key)) continue;
      seenW.add(key);
      uniqWork.push(w);
    }

    const [first, ...rest] = uniqWork;
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(first.medium),
        browseToken: canonicalizeServiceName(first.browseToken || first.medium),
        mediumType: undefined,
        city: first.city,
        area: session.placeHint || undefined,
        qty: first.qty,
        candidateServiceIds: first.candidateServiceIds,
        workQueue: rest,
        pendingCityQueue: undefined,
        collectedRows: autoRows,
        collectedServiceIds: autoIds,
        segments: session.segments,
      },
      services,
      rest.length
        ? `Starting with ${titleCase(first.medium)}${first.city ? ` in ${first.city}` : ''} (${rest.length} more after this).`
        : undefined,
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
