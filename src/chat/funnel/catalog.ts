/**
 * Funnel catalog — split from body.ts (Phase 8).
 */
import {
  ConfirmationRow,
  extractCityFromDbService,
  extractQueryWords,
  getMinQuantityFromDbService,
  geoNamesLooselyMatch,
  serviceCoversResolvedLocation,
  serviceMatchesQuery,
} from '../../utils/cloudQuoteValidation';
import { canonicalizeServiceName } from '../../utils/serviceNameUtils';
import { hasQuotablePricing, pickPreferredDbService } from '../../utils/dbPricingUtils';
import type { DbService } from '../../utils/serviceResolver';
import { formatServiceDisplayName } from '../../utils/serviceResolver';
import { getServiceScopedUserMessage, parseDurationFromUserText, toCampaignDays } from '../../utils/durationUtils';
import { resolveMediaAgainstCatalog } from '../../services/chatIntentAiService';
import {
  directionKeys,
  isStrongDirectionMatch,
  scoreDirectionMatch,
} from '../../utils/directionMatcher';
import type { ResolvedLocation } from '../../types/location';
import { titleCase } from './shared';

/**
 * Product-approved Madurai misspellings only (not generic fuzzy cities).
 * Maps typed token → canonical metro key.
 */
export const CITY_TYPO_ALIASES: Record<string, string> = {
  maddurai: 'madurai',
  maduari: 'madurai',
  madhurai: 'madurai',
  madaurai: 'madurai',
};

/** Metro keys from active DB catalog — refreshed per turn from services[]. */
let _activeCatalogMetroKeys: string[] = [];

export function syncCatalogMetroKeys(services: DbService[]): void {
  if (!services?.length) return;
  const keys = new Set<string>();
  for (const svc of services) {
    const label = funnelCityFromDb(svc);
    if (!label) continue;
    const key = canonicalizeServiceName(label);
    if (key) keys.add(key);
  }
  for (const v of Object.values(CITY_TYPO_ALIASES)) {
    keys.add(canonicalizeServiceName(v));
  }
  _activeCatalogMetroKeys = [...keys].sort((a, b) => b.length - a.length);
}

let _localityCacheRef: DbService[] | null = null;
let _localityCache: string[] = [];



export function catalogMetroKeys(): string[] {
  return _activeCatalogMetroKeys;
}




/** Five DB funnel fields for simple console REQ/RES logs. */

export function matchKnownCityLabel(value: string): string | null {
  const lower = value.toLowerCase().trim();
  if (!lower) return null;
  const exact = catalogMetroKeys().find((c) => lower === c);
  if (exact) return exact.charAt(0).toUpperCase() + exact.slice(1);
  // "Chennai North" ok — but not "PAN India (except Mumbai)" via substring
  const prefixed = catalogMetroKeys().find(
    (c) =>
      lower.startsWith(`${c} `)
      || lower.startsWith(`${c},`)
      || lower.startsWith(`${c}-`)
      || lower.startsWith(`${c}/`),
  );
  if (prefixed) return prefixed.charAt(0).toUpperCase() + prefixed.slice(1);
  return null;
}


export function isKnownCityKey(value: string): boolean {
  return !!matchKnownCityLabel(value);
}


export function metaFieldClean(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s || s.toUpperCase() === 'NA') return null;
  return s;
}

/** Raw metadata.city (may be a metro OR a locality like Padur). */

export function getMetaCityRaw(svc: DbService): string | null {
  return metaFieldClean((svc.metadata as { city?: string } | undefined)?.city);
}

/**
 * City for funnel chips / locks — what the DB actually stores.
 * 1) metadata.city as-is (OMR, Padur, Chennai, …)
 * 2) if blank → area_name / area
 * Never invent a metro (Chennai) when the row only has OMR/Padur.
 */

export function funnelCityFromDb(svc: DbService): string | null {
  const raw = getMetaCityRaw(svc);
  if (raw && !isNumericOnlyLabel(raw) && !isDirectionLikeLabel(raw)) {
    return titleCase(raw);
  }
  const area = getMetaAreaRaw(svc);
  if (area && !isNumericOnlyLabel(area) && !isDirectionLikeLabel(area)) {
    return titleCase(area);
  }
  return null;
}

