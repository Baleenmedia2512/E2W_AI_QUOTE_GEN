import { QuoteItem } from '../types/quote';
import { canonicalizeServiceName } from '../hooks/useCityServiceRegistry';
import {
  DbService,
  extractCityHint,
  extractServiceNameFromItem,
  resolveServiceIdFromCatalog,
} from './serviceResolver';

/** Known city keys used across the app (lowercase). */
export const CLOUD_CITY_KEYS = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tiruchirappalli',
  'erode', 'tirunelveli', 'vellore', 'thanjavur', 'tiruppur', 'hosur', 'bangalore', 'mumbai',
  'delhi', 'hyderabad', 'pune', 'kolkata', 'ahmedabad', 'surat', 'jaipur', 'lucknow',
  'kochi', 'vizag', 'visakhapatnam', 'nagpur', 'nashik', 'mysore', 'mysuru',
];

/** Vehicle / category keywords that imply quote intent even as a single word. */
export const VEHICLE_CATEGORY_PATTERN =
  /\b(bus|buses|auto|autos|cab|cabs|tempo|tempos|metro|train|hoarding|hoardings|gantry|shelter|shelters|lamp\s*post|lift|apartment|vehicle|vehicles|newspaper|radio|billboard|transit|van|vans)\b/i;

const FULL_SERVICE_PATTERNS = [
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

/** Extract a city slug from a DB service row (locations array or document_name). */
export function extractCityFromDbService(svc: DbService): string | null {
  const locs: string[] = svc.metadata?.locations || [];
  for (const loc of locs) {
    const key = CLOUD_CITY_KEYS.find((c) => loc.toLowerCase().includes(c));
    if (key) return titleCaseCity(key);
  }
  const docName = (svc.document_name || '').toLowerCase();
  for (const key of CLOUD_CITY_KEYS) {
    if (docName.includes(key)) return titleCaseCity(key);
  }
  return null;
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
    if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name)) return true;
    if (canonical && queryCanonical && (canonical.includes(queryCanonical) || queryCanonical.includes(canonical))) {
      return true;
    }
    return name.includes(w);
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

/**
 * Find distinct cities in DB that carry the service described by the user query.
 */
export function getCitiesForServiceQuery(query: string, services: DbService[]): string[] {
  const words = extractQueryWords(query);
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

/** All DB services matching query scoped to one city. */
export function getMatchingServicesForCity(
  query: string,
  city: string,
  services: DbService[],
): DbService[] {
  const words = extractQueryWords(query);
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
  if (raw == null || raw === '') return null;
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
