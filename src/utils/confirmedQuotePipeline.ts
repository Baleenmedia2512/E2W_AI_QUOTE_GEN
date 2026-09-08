import { canonicalizeServiceName } from './serviceNameUtils';
import type { GroupedServices } from '../types/chat';
import {
  ConfirmationRow,
  FULL_SERVICE_PATTERNS,
  MinQtyViolation,
  dedupeConfirmationRows,
  mergeGroupedServicesByCategory,
  validateConfirmationRowsMinQty,
} from './cloudQuoteValidation';
import { DbService, resolveServiceIdFromCatalog } from './serviceResolver';
import {
  getServiceScopedUserMessage,
  parseDurationFromUserText,
  toCampaignDays,
  vendorMinDays,
} from './durationUtils';
import { resolveDisplayUnitPricePerDay } from './marginUtils';

/** True when segment text contains a complete DB service phrase. */
export function isSegmentFullySpecified(
  segmentRaw: string,
  services?: DbService[],
): boolean {
  const queryKey = canonicalizeServiceName(segmentRaw);
  if (services?.length && queryKey) {
    const catalogMatch = services.some((service) => {
      const medium = canonicalizeServiceName(String(service.metadata?.medium || ''));
      const name = canonicalizeServiceName(
        (service.service_name || '').split(/[·|]/)[0],
      );
      return (
        medium === queryKey
        || name === queryKey
        || medium.startsWith(`${queryKey} `)
        || name.startsWith(`${queryKey} `)
      );
    });
    if (catalogMatch) return true;
  }
  return FULL_SERVICE_PATTERNS.some((p) => p.test(segmentRaw));
}

