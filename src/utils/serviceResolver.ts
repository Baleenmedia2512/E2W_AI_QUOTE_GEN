import { QuoteItem } from '../types/quote';
import { canonicalizeServiceName } from './serviceNameUtils';
import { pickPreferredDbService } from './dbPricingUtils';

const CITY_NAMES = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tiruchirappalli',
  'erode', 'tirunelveli', 'tenkasi', 'vellore', 'thanjavur', 'tiruppur', 'hosur', 'bangalore', 'mumbai',
  'delhi', 'hyderabad', 'pune', 'kolkata', 'ahmedabad', 'surat', 'jaipur', 'lucknow',
  'kochi', 'vizag', 'visakhapatnam', 'nagpur', 'nashik', 'mysore', 'mysuru',
];

export interface DbService {
  service_id: string;
  service_name: string;
  content?: string;
  metadata?: {
    locations?: string[];
    duration?: string;
    unit_label?: string;
    pricing?: {
      min_quantity?: number;
      min_qty?: number;
      period?: string;
      display_period?: string;
      unit?: string;
      structure?: string;
      display_price?: number | string;
      printing_and_mounting_price?: number | string;
      [key: string]: unknown;
    };
    min_quantity?: number;
    /** Design / coach specs from vendor_rate_chunks.metadata.specifications */
    specifications?: Record<string, unknown>;
    size?: string | Record<string, unknown>;
    material?: string | Record<string, unknown>;
    images?: Array<{ url: string; type: string; pageNumber?: number }>;
    review?: {
      reviewUrl?: string;
      starCount?: number;
      reviewText?: string;
      reviewerName?: string;
    };
    terms?: string;
    [key: string]: unknown;
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

function titleCaseToken(token: string): string {
  if (!token) return '';
  const lower = token.toLowerCase();
  // Keep media / tax acronyms fully uppercase (led → LED, not Led)
  if (
    lower === 'led' ||
    lower === 'lcd' ||
    lower === 'oled' ||
    lower === 'gst' ||
    lower === 'ifsc' ||
    lower === 'abn' ||
    lower === 'atm' ||
    lower === 'tv' ||
    lower === 'ac'
  ) {
    return lower.toUpperCase();
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Known medium-type tokens encoded in service_id after the base service name. */
const MEDIUM_TYPE_TOKENS = new Set([
  'elevated',
  'underground',
  'interior',
  'inside',
  'outside',
  'wrap',
  'platform',
  'lobby',
  'full',
  'semi',
  'back',
  'front',
]);

/**
 * Extract medium type from service_id (e.g. metro-station-elevated-chennai → "Elevated").
 * Returns null when the id has no extra medium discriminator beyond name + city.
 */
export function extractMediumTypeFromServiceId(
  serviceId: string,
  serviceName?: string,
): string | null {
  if (!serviceId?.trim()) return null;
  let rest = normalizeServiceId(serviceId);

  // Strip trailing city slug
  const citiesByLen = [...CITY_NAMES].sort((a, b) => b.length - a.length);
  for (const city of citiesByLen) {
    if (rest.endsWith(`-${city}`)) {
      rest = rest.slice(0, -(city.length + 1));
      break;
    }
  }

  if (serviceName?.trim()) {
    const nameKebab = toServiceIdKebab(serviceName);
    if (rest === nameKebab) return null;
    if (rest.startsWith(`${nameKebab}-`)) {
      rest = rest.slice(nameKebab.length + 1);
    }
  }

  const tokens = rest.split('-').filter(Boolean);
  if (tokens.length === 0) return null;

  // Only known discriminators (elevated / underground / …) — never dump leftover junk
  const known = tokens.filter((t) => MEDIUM_TYPE_TOKENS.has(t));
  if (known.length === 0) return null;
  // Skip if leftover is only the whole id still (couldn't strip name)
  if (known.join('-') === normalizeServiceId(serviceId)) return null;

  return known.map(titleCaseToken).join(' ');
}

/** Parse medium type from a display label like "Metro Station — Elevated". */
export function extractMediumTypeFromDisplayName(name: string): string | null {
  if (!name?.trim()) return null;
  const m =
    name.match(/\s+[—–\-]\s+([A-Za-z][A-Za-z\s/]*?)\s*$/) ||
    name.match(/\(([^)]+)\)\s*$/);
  if (!m) {
    const tokens = canonicalizeServiceName(name).split(/\s+/);
    const hit = tokens.filter((t) => MEDIUM_TYPE_TOKENS.has(t));
    return hit.length ? hit.map(titleCaseToken).join(' ') : null;
  }
  const raw = m[1].trim();
  if (!raw || CITY_NAMES.includes(raw.toLowerCase())) return null;
  // Ignore polluted vendor-style suffixes
  if (/cost|naxna|\bna\b|#\d+/i.test(raw)) return null;
  return raw
    .split(/[\s/]+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(' ');
}

/** Base service name without medium-type suffix for catalog matching. */
export function stripMediumTypeFromDisplayName(name: string): string {
  if (!name?.trim()) return name;
  return name
    .replace(/\s+[—–\-]\s+[A-Za-z][A-Za-z\s/]*?\s*$/, '')
    .replace(/\s*\((?:elevated|underground|interior|inside|outside|wrap|platform|lobby)\)\s*$/i, '')
    .trim();
}

/**
 * Display label that keeps same-named services distinct when service_id encodes medium type.
 * Example: METRO STATION + metro-station-elevated-chennai → "Metro Station — Elevated"
 * Never appends polluted leftovers — only known medium tokens (elevated/underground/…).
 */
export function formatServiceDisplayName(svc: Pick<DbService, 'service_id' | 'service_name'>): string {
  let base = (svc.service_name || '')
    .split(' ')
    .map((w) => titleCaseToken(w))
    .join(' ')
    .trim();

  // Strip polluted vendor junk if it somehow landed in service_name
  if (/\bna\b|cost-|naxna|\s·\s|#\d+/i.test(base) || base.length > 60) {
    // Rebuild from service_id slug when name is dirty
    let slug = normalizeServiceId(svc.service_id || '');
    const citiesByLen = [...CITY_NAMES].sort((a, b) => b.length - a.length);
    for (const city of citiesByLen) {
      if (slug.endsWith(`-${city}`)) {
        slug = slug.slice(0, -(city.length + 1));
        break;
      }
    }
    base = slug
      .split('-')
      .filter(Boolean)
      .map(titleCaseToken)
      .join(' ');
  }

  const medium = extractMediumTypeFromServiceId(svc.service_id, base);
  if (!medium || !base) return base || svc.service_id;
  // Avoid "Metro Station Branding — Branding" / "Elevated Metro Station — Elevated"
  if (canonicalizeServiceName(base).includes(canonicalizeServiceName(medium))) {
    return base;
  }
  return `${base} — ${medium}`;
}

function mediumTypesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return canonicalizeServiceName(a) === canonicalizeServiceName(b);
}

function pickAmongMediumCompatible(
  candidates: DbService[],
  mediumHint: string | null,
): DbService | null {
  if (candidates.length === 0) return null;
  const filtered = mediumHint
    ? candidates.filter((s) =>
        mediumTypesCompatible(
          extractMediumTypeFromServiceId(s.service_id, s.service_name),
          mediumHint,
        ),
      )
    : candidates;
  const pool = filtered.length > 0 ? filtered : candidates;

  // If multiple distinct medium types and no hint, do not guess
  if (!mediumHint) {
    const types = new Set(
      pool
        .map((s) => extractMediumTypeFromServiceId(s.service_id, s.service_name))
        .filter(Boolean)
        .map((t) => canonicalizeServiceName(t!)),
    );
    if (types.size > 1) return null;
  }

  return pickPreferredDbService(pool);
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
 * Uses canonical name + optional medium type (from display label or service_id) + city.
 */
export function resolveServiceIdFromCatalog(
  name: string,
  services: DbService[],
  cityHint?: string | null,
): { serviceId: string; serviceName: string } | null {
  if (!name?.trim() || services.length === 0) return null;

  const mediumHint = extractMediumTypeFromDisplayName(name);
  const baseName = stripMediumTypeFromDisplayName(name);
  const canonical = canonicalizeServiceName(baseName);
  const kebab = toServiceIdKebab(baseName);
  const fullKebab = toServiceIdKebab(name);

  let pool = services;
  if (cityHint) {
    const c = cityHint.toLowerCase();
    const cityFiltered = services.filter((s) => {
      const locs: string[] = s.metadata?.locations || [];
      const sid = (s.service_id || '').toLowerCase();
      return locs.some((l) => l.toLowerCase().includes(c))
        || (s.document_name || '').toLowerCase().includes(c)
        || sid.endsWith(`-${c}`)
        || sid.includes(`-${c}-`);
    });
    if (cityFiltered.length > 0) pool = cityFiltered;
  }

  // Exact service_id match (display name may already be a kebab id)
  const exactId = pool.find((s) => normalizeServiceId(s.service_id) === normalizeServiceId(name));
  if (exactId) {
    return { serviceId: exactId.service_id, serviceName: exactId.service_name };
  }

  const byIdMatches = pool.filter((s) => {
    const sid = normalizeServiceId(s.service_id);
    const k = normalizeServiceId(kebab);
    const fk = normalizeServiceId(fullKebab);
    return sid === k || sid === fk || sid.endsWith(`-${k}`) || sid.includes(`-${k}-`);
  });
  const byId = pickAmongMediumCompatible(byIdMatches, mediumHint);
  if (byId) return { serviceId: byId.service_id, serviceName: byId.service_name };

  const canonicalMatches = pool.filter(
    (s) => canonicalizeServiceName(s.service_name) === canonical,
  );
  const byCanonical = pickAmongMediumCompatible(canonicalMatches, mediumHint);
  if (byCanonical) {
    return { serviceId: byCanonical.service_id, serviceName: byCanonical.service_name };
  }

  // Match against formatted display name (name + medium type)
  const byDisplay = pool.filter(
    (s) => canonicalizeServiceName(formatServiceDisplayName(s)) === canonicalizeServiceName(name),
  );
  if (byDisplay.length === 1) {
    return { serviceId: byDisplay[0].service_id, serviceName: byDisplay[0].service_name };
  }
  const byDisplayPicked = pickAmongMediumCompatible(byDisplay, mediumHint);
  if (byDisplayPicked) {
    return {
      serviceId: byDisplayPicked.service_id,
      serviceName: byDisplayPicked.service_name,
    };
  }

  const containsMatches = pool.filter((s) => {
    const sc = canonicalizeServiceName(s.service_name);
    const sid = normalizeServiceId(s.service_id);
    return sc.includes(canonical) || canonical.includes(sc) || sid.includes(kebab);
  });
  const byContains = pickAmongMediumCompatible(containsMatches, mediumHint);
  if (byContains) {
    return { serviceId: byContains.service_id, serviceName: byContains.service_name };
  }

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
