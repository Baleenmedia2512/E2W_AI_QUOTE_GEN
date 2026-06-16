import { QuoteItem } from '../types/quote';
import { canonicalizeServiceName } from '../hooks/useCityServiceRegistry';
import {
  DbService,
  extractCityHint,
  extractServiceNameFromItem,
  resolveServiceIdFromCatalog,
} from './serviceResolver';

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

function titleCaseService(name: string): string {
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/** Extract meaningful query words (supports single-word queries like "bus"). */
export function extractQueryWords(query: string): string[] {
  return query
    .replace(/\d+/g, '')
    .replace(/\b(need|for|the|a|an|in|at|of|and|i|want|please|generate|quote|services?|ads?|advertising|outdoor|some|any)\b/gi, '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
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

/** Extract a city slug from a DB service row (locations array or document_name). */
export function extractCityFromDbService(svc: DbService): string | null {
  const locs: string[] = svc.metadata?.locations || [];
  for (const loc of locs) {
    const lower = loc.toLowerCase();
    const key = CLOUD_CITY_KEYS.find((c) => lower.includes(c));
    if (key) return titleCaseCity(key);
    const direct = normalizeCityLabel(loc);
    if (direct) return direct;
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

  const cleaned = text
    .toLowerCase()
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\b(show|me|all|list|services?|in|for|of|the|a|an|please|what|whats|which|available|need|want|i|about|tell|give)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const cities: string[] = [];
  for (const t of tokens) {
    const match = cityListLower.find((c) => c === t);
    if (!match) return [];
    if (!cities.includes(match)) cities.push(match);
  }
  return cities;
}

function citiesMatch(svcCity: string, selectedCity: string): boolean {
  const a = svcCity.toLowerCase();
  const b = selectedCity.toLowerCase();
  return a.includes(b) || b.includes(a);
}

export function serviceMatchesQuery(svc: DbService, words: string[]): boolean {
  if (words.length === 0) return false;
  const name = (svc.service_name || '').toLowerCase();
  const canonical = canonicalizeServiceName(svc.service_name || '');
  const queryCanonical = canonicalizeServiceName(words.join(' '));

  if (words.length === 1) {
    const w = words[0];
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(name)) return true;
    if (canonical && queryCanonical && (canonical.includes(queryCanonical) || queryCanonical.includes(canonical))) {
      return true;
    }
    // Avoid loose substring match on short words ("semi", "bus") — causes irrelevant services
    if (w.length >= 4 && name.includes(w)) return true;
    return false;
  }

  if (canonical && queryCanonical && (canonical.includes(queryCanonical) || queryCanonical.includes(canonical))) {
    return true;
  }
  return words.every((w) => name.includes(w));
}

/** Deduplicate DB rows by canonical service name. */
export function dedupeDbServices(services: DbService[]): DbService[] {
  const seen = new Set<string>();
  const out: DbService[] = [];
  for (const svc of services) {
    const key = canonicalizeServiceName(svc.service_name || '') || svc.service_id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(svc);
  }
  return out;
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

  const matched = services.filter((svc) => serviceMatchesQuery(svc, words));
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

/** Auto-assign city when a segment's service exists in exactly one DB city. */
export function buildCloudSegmentCityPlan(
  segments: CloudSegmentPlan[],
  dbServices: DbService[],
  forcePickerForSingleCityless: boolean,
): CloudSegmentPlan[] {
  return segments.map((seg) => {
    if (!seg.cityNeeded || seg.detectedCity) return seg;

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

/** Classify one segment against DB for a known city. */
export function classifySegmentByDb(
  segmentRaw: string,
  city: string,
  services: DbService[],
): { state: SegmentDbState; matches: DbService[] } {
  const matched = getMatchingServicesForCity(segmentRaw, city, services);
  if (matched.length === 0) return { state: 'not_found', matches: [] };

  // Only auto-confirm without checkboxes when user typed a FULL service name
  if (FULL_SERVICE_PATTERNS.some((p) => p.test(segmentRaw))) {
    const words = extractQueryWords(stripCitiesFromSegment(segmentRaw, [city]));
    const queryCanon = canonicalizeServiceName(words.join(' '));
    const exact = matched.find(
      (s) => canonicalizeServiceName(s.service_name || '') === queryCanon,
    );
    return { state: 'specific', matches: exact ? [exact] : [matched[0]] };
  }

  return { state: 'vague', matches: matched };
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
    services.filter((svc) => {
      const svcCity = extractCityFromDbService(svc);
      return svcCity != null && citiesMatch(svcCity, cityKey);
    }),
  );
  if (matched.length === 0) return null;

  const cityLabel = cityKey.charAt(0).toUpperCase() + cityKey.slice(1);
  return {
    city: cityLabel,
    services: matched.map((svc) => ({
      name: titleCaseService(svc.service_name || ''),
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
      continue;
    }

    if (cls.state === 'vague') {
      const group = buildGroupedServicesFromDb(row.raw, row.city, row.qty, services);
      if (group) vagueGroups.push(group);
      continue;
    }

    const svc = cls.matches[0];
    const svcName = titleCaseSvc(svc.service_name || '');
    const minimum = getMinQuantityFromDbService(svc);
    if (minimum != null && row.qty < minimum) {
      belowMinSegments.push({
        rawSegment: row.raw,
        requestedQty: row.qty,
        minQty: minimum,
        svcLabel: svcName,
        cityLabel,
      });
    }
    validSegmentRaws.push(`${row.qty} ${svc.service_name} ${cityLabel}`);
    validSegmentLabels.push(`${row.qty} ${svcName} (${cityLabel})`);
  }

  return { preAlerts, validSegmentRaws, validSegmentLabels, vagueGroups, belowMinSegments };
}

/** All DB services matching query scoped to one city. */
export function getMatchingServicesForCity(
  query: string,
  city: string,
  services: DbService[],
): DbService[] {
  const allCities = collectCitiesFromDbServices(services);
  const queryBody = stripCitiesFromSegment(query, allCities.length ? allCities : [city]);
  const words = extractQueryWords(queryBody);
  if (words.length === 0 || !city) return [];

  return dedupeDbServices(
    services.filter((svc) => {
      if (!serviceMatchesQuery(svc, words)) return false;
      const svcCity = extractCityFromDbService(svc);
      return svcCity != null && citiesMatch(svcCity, city);
    }),
  );
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
  services: Array<{ name: string; category: string }>;
} | null {
  const matched = getMatchingServicesForCity(query, city, services);
  if (matched.length === 0) return null;

  const words = extractQueryWords(query);
  const baseWord = words[0] || 'Service';
  const groupLabel = baseWord.charAt(0).toUpperCase() + baseWord.slice(1);
  const cityLabel = city.charAt(0).toUpperCase() + city.slice(1);

  return {
    vehicleType: `${groupLabel}|${cityLabel}`,
    requestedQuantity: qty,
    services: matched.map((svc) => ({
      name: titleCaseService(svc.service_name || ''),
      category: groupLabel,
    })),
  };
}

/** Read minimum order quantity from proposal_chunks metadata. */
export function getMinQuantityFromDbService(svc: DbService): number | null {
  const m = svc.metadata || {};
  const pricing = (m.pricing || {}) as { min_quantity?: number };
  const raw = pricing.min_quantity ?? (m as { min_quantity?: number }).min_quantity;
  if (raw == null || (typeof raw === 'string' && raw === '')) return null;
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
}

/** Min-qty check for confirm-table rows BEFORE sending to Gemini. */
export function dedupeConfirmationRows(rows: ConfirmationRow[]): ConfirmationRow[] {
  const seen = new Set<string>();
  const out: ConfirmationRow[] = [];
  for (const row of rows) {
    const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const svcKey = canonicalizeServiceName(row.service) || row.service.toLowerCase().trim();
    const cityKey = (row.city && row.city !== '—' ? row.city : '').toLowerCase().trim();
    const key = `${svcKey}|${cityKey}|${qty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, qty });
  }
  return out;
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
    const resolved = resolveServiceIdFromCatalog(row.service, services, cityHint);
    if (!resolved) continue;

    const svc = services.find((s) => s.service_id === resolved.serviceId);
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