/** Parse display labels like "50 Auto Full Branding (Chennai)" into confirm rows. */
export function parseConfirmedLabelToRow(label: string): ConfirmationRow | null {
  const cleaned = label.replace(/\s*⚠️.*$/u, '').trim();
  let m = cleaned.match(/^(\d+)\s+(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { service: m[2].trim(), qty: parseInt(m[1], 10), city: m[3].trim() };
  }
  m = cleaned.match(/^(\d+)\s+(.+?)\s+([A-Za-z][A-Za-z\s]+)$/);
  if (m) {
    return { service: m[2].trim(), qty: parseInt(m[1], 10), city: m[3].trim() };
  }
  return null;
}

export function labelsToConfirmRows(labels: string[]): ConfirmationRow[] {
  return dedupeConfirmationRows(
    labels.map(parseConfirmedLabelToRow).filter((r): r is ConfirmationRow => r != null),
  );
}

/**
 * Fold "Already confirmed" labels into the multi-match checkbox groups and
 * return pre-checked selections so they appear as normal checked boxes.
 * Vague groups with exactly one option are also pre-checked; multi-option
 * vague groups stay unchecked so the user must choose.
 */
export function mergeDirectPartsIntoGroupedServices(
  groups: GroupedServices[],
  directParts: string[],
): { groups: GroupedServices[]; preSelected: Record<string, string[]> } {
  const working: GroupedServices[] = (groups || []).map((g) => ({
    ...g,
    services: [...(g.services || [])],
  }));

  for (const part of directParts || []) {
    const row = parseConfirmedLabelToRow(part);
    if (!row) continue;
    const serviceName = row.service;
    const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const city = row.city && row.city !== '—' ? row.city : '';

    let idx = working.findIndex((g) => {
      const [, gCity] = g.vehicleType.includes('|')
        ? g.vehicleType.split('|')
        : [g.vehicleType, ''];
      const cityOk = !city || !gCity || gCity.toLowerCase() === city.toLowerCase();
      return (
        cityOk &&
        g.services.some((s) => s.name.toLowerCase() === serviceName.toLowerCase())
      );
    });

    if (idx < 0) {
      const category = serviceName.split(/\s+/)[0] || 'Service';
      idx = working.findIndex((g) => {
        const [vehiclePart, gCity] = g.vehicleType.includes('|')
          ? g.vehicleType.split('|')
          : [g.vehicleType, ''];
        const gCat = (vehiclePart.trim().split(/\s+/)[0] || '').toLowerCase();
        const cityOk = !city || !gCity || gCity.toLowerCase() === city.toLowerCase();
        return cityOk && gCat === category.toLowerCase();
      });
    }

    if (idx < 0) {
      const category = serviceName.split(/\s+/)[0] || 'Service';
      const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
      const vehicleType = city ? `${catLabel}|${city}` : catLabel;
      working.push({
        vehicleType,
        requestedQuantity: qty,
        services: [
          {
            name: serviceName,
            category: catLabel,
            requestedQuantity: qty,
          },
        ],
      });
      idx = working.length - 1;
    } else {
      const existing = working[idx].services.find(
        (s) => s.name.toLowerCase() === serviceName.toLowerCase(),
      );
      if (existing) {
        existing.requestedQuantity = qty;
      } else {
        working[idx].services.push({
          name: serviceName,
          category: working[idx].vehicleType.split('|')[0],
          requestedQuantity: qty,
        });
      }
    }
  }

  const merged = mergeGroupedServicesByCategory(working);
  const preSelected: Record<string, string[]> = {};

  for (const part of directParts || []) {
    const row = parseConfirmedLabelToRow(part);
    if (!row) continue;
    const city = row.city && row.city !== '—' ? row.city : '';
    for (const g of merged) {
      const [, gCity] = g.vehicleType.includes('|')
        ? g.vehicleType.split('|')
        : [g.vehicleType, ''];
      const cityOk = !city || !gCity || gCity.toLowerCase() === city.toLowerCase();
      const svc = g.services.find(
        (s) => s.name.toLowerCase() === row.service.toLowerCase(),
      );
      if (svc && cityOk) {
        if (!preSelected[g.vehicleType]) preSelected[g.vehicleType] = [];
        if (!preSelected[g.vehicleType].includes(svc.name)) {
          preSelected[g.vehicleType].push(svc.name);
        }
      }
    }
  }

  // Vague groups: only auto-check when there is exactly one option
  // (e.g. "auto semi" → 1 match). Multiple options (e.g. Bus Shelter Single/Double)
  // stay unchecked so the user must choose.
  for (const g of merged) {
    if (g.services.length !== 1) continue;
    if (!preSelected[g.vehicleType]) preSelected[g.vehicleType] = [];
    if (preSelected[g.vehicleType].length === 0) {
      preSelected[g.vehicleType].push(g.services[0].name);
    }
  }

  return { groups: merged, preSelected };
}

export type MinQtyGateResult =
  | { type: 'confirm'; rows: ConfirmationRow[] }
  | { type: 'min_qty'; rows: ConfirmationRow[]; violations: MinQtyViolation[] }
  | { type: 'min_duration'; rows: ConfirmationRow[]; violations: MinDurationViolation[] };

export interface MinDurationViolation {
  description: string;
  requested: number;
  minimum: number;
  serviceId?: string;
}

/** Compare explicit per-service duration against the vendor minimum duration. */
export function validateConfirmationRowsMinDuration(
  rows: ConfirmationRow[],
  services: DbService[],
  originalUserInput: string,
): MinDurationViolation[] {
  const violations: MinDurationViolation[] = [];
  console.log('[DurationDebug] validate start', {
    originalUserInput,
    rowCount: rows.length,
    rows: rows.map((row) => ({
      service: row.service,
      serviceId: row.serviceId,
      city: row.city,
    })),
    catalogCount: services.length,
  });
  for (const row of dedupeConfirmationRows(rows)) {
    const cityHint = row.city && row.city !== '—' ? row.city : null;
    const svc = row.serviceId
      ? services.find((service) => service.service_id === row.serviceId)
      : (() => {
          const resolved = resolveServiceIdFromCatalog(row.service, services, cityHint);
          return resolved
            ? services.find((service) => service.service_id === resolved.serviceId)
            : undefined;
        })();
    if (!svc) {
      console.log('[DurationDebug] service unresolved', {
        service: row.service,
        serviceId: row.serviceId,
        cityHint,
      });
      continue;
    }

    // A minimum duration is meaningful only for a recurring display-priced service.
    const metadata = (svc.metadata || {}) as Record<string, unknown>;
    const pricing = (metadata.pricing || {}) as Record<string, unknown>;
    const dailyDisplayRate = resolveDisplayUnitPricePerDay(pricing, metadata);
    const minimum = vendorMinDays(metadata);
    const scopedInput = getServiceScopedUserMessage(
      originalUserInput,
      svc.service_name || row.service,
    );
    const parsedDuration = parseDurationFromUserText(scopedInput);
    const requested = row.durationDays != null && row.durationDays > 0
      ? row.durationDays
      : toCampaignDays(parsedDuration?.value, parsedDuration?.unit);
    console.log('[DurationDebug] service evaluated', {
      service: row.service,
      resolvedServiceId: svc.service_id,
      resolvedServiceName: svc.service_name,
      scopedInput,
      parsedDuration,
      requestedDays: requested,
      minimumDays: minimum,
      dailyDisplayRate,
      metadataMinDays: metadata.min_days,
      metadataMinDuration: metadata.min_duration,
      pricingKeys: Object.keys(pricing),
    });
    if (!Number.isFinite(minimum) || minimum <= 0 || dailyDisplayRate <= 0) continue;
    if (requested != null && requested < minimum) {
      violations.push({
        description: `${row.service} - ${row.city}`,
        requested,
        minimum,
        serviceId: svc.service_id,
      });
    }
  }
  console.log('[DurationDebug] validate result', { violations });
  return violations;
}

/** Min-qty check before opening the confirm table. */
export function gateMinQtyBeforeConfirm(
  rows: ConfirmationRow[],
  services: DbService[],
  originalUserInput?: string,
): MinQtyGateResult {
  const deduped = dedupeConfirmationRows(rows);
  if (!services.length) {
    return { type: 'confirm', rows: deduped };
  }
  const violations = validateConfirmationRowsMinQty(deduped, services);
  if (violations.length > 0) {
    return { type: 'min_qty', rows: deduped, violations };
  }
  if (originalUserInput) {
    const durationViolations = validateConfirmationRowsMinDuration(
      deduped,
      services,
      originalUserInput,
    );
    if (durationViolations.length > 0) {
      return { type: 'min_duration', rows: deduped, violations: durationViolations };
    }
  }
  return { type: 'confirm', rows: deduped };
}

/** Parse pending quote text (modal / legacy paths) into confirm rows. */
export function parseMessageToConfirmRows(message: string): ConfirmationRow[] {
  const cleaned = message
    .replace(/^generate\s+quote\s+for\s+/i, '')
    .replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '')
    .replace(/\s*\[QTY_OVERRIDE\]/g, '')
    .replace(/\s+for\s+\d+\s*(days?|months?)\s*$/i, '')
    .trim();

  if (!cleaned) return [];

  const parts = cleaned.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  const fromLabels = labelsToConfirmRows(parts);
  if (fromLabels.length > 0) return fromLabels;

  const parsed: ConfirmationRow[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s+(.+?)\s+([A-Za-z][A-Za-z\s]+)$/);
    if (m) {
      parsed.push({ service: m[2].trim(), qty: parseInt(m[1], 10), city: m[3].trim() });
    }
  }
  return dedupeConfirmationRows(parsed);
}

