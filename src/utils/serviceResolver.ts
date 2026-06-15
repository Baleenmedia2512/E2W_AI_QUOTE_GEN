import { QuoteItem } from '../types/quote';
import { canonicalizeServiceName } from '../hooks/useCityServiceRegistry';

const CITY_NAMES = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tiruchirappalli',
  'erode', 'tirunelveli', 'vellore', 'thanjavur', 'tiruppur', 'hosur', 'bangalore', 'mumbai',
  'delhi', 'hyderabad', 'pune', 'kolkata', 'ahmedabad', 'surat', 'jaipur', 'lucknow',
  'kochi', 'vizag', 'visakhapatnam', 'nagpur', 'nashik', 'mysore', 'mysuru',
];

export interface DbService {
  service_id: string;
  service_name: string;
  metadata?: {
    locations?: string[];
    duration?: string;
    pricing?: {
      min_quantity?: number;
      period?: string;
      display_period?: string;
      unit?: string;
      structure?: string;
    };
    min_quantity?: number;
  };
  document_name?: string;
}

/** Minimal fields needed for service_id resolution (works in ReferenceImages local type too). */
export type ServiceLookupItem = Pick<QuoteItem, 'description' | 'serviceId' | 'serviceName' | 'title'>;

export function toServiceIdKebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeServiceId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Collect unique service_ids for quote items — uses item.serviceId or name match against cloud pages. */
export function resolveServiceIdsForItems(
  items: ServiceLookupItem[],
  proposalPages: Array<{ serviceId?: string; serviceName?: string; city?: string; sourceName?: string }>,
): Set<string> {
  const ids = new Set<string>();
  if (!items.length || !proposalPages.length) return ids;

  const cityHint = extractCityHint(items.map((i) => i.description).join(' '));

  for (const item of items) {
    if (item.serviceId) {
      ids.add(item.serviceId);
      continue;
    }
    const name = extractServiceNameFromItem(item);
    if (!name) continue;
    const canonical = canonicalizeServiceName(name);

    let candidates = proposalPages.filter(
      (p) => p.serviceId && p.serviceName
        && canonicalizeServiceName(p.serviceName) === canonical,
    );

    if (candidates.length === 0) {
      candidates = proposalPages.filter((p) => {
        if (!p.serviceId || !p.serviceName) return false;
        const sc = canonicalizeServiceName(p.serviceName);
        return sc.includes(canonical) || canonical.includes(sc);
      });
    }

    if (cityHint && candidates.length > 1) {
      const cityFiltered = candidates.filter(
        (p) => p.city?.toLowerCase().includes(cityHint)
          || (p.sourceName || '').toLowerCase().includes(cityHint),
      );
      if (cityFiltered.length > 0) candidates = cityFiltered;
    }

    if (candidates[0]?.serviceId) {
      ids.add(candidates[0].serviceId);
      console.log(`🔗 [ServiceId] Preview resolved "${name}" → ${candidates[0].serviceId}`);
    }
  }
  return ids;
}

/** Extract city hint from free text (user message or item description). */
export function extractCityHint(text: string): string | null {
  const lower = text.toLowerCase();
  for (const city of CITY_NAMES) {
    if (lower.includes(city)) return city;
  }
  return null;
}

/**
 * Resolve a human-readable service name to proposal_chunks.service_id.
 * Uses canonical name matching with optional city filtering.
 */
export function resolveServiceIdFromCatalog(
  name: string,
  services: DbService[],
  cityHint?: string | null,
): { serviceId: string; serviceName: string } | null {
  if (!name?.trim() || services.length === 0) return null;

  const canonical = canonicalizeServiceName(name);
  const kebab = toServiceIdKebab(name);

  let pool = services;
  if (cityHint) {
    const c = cityHint.toLowerCase();
    const cityFiltered = services.filter((s) => {
      const locs: string[] = s.metadata?.locations || [];
      return locs.some((l) => l.toLowerCase().includes(c))
        || (s.document_name || '').toLowerCase().includes(c);
    });
    if (cityFiltered.length > 0) pool = cityFiltered;
  }

  const byId = pool.find((s) => {
    const sid = normalizeServiceId(s.service_id);
    const k = normalizeServiceId(kebab);
    return sid === k || sid.endsWith(`-${k}`);
  });
  if (byId) return { serviceId: byId.service_id, serviceName: byId.service_name };

  const byCanonical = pool.find(
    (s) => canonicalizeServiceName(s.service_name) === canonical,
  );
  if (byCanonical) return { serviceId: byCanonical.service_id, serviceName: byCanonical.service_name };

  const byContains = pool.find((s) => {
    const sc = canonicalizeServiceName(s.service_name);
    return sc.includes(canonical) || canonical.includes(sc);
  });
  if (byContains) return { serviceId: byContains.service_id, serviceName: byContains.service_name };

  return null;
}

/** Extract the service name from a quote item description (text before first " - "). */
export function extractServiceNameFromItem(item: ServiceLookupItem): string {
  const fromDesc = item.description.split(/\s+-\s+/)[0].trim();
  if (fromDesc.length > 2) return fromDesc;
  return item.serviceName || item.title || '';
}

/** Attach proposal_chunks.service_id to each quote item using description/section lookup. */
export function attachServiceIdsToQuoteItems(
  items: QuoteItem[],
  services: DbService[],
  cityHint?: string | null,
): QuoteItem[] {
  if (!services.length) return items;

  const sectionServiceIds = new Map<string, { serviceId: string; serviceName: string }>();

  return items.map((item) => {
    if (item.serviceId) return item;

    // item.title is often the price line label ("Display Price") — use description prefix instead
    const lookupName = extractServiceNameFromItem(item);

    const cached = sectionServiceIds.get(lookupName.toLowerCase());
    if (cached) {
      return { ...item, serviceId: cached.serviceId, serviceName: cached.serviceName };
    }

    const resolved = resolveServiceIdFromCatalog(lookupName, services, cityHint);
    if (resolved) {
      sectionServiceIds.set(lookupName.toLowerCase(), resolved);
      console.log(`🔗 [ServiceId] "${lookupName}" → ${resolved.serviceId}`);
      return { ...item, serviceId: resolved.serviceId, serviceName: resolved.serviceName };
    }

    console.warn(`⚠️ [ServiceId] Could not resolve: "${lookupName}"`);
    return item;
  });
}