/**
 * Neighbourhood-level area from metadata.area / area_name.
 * Skips numeric-only values (size/rate codes like "1000", "400") — those are not places.
 * Does NOT include direction_remarks (street-level; used in direction step).
 */

export function getMetaAreaRaw(svc: DbService): string | null {
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

export function isNumericOnlyLabel(value: string): boolean {
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

/** Stable key for duplicate DB chips; does not merge different words or labels. */

export function dbChipValueKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Identity for DB field values: preserve case and wording exactly. */

export function exactDbValueKey(value: string): string {
  return value.trim();
}

/** Long road / direction-style labels — not city or area chips. */

export function isDirectionLikeLabel(value: string): boolean {
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
  // Preserve the catalog value; do not collapse it into a hardcoded metro.
  return titleCase(raw);
}

/**
 * When vendor rows put a locality in metadata.city (Padur, Vadapalani…)
 * instead of a metro, return that locality.
 * @deprecated Prefer getDbCityLabel for city chips; kept for locality browse.
 */

export function getLocalityFromMetaCity(svc: DbService): string | null {
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
  for (const city of catalogMetroKeys()) {
    if (sid.endsWith(`-${city}`) || sid.includes(`-${city}-`)) {
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }

  const docName = (svc.document_name || '').toLowerCase();
  for (const key of catalogMetroKeys()) {
    if (docName.includes(key)) return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // Fall back to shared extractor, then drop if not a known city key
  const loose = extractCityFromDbService(svc);
  if (loose && catalogMetroKeys().includes(loose.toLowerCase())) return loose;
  return null;
}

/** Distinct cities for funnel — raw DB city (else area_name), no metro invent. */

export function getCatalogCities(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const s of services) {
    const c = funnelCityFromDb(s);
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}


export function titleCaseCityKey(key: string): string {
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


export function parseDurationFromText(text: string): string | null {
  const m = text.match(/\b(\d+)\s*(days?|months?|weeks?)\b/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

/**
 * Read an explicitly requested location without deciding whether it exists.
 * The value is validated against the DB by the caller; this only prevents an
 * unknown location from silently becoming "no location".
 */

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

  // Labels that appear as metadata.city but never as area_name are cities
  // (Tirupathi / Chittoor), not localities — keep them out of area matching.
  const areaKeys = new Set<string>();
  for (const s of services) {
    const a = getMetaAreaRaw(s);
    if (a) areaKeys.add(canonicalizeServiceName(a));
  }
  const cityOnlyKeys = new Set<string>();
  for (const s of services) {
    const c = getMetaCityRaw(s);
    if (!c) continue;
    const ck = canonicalizeServiceName(c);
    if (ck && !areaKeys.has(ck) && !matchKnownCityLabel(c)) {
      cityOnlyKeys.add(ck);
    }
  }

  const set = new Set<string>();
  const addIfPlace = (raw: string | null | undefined) => {
    if (!raw || isNumericOnlyLabel(raw) || matchKnownCityLabel(raw)) return;
    const key = canonicalizeServiceName(raw);
    if (!key) return;
    if (cityOnlyKeys.has(key)) return;
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

/** Place prepositions/cues — strip before locality prefix match ("near ecr" → ecr). */
export const PLACE_CUE_WORDS = new Set([
  'near', 'around', 'nearby', 'beside', 'opposite', 'opp', 'at', 'in', 'for',
  'towards', 'toward', 'close', 'to',
]);

/** Detect a DB locality/area name in free text (e.g. "saidapet", "muttukadu", "near ecr"). */

export function getChipImageUrl(svc: DbService | null | undefined): string | undefined {
  if (!svc) return undefined;
  const meta = svc.metadata;
  if (!meta) return undefined;
  const images = meta.images;
  if (Array.isArray(images) && images.length > 0) {
    const ref = images.find((i) => {
      const t = (i.type || '').toLowerCase();
      return t === 'reference' || t === 'reference_image' || t.includes('ref');
    });
    const url = (ref?.url || images[0]?.url || '').trim();
    if (url) return url;
  }
  const single = meta.reference_image;
  if (typeof single === 'string' && single.trim()) return single.trim();
  return undefined;
}

/** First available reference image in a row group. */

export function firstChipImage(rows: DbService[]): string | undefined {
  for (const s of rows) {
    const url = getChipImageUrl(s);
    if (url) return url;
  }
  return undefined;
}

/**
 * Prefer the first reference image from THIS chip's own matching DB rows.
 * Area/direction/medium lists always show a thumb when that group has an image —
 * never borrow another area/direction's image, and never hide thumbs just because
 * the next funnel step still has 2+ options.
 *
 * `next` is retained for call-site clarity / future tightening; uniqueness is
 * no longer required for showing a thumbnail.
 */

export function chipImageIfUniqueNext(
  rows: DbService[],
  _next: 'city' | 'area' | 'direction' | 'site',
): string | undefined {
  if (!rows.length) return undefined;
  return firstChipImage(rows);
}


export function getMediumKey(svc: DbService | null | undefined): string {
  if (!svc) return 'service';
  const meta = svc.metadata as { medium?: string; medium_type?: string } | undefined;
  const medium = String(meta?.medium || '').trim();
  if (medium && medium.toUpperCase() !== 'NA') {
    return canonicalizeServiceName(medium.split(/[·|]/)[0] || medium);
  }
  // When medium is absent, preserve the complete DB service label as the
  // catalog medium. Reducing it to the first word makes related products
  // indistinguishable and prevents exact full-name matching.
  const name = (svc.service_name || '').split(/[·|]/)[0] || '';
  const fullName = canonicalizeServiceName(name);
  if (fullName) return fullName;
  const sid = (svc.service_id || '').toLowerCase();
  return sid.split('-')[0] || 'service';
}

/**
 * DB medium_type for funnel Type step — metadata.medium_type only.
 * Skip blank / NA / direction-like junk; never invent from service_id or whitelist.
 */

export function getMediumTypeFromDb(svc: DbService | null | undefined): string | null {
  if (!svc) return null;
  const meta = svc.metadata as {
    medium_type?: string;
    mediumType?: string;
    type_of_medium?: string;
  } | undefined;
  const raw = String(
    meta?.medium_type || meta?.mediumType || meta?.type_of_medium || '',
  ).trim();
  if (!raw || raw.toUpperCase() === 'NA') return null;
  const cleaned = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Direction text wrongly stored as medium_type — not a Type chip
  if (isDirectionLikeLabel(cleaned) || cleaned.split(/\s+/).length > 6) return null;
  return titleCase(cleaned);
}

/**
 * Detect catalog medium_type in free text (Frontlit / Nonlit / …).
 * Scoped to medium when provided; DB values only — never invent types.
 */

export function detectMediumTypeInText(
  text: string,
  services: DbService[],
  medium?: string | null,
): string | null {
  if (!text?.trim() || !services?.length) return null;
  const pool = medium
    ? filterForBrowseOrFamily(services, medium)
    : services;
  const scoped = pool.length ? pool : services;
  const labels = new Map<string, string>();
  for (const s of scoped) {
    const t = getMediumTypeFromDb(s);
    if (!t) continue;
    const key = canonicalizeServiceName(t);
    if (!key || key.length < 3) continue;
    labels.set(key, t);
  }
  if (!labels.size) return null;
  const lower = text.toLowerCase();
  const keys = [...labels.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(
      `\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    );
    if (re.test(lower)) return labels.get(key) || null;
  }
  return null;
}

/**
 * Detect a complete catalog medium + DB type phrase in one user turn.
 *
 * This is intentionally DB-driven and conservative. It lets inputs such as
 * "Bus Semi Branding" and "Mobile Van Non LED" lock the service and type
 * together, while a bare "Bus" or "Mobile Van" continues through the normal
 * family funnel.
 */

export function detectExactCatalogSelection(
  text: string,
  services: DbService[],
): { medium: string; mediumType?: string } | null {
  const query = canonicalizeServiceName(text);
  if (!query) return null;

  // Mobile Van LED and Non LED are sibling catalog services. Resolve the
  // explicit variant before broader medium/type matching can merge them.
  const mobileVanVariant = query.match(/\bmobile\s+van\s+(non\s+led|led)\b/i)?.[1];
  if (mobileVanVariant) {
    const wantsNonLed = canonicalizeServiceName(mobileVanVariant) === 'non led';
    const variantMatches = services.filter((service) => {
      const haystack = canonicalizeServiceName([
        service.service_name || '',
        getMediumKey(service),
        getMediumTypeFromDb(service) || '',
        service.service_id || '',
      ].join(' '));
      const isNonLed = /\bnon\s+led\b/i.test(haystack);
      const hasLed = /\bled\b/i.test(haystack);
      return /\bmobile\s+van\b/i.test(haystack)
        && (wantsNonLed ? isNonLed : hasLed && !isNonLed);
    });
    const selected = pickPreferredDbService(variantMatches);
    if (selected) {
      return {
        medium: getMediumKey(selected),
        mediumType: getMediumTypeFromDb(selected) || undefined,
      };
    }
  }

  const candidates = services
    .map((service) => {
      const medium = getMediumKey(service);
      const mediumType = getMediumTypeFromDb(service);
      const mediumKey = canonicalizeServiceName(medium);
      const typeKey = mediumType ? canonicalizeServiceName(mediumType) : '';
      const serviceName = canonicalizeServiceName(
        (service.service_name || '').split(/[·|]/)[0] || '',
      );
      // A bare medium must not inherit the type from whichever vendor row
      // happens to be encountered first. For example, "hoarding" must remain
      // untyped even when the first DB row is Nonlit; the funnel must still
      // ask for Frontlit/Nonlit. A type is locked only when it is explicit in
      // the matched service phrase.
      const phrases = [
        { phrase: mediumKey, explicitType: false },
        {
          phrase: serviceName,
          explicitType: !!typeKey && serviceName.includes(typeKey),
        },
        {
          phrase: [
            mediumKey,
            typeKey && !mediumKey.includes(typeKey) ? typeKey : '',
          ]
            .filter(Boolean)
            .join(' ')
            .trim(),
          explicitType: !!typeKey,
        },
      ].filter((candidate) => candidate.phrase.length > 0);
      return phrases.map(({ phrase, explicitType }) => ({
        medium,
        mediumType: explicitType ? mediumType || undefined : undefined,
        phrase,
      }));
    })
    .flat()
    .filter((candidate) => candidate.phrase.length > 0)
    .sort((a, b) => b.phrase.length - a.phrase.length);

  for (const candidate of candidates) {
    const escaped = candidate.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'i').test(query)
    ) {
      return {
        medium: candidate.medium,
        mediumType: candidate.mediumType,
      };
    }
  }

  return null;
}

/** Parse `medium:Foo` or `medium:Foo|elevated` chip ids. */

export function parseMediumChipToken(token: string): { medium: string; mediumType?: string } {
  const raw = token.trim();
  const pipe = raw.indexOf('|');
  if (pipe >= 0) {
    const medium = raw.slice(0, pipe).trim();
    const mediumType = raw.slice(pipe + 1).trim();
    return { medium, mediumType: mediumType || undefined };
  }
  return { medium: raw };
}


export function serviceMatchesMediumChip(
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
        (p, idx) => idx >= 1 && p.length >= 3 && !catalogMetroKeys().includes(p),
      );
      if (candidate) return titleCase(candidate.replace(/_/g, ' '));
    }
  }
  rest = rest.replace(/^-+|-+$/g, '');
  if (!rest || rest.length < 3) return null;
  const firstSeg = rest.split('-')[0] || rest;
  if (catalogMetroKeys().includes(firstSeg) || (city && firstSeg === city)) {
    return null;
  }
  return titleCase(firstSeg.replace(/_/g, ' '));
}

/**
 * Display place for chips: localities as-is; metro+area as "Chennai · Area".
 */

export function resolveDisplayPlace(
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
      imageUrl: getChipImageUrl(svc),
    };
  }

  if (realCity && area) {
    const areaKey = canonicalizeServiceName(area);
    return {
      id: `place:${realCity.toLowerCase()}|${areaKey}`,
      label: `${realCity} · ${area}`,
      city: realCity,
      medium: token,
      imageUrl: getChipImageUrl(svc),
    };
  }

  // Numeric-only or missing area → city chip only (direction asked later)
  if (realCity) {
    return {
      id: `city:${realCity.toLowerCase()}`,
      label: realCity,
      city: realCity,
      medium: token,
      // No thumb on city chips — keeps chat light
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
      imageUrl: getChipImageUrl(svc),
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

export function getFunnelAreaLabel(svc: DbService): string | null {
  const raw = getMetaAreaRaw(svc);
  if (!raw || isNumericOnlyLabel(raw)) return null;
  return raw;
}

/** Merge only exact area names ignoring case/spacing; do not merge by words. */

export function areaDisplayKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Resolve a multi-word user phrase to one catalog medium when the match is unique.
 * Requires 2+ query words so bare family tokens (bus / lamp) still ask.
 */
export function bestCatalogMediumForPhrase(
  phraseKey: string,
  services: DbService[],
): string | null {
  const qWords = phraseKey.split(/\s+/).filter(Boolean);
  if (qWords.length < 2) return null;

  type Hit = { raw: string; key: string; score: number; qInC: boolean; cInQ: boolean };
  const hits: Hit[] = [];
  for (const raw of getCatalogTypeKeys(services)) {
    const key = canonicalizeServiceName(raw);
    if (!key || key.length < 4) continue;
    const cWords = key.split(/\s+/).filter(Boolean);
    if (cWords.length < 2) continue;
    const qInC = qWords.every((w) => cWords.includes(w));
    const cInQ = cWords.every((w) => qWords.includes(w));
    if (!qInC && !cInQ) continue;
    const score =
      (phraseKey === key ? 10000 : 0)
      + (qInC && cInQ ? 5000 : 0)
      + (cInQ ? 2000 : 0)
      + (qInC ? 1000 : 0)
      + key.length;
    hits.push({ raw, key, score, qInC, cInQ });
  }
  if (!hits.length) return null;

  const covering = hits.filter((h) => h.qInC);
  const coveringKeys = [...new Set(covering.map((h) => h.key))];
  if (coveringKeys.length > 1) {
    const precise = covering.filter((h) => h.cInQ || phraseKey === h.key);
    const preciseKeys = [...new Set(precise.map((h) => h.key))];
    if (preciseKeys.length === 1) return precise[0]!.raw;
    return null;
  }

  hits.sort((a, b) => b.score - a.score || b.key.length - a.key.length);
  const best = hits[0]!;
  if (hits.some((h, i) => i > 0 && h.score === best.score && h.key !== best.key)) {
    return null;
  }
  return best.raw;
}

export function resolveExactMediumKey(token: string, services: DbService[]): string | null {
  const t = canonicalizeServiceName(token);
  if (!t) return null;
  if (services.some((s) => canonicalizeServiceName(getMediumKey(s)) === t)) return t;
  if (!t.includes(' ')) return null;
  const hit = bestCatalogMediumForPhrase(t, services);
  return hit ? canonicalizeServiceName(hit) : null;
}

/** True when `token` locks exactly one catalog medium (or equals that medium key). */
export function isExactCatalogMedium(token: string, services: DbService[]): boolean {
  return !!resolveExactMediumKey(token, services);
}

/** Pool used for the City step — same medium/type scope as the funnel pool. */
export function chipDisplayLabel(chip: { medium: string; mediumType?: string }): string {
  const medium = String(chip.medium || '').trim();
  if (chip.mediumType) return `${medium} — ${chip.mediumType}`;
  return medium;
}

/** Lock the only city and continue the funnel (no OK Continue tap). */