/** Keep only DB rows that match confirmed service + city pairs. */
export function filterDbServicesForConfirmedRows(
  rows: ConfirmationRow[],
  services: DbService[],
): DbService[] {
  if (!rows.length || !services.length) return services;

  const seen = new Set<string>();
  const out: DbService[] = [];

  for (const row of rows) {
    const cityHint = row.city && row.city !== '—' ? row.city : null;
    const resolved = resolveServiceIdFromCatalog(row.service, services, cityHint);
    if (!resolved) continue;
    const svc = services.find((s) => s.service_id === resolved.serviceId);
    if (svc && !seen.has(svc.service_id)) {
      seen.add(svc.service_id);
      out.push(svc);
    }
  }

  if (out.length > 0) return out;

  // Fallback: union of all cities mentioned in rows
  const cities = [...new Set(rows.map((r) => r.city.toLowerCase()).filter((c) => c && c !== '—'))];
  if (cities.length === 0) return services;

  return services.filter((svc) => {
    const locs: string[] = svc.metadata?.locations || [];
    const doc = (svc.document_name || '').toLowerCase();
    return cities.some(
      (c) => locs.some((l) => l.toLowerCase().includes(c)) || doc.includes(c),
    );
  });
}

export function buildGeminiContextFromDbServices(
  services: DbService[],
): Array<{ fileName: string; content: string }> {
  return services.map((svc) => {
    const m = svc.metadata || {};
    const pricing = (m.pricing || {}) as Record<string, unknown>;
    const meta = m as Record<string, unknown>;
    const lines = [
      `SERVICE: ${svc.service_name}`,
      `CITY: ${(m.locations || []).join(', ')}`,
      `PRICING STRUCTURE: ${(pricing.structure as string) || 'combined'}`,
    ];

    if (pricing.structure === 'separate') {
      if (pricing.display_price) lines.push(`DISPLAY PRICE: ₹${pricing.display_price} ${pricing.display_period || 'per day'}`);
      if (pricing.production_price || pricing.printing_and_mounting_price) {
        lines.push(
          `PRINTING & FIXING PRICE: ₹${pricing.production_price || pricing.printing_and_mounting_price} ${pricing.production_unit || 'per unit'}`,
        );
      }
    } else if (pricing.structure === 'campaign') {
      if (pricing.unit_price) lines.push(`UNIT PRICE: ₹${pricing.unit_price} ${pricing.unit || ''}`);
      if (pricing.total_price) lines.push(`TOTAL PRICE: ₹${pricing.total_price}`);
    } else {
      const price = pricing.display_price || pricing.price || pricing.unit_price;
      if (price) lines.push(`PRICE: ₹${price} ${pricing.period || pricing.display_period || pricing.unit || 'per day'}`);
      if (pricing.printing_and_mounting_price) {
        lines.push(`PRINTING & MOUNTING: ₹${pricing.printing_and_mounting_price}`);
      }
      if (pricing.total_price) lines.push(`TOTAL PRICE: ₹${pricing.total_price}`);
    }

    // Vendor top-level only — never pricing.min_qty / pricing.min_days
    const minQty = meta.min_qty ?? meta.min_quantity;
    if (minQty != null && String(minQty).trim() !== '' && String(minQty).toUpperCase() !== 'NA') {
      lines.push(`MINIMUM QUANTITY: ${minQty}`);
    }
    const minDays = meta.min_days ?? meta.min_duration;
    if (minDays != null && String(minDays).trim() !== '' && String(minDays).toUpperCase() !== 'NA') {
      lines.push(`MINIMUM DAYS: ${minDays}`);
    }
    if (meta.qty_measurement_unit) {
      lines.push(`QTY UNIT: ${String(meta.qty_measurement_unit)}`);
    }

    if (meta.size) lines.push(`SIZE: ${typeof meta.size === 'object' ? JSON.stringify(meta.size) : meta.size}`);
    if (meta.material) lines.push(`MATERIAL: ${String(meta.material)}`);
    if (meta.terms) lines.push(`TERMS: ${String(meta.terms)}`);
    if (svc.content) lines.push(`DESCRIPTION: ${String(svc.content).substring(0, 300)}`);

    return { fileName: svc.document_name || 'Rate Card', content: lines.filter(Boolean).join('\n') };
  });
}

