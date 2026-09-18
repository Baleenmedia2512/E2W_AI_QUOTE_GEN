import type { ConfirmationRow } from './cloudQuoteValidation';
import { getMinQuantityFromDbService } from './cloudQuoteValidation';
import { vendorMinDays } from './durationUtils';
import { canonicalizeServiceName } from './serviceNameUtils';
import {
  DbService,
  formatServiceDisplayName,
} from './serviceResolver';
import type { Quote } from '../types/quote';
import type { ReviewDraft, ReviewDraftItem, ReviewDraftSource } from '../types/review';

function newId(): string {
  return `rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Split catalog city blobs like "madurai, trichy, tanjore" into separate labels. */
export function splitCityLabels(raw: string): string[] {
  return String(raw || '')
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const upper = part.toUpperCase();
      return upper !== 'NA' && part !== '—';
    });
}

/** City / place labels from a catalog row (city, else area_name, else locations[]). */
export function reviewCitiesFromDb(svc: DbService): string[] {
  const meta = (svc.metadata || {}) as {
    city?: unknown;
    area_name?: unknown;
    area?: unknown;
    locations?: unknown;
  };
  const out: string[] = [];
  const push = (value: string) => {
    for (const part of splitCityLabels(value)) {
      out.push(part);
    }
  };

  const city = String(meta.city ?? '').trim();
  if (city && city.toUpperCase() !== 'NA' && city !== '—') {
    push(city);
  } else {
    const area = String(meta.area_name ?? meta.area ?? '').trim();
    if (area && area.toUpperCase() !== 'NA' && area !== '—') {
      push(area);
    }
  }

  if (Array.isArray(meta.locations)) {
    for (const loc of meta.locations) {
      const s = String(loc ?? '').trim();
      if (s) push(s);
    }
  }

  return out;
}

/** First city label from a catalog row (compat helper). */
export function reviewCityFromDb(svc: DbService): string | null {
  return reviewCitiesFromDb(svc)[0] || null;
}

function minsForService(
  services: DbService[],
  service: string,
  serviceId?: string,
  cityHint?: string,
): { minimumQuantity?: number; minimumDurationDays?: number } {
  let svc: DbService | undefined;
  if (serviceId) {
    svc = services.find((s) => s.service_id === serviceId);
  }
  if (!svc && service) {
    const key = canonicalizeServiceName(service);
    svc = services.find(
      (s) =>
        canonicalizeServiceName(formatServiceDisplayName(s)) === key
        || canonicalizeServiceName(s.service_name) === key,
    );
  }
  if (!svc && cityHint) {
    const cityKey = canonicalizeServiceName(cityHint);
    svc = services.find((s) => {
      const c = reviewCityFromDb(s);
      return c && canonicalizeServiceName(c) === cityKey
        && canonicalizeServiceName(formatServiceDisplayName(s)).includes(
          canonicalizeServiceName(service).split(/\s+/)[0] || '',
        );
    });
  }
  if (!svc) return {};
  const minQty = getMinQuantityFromDbService(svc) ?? undefined;
  const days = vendorMinDays(svc.metadata as { min_days?: number | string });
  return {
    minimumQuantity: minQty,
    minimumDurationDays: Number.isFinite(days) && days > 0 ? days : undefined,
  };
}

/** Group confirmation rows into review cards (multi-city → one card). */
export function confirmationRowsToReviewItems(
  rows: ConfirmationRow[],
  services: DbService[] = [],
): ReviewDraftItem[] {
  const groups = new Map<string, ReviewDraftItem>();

  for (const row of rows) {
    const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const city = row.city && row.city !== '—' ? row.city.trim() : '';
    const cityParts = city ? splitCityLabels(city) : [];
    const durationDays = row.durationDays && row.durationDays > 0 ? row.durationDays : 0;
    const svcKey = (row.serviceId || '').trim().toLowerCase()
      || canonicalizeServiceName(row.service)
      || row.service.toLowerCase().trim();
    const groupKey = `${svcKey}|${qty}|${durationDays || 'na'}`;

    const existing = groups.get(groupKey);
    if (existing) {
      for (const part of cityParts) {
        if (!existing.cities.some((c) => canonicalizeServiceName(c) === canonicalizeServiceName(part))) {
          existing.cities.push(part);
        }
      }
      continue;
    }

    const mins = minsForService(services, row.service, row.serviceId, cityParts[0]);
    const resolvedDays = durationDays > 0
      ? durationDays
      : (mins.minimumDurationDays ?? 30);

    groups.set(groupKey, {
      id: newId(),
      service: row.service,
      serviceId: row.serviceId,
      cities: cityParts,
      quantity: qty,
      durationDays: resolvedDays,
      minimumQuantity: mins.minimumQuantity,
      minimumDurationDays: mins.minimumDurationDays,
    });
  }

  return Array.from(groups.values());
}

export function createReviewDraft(
  rows: ConfirmationRow[],
  source: ReviewDraftSource,
  originalUserText?: string,
  services: DbService[] = [],
): ReviewDraft {
  return {
    items: confirmationRowsToReviewItems(rows, services),
    source,
    originalUserText,
  };
}

/** Expand review cards back to confirmation rows for the existing quote builder. */
export function reviewItemsToConfirmationRows(items: ReviewDraftItem[]): ConfirmationRow[] {
  const rows: ConfirmationRow[] = [];
  for (const item of items) {
    const cities = item.cities.filter((c) => c && c !== '—');
    const targets = cities.length > 0 ? cities : ['—'];
    for (const city of targets) {
      rows.push({
        service: item.service.trim(),
        serviceId: item.serviceId,
        qty: item.quantity,
        city,
        durationDays: item.durationDays > 0 ? item.durationDays : undefined,
      });
    }
  }
  return rows;
}

/** Convert an already-built quote into review cards (legacy / Gemini paths). */
export function quoteToReviewDraft(
  quote: Quote,
  source: ReviewDraftSource,
  originalUserText?: string,
  services: DbService[] = [],
): ReviewDraft {
  const rows: ConfirmationRow[] = quote.items.map((item) => {
    const days = item.durationUnit === 'months' && item.duration
      ? item.duration * 30
      : (item.duration || undefined);
    return {
      service: item.serviceName || item.description || item.title || 'Service',
      serviceId: item.serviceId,
      qty: item.quantity,
      city: item.city || '—',
      durationDays: days,
    };
  });
  return createReviewDraft(rows, source, originalUserText, services);
}

export function emptyReviewItem(partial?: Partial<ReviewDraftItem>): ReviewDraftItem {
  return {
    id: newId(),
    service: '',
    cities: [],
    quantity: 1,
    durationDays: 30,
    ...partial,
  };
}

/** Distinct catalog service labels for autocomplete. */
export function listCatalogServiceOptions(services: DbService[]): Array<{
  label: string;
  serviceId: string;
  serviceName: string;
}> {
  const seen = new Map<string, { label: string; serviceId: string; serviceName: string }>();
  for (const svc of services) {
    const label = formatServiceDisplayName(svc);
    if (!label) continue;
    const key = canonicalizeServiceName(label);
    if (!key || seen.has(key)) continue;
    seen.set(key, {
      label,
      serviceId: svc.service_id,
      serviceName: svc.service_name,
    });
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}

/**
 * Sort / filter catalog services by typed query:
 * exact → prefix → contains → rest (alphabetical within tier).
 */
export function sortServicesByTypedQuery(
  options: Array<{ label: string; serviceId: string; serviceName: string }>,
  typed: string,
): Array<{ label: string; serviceId: string; serviceName: string }> {
  const q = canonicalizeServiceName(typed || '');
  if (!q) {
    return [...options].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
  }

  const scored = options.map((opt) => {
    const label = canonicalizeServiceName(opt.label);
    const name = canonicalizeServiceName(opt.serviceName);
    let score = 99;
    if (label === q || name === q) score = 0;
    else if (label.startsWith(q) || name.startsWith(q)) score = 1;
    else if (label.includes(q) || name.includes(q)) score = 2;
    else {
      const tokens = q.split(/\s+/).filter(Boolean);
      const hit = tokens.every((t) => label.includes(t) || name.includes(t));
      score = hit ? 3 : 50;
    }
    return { opt, score };
  });

  return scored
    .filter((s) => s.score < 50)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.opt.label.localeCompare(b.opt.label, undefined, { sensitivity: 'base' });
    })
    .map((s) => s.opt);
}

/** Distinct city/place labels available for a service (optionally scoped by serviceId). */
export function citiesForService(
  services: DbService[],
  service: string,
  serviceId?: string,
): string[] {
  const key = canonicalizeServiceName(service);
  let familyKey = key;
  if (serviceId) {
    const selected = services.find((s) => s.service_id === serviceId);
    if (selected) {
      familyKey = canonicalizeServiceName(formatServiceDisplayName(selected));
    }
  }

  const cities = new Map<string, string>();
  for (const svc of services) {
    const label = canonicalizeServiceName(formatServiceDisplayName(svc));
    const name = canonicalizeServiceName(svc.service_name);
    if (familyKey) {
      if (label !== familyKey && name !== familyKey) continue;
    } else if (key) {
      if (label !== key && name !== key && !label.includes(key) && !name.includes(key)) {
        continue;
      }
    }

    for (const city of reviewCitiesFromDb(svc)) {
      const cKey = canonicalizeServiceName(city);
      if (cKey && !cities.has(cKey)) cities.set(cKey, city);
    }
  }

  return Array.from(cities.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

/** Refresh mins after user picks a service from autocomplete. */
export function enrichReviewItemFromCatalog(
  item: ReviewDraftItem,
  services: DbService[],
): ReviewDraftItem {
  const mins = minsForService(services, item.service, item.serviceId, item.cities[0]);
  const availableCities = citiesForService(services, item.service, item.serviceId);
  const expandedSelected = item.cities.flatMap((c) => splitCityLabels(c));
  let cities = expandedSelected.filter((c) =>
    availableCities.some((a) => canonicalizeServiceName(a) === canonicalizeServiceName(c)),
  );
  if (cities.length === 0 && availableCities.length === 1) {
    cities = [availableCities[0]];
  }
  const durationDays = item.durationDays > 0
    ? item.durationDays
    : (mins.minimumDurationDays ?? 30);
  const quantity = item.quantity > 0
    ? item.quantity
    : (mins.minimumQuantity ?? 1);

  return {
    ...item,
    cities,
    quantity,
    durationDays,
    minimumQuantity: mins.minimumQuantity,
    minimumDurationDays: mins.minimumDurationDays,
  };
}

export function validateReviewDraft(items: ReviewDraftItem[]): string | null {
  if (!items.length) return 'Add at least one service.';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const n = i + 1;
    if (!item.service.trim()) return `Service ${n}: enter a service name.`;
    if (!item.cities.length) return `Service ${n}: select at least one city.`;
    if (!item.quantity || item.quantity < 1) return `Service ${n}: quantity must be at least 1.`;
    if (item.minimumQuantity && item.quantity < item.minimumQuantity) {
      return `Service ${n}: quantity must be at least ${item.minimumQuantity}.`;
    }
    if (!item.durationDays || item.durationDays < 1) {
      return `Service ${n}: duration must be at least 1 day.`;
    }
    if (item.minimumDurationDays && item.durationDays < item.minimumDurationDays) {
      return `Service ${n}: duration must be at least ${item.minimumDurationDays} days.`;
    }
  }
  return null;
}