/** Resolve best DB service name for a city + raw segment (used after city pick). */
export function resolveDbServiceNameForSegment(
  segmentRaw: string,
  city: string,
  services: DbService[],
): string | null {
  const cityHint = city;
  const words = segmentRaw
    .replace(/\d+/g, '')
    .replace(/\b(need|for|the|a|an|in|at|of|and|i|want|please|generate|quote)\b/gi, '')
    .trim();

  if (isSegmentFullySpecified(segmentRaw, services)) {
    const resolved = resolveServiceIdFromCatalog(words, services, cityHint);
    return resolved?.serviceName ?? null;
  }
  return null;
}

export function rowsFromCloudBelowMin(
  validLabels: string[],
  belowMin: Array<{ svcLabel: string; cityLabel: string; requestedQty: number }>,
): ConfirmationRow[] {
  const fromLabels = labelsToConfirmRows(validLabels);
  const fromBelow = belowMin.map((b) => ({
    service: b.svcLabel,
    qty: b.requestedQty,
    city: b.cityLabel,
  }));
  return dedupeConfirmationRows([...fromLabels, ...fromBelow]);
}

/** Strict check: confirmed row service name must match DB catalog entry. */
export function validateConfirmedRowsAgainstDb(
  rows: ConfirmationRow[],
  services: DbService[],
): ConfirmationRow[] {
  return rows.filter((row) => {
    if (row.serviceId && services.some((s) => s.service_id === row.serviceId)) {
      return true;
    }
    const cityHint = row.city && row.city !== '—' ? row.city : null;
    return resolveServiceIdFromCatalog(row.service, services, cityHint) != null;
  });
}

export function canonicalRowKey(row: ConfirmationRow): string {
  const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
  const svc = (row.serviceId || '').trim().toLowerCase()
    || canonicalizeServiceName(row.service)
    || row.service.toLowerCase();
  const city = (row.city && row.city !== '—' ? row.city : '').toLowerCase();
  return `${svc}|${city}|${qty}`;
}
