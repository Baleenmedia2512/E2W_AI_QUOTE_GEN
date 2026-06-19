import { canonicalizeServiceName } from '../hooks/useCityServiceRegistry';
import {
  ConfirmationRow,
  FULL_SERVICE_PATTERNS,
  MinQtyViolation,
  MinDurViolation,
  dedupeConfirmationRows,
  validateConfirmationRowsMinQty,
  getMinDurationFromDbService,
} from './cloudQuoteValidation';
import { DbService, resolveServiceIdFromCatalog } from './serviceResolver';
import { parseDurationFromUserText } from './durationUtils';

/** True when segment text contains a complete service name (not a vague category). */
export function isSegmentFullySpecified(segmentRaw: string): boolean {
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

export type MinQtyGateResult =
  | { type: 'confirm'; rows: ConfirmationRow[] }
  | { type: 'min_qty'; rows: ConfirmationRow[]; violations: MinQtyViolation[] };

/** Min-qty check before opening the confirm table. */
export function gateMinQtyBeforeConfirm(
  rows: ConfirmationRow[],
  services: DbService[],
): MinQtyGateResult {
  const deduped = dedupeConfirmationRows(rows);
  if (!services.length) {
    return { type: 'confirm', rows: deduped };
  }
  const violations = validateConfirmationRowsMinQty(deduped, services);
  if (violations.length > 0) {
    return { type: 'min_qty', rows: deduped, violations };
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
    const lines = [
      `SERVICE: ${svc.service_name}`,
      `CITY: ${(m.locations || []).join(', ')}`,
      `PRICING STRUCTURE: ${(pricing.structure as string) || 'combined'}`,
    ];

    if (pricing.structure === 'separate') {
      if (pricing.display_price) lines.push(`DISPLAY PRICE: ₹${pricing.display_price} ${pricing.display_period || 'per month'}`);
      if (pricing.production_price) lines.push(`PRINTING & FIXING PRICE: ₹${pricing.production_price} ${pricing.production_unit || 'per unit'}`);
      if (pricing.min_quantity) lines.push(`MINIMUM: ${pricing.min_quantity}`);
    } else if (pricing.structure === 'campaign') {
      if (pricing.unit_price) lines.push(`UNIT PRICE: ₹${pricing.unit_price} ${pricing.unit || ''}`);
      if (pricing.min_quantity) lines.push(`MINIMUM QUANTITY: ${pricing.min_quantity}`);
      if (pricing.total_price) lines.push(`TOTAL PRICE: ₹${pricing.total_price}`);
    } else {
      const price = pricing.price || pricing.unit_price;
      if (price) lines.push(`PRICE: ₹${price} ${pricing.period || pricing.display_period || pricing.unit || 'per month'}`);
      if (pricing.min_quantity) lines.push(`MINIMUM: ${pricing.min_quantity}`);
      if (pricing.total_price) lines.push(`TOTAL PRICE: ₹${pricing.total_price}`);
    }

    const meta = m as Record<string, unknown>;
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

  if (isSegmentFullySpecified(segmentRaw)) {
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
    const cityHint = row.city && row.city !== '—' ? row.city : null;
    return resolveServiceIdFromCatalog(row.service, services, cityHint) != null;
  });
}

export function canonicalRowKey(row: ConfirmationRow): string {
  const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
  const svc = canonicalizeServiceName(row.service) || row.service.toLowerCase();
  const city = (row.city && row.city !== '—' ? row.city : '').toLowerCase();
  return `${svc}|${city}|${qty}`;
}

export type MinDurGateResult =
  | { type: 'confirm'; rows: ConfirmationRow[] }
  | { type: 'min_dur'; rows: ConfirmationRow[]; violations: MinDurViolation[] };

/**
 * Min-duration check before opening the confirm table.
 * Only fires when the user explicitly typed a duration (e.g. "for 1 month").
 * Rows with no matching DB service or no min_duration in metadata are silently skipped.
 */
export function gateMinDurationBeforeConfirm(
  rows: ConfirmationRow[],
  services: DbService[],
  userMessage: string,
): MinDurGateResult {
  const deduped = dedupeConfirmationRows(rows);
  if (!services.length) return { type: 'confirm', rows: deduped };

  const userDur = parseDurationFromUserText(userMessage);
  if (!userDur) return { type: 'confirm', rows: deduped }; // No duration typed → skip check

  const violations: MinDurViolation[] = [];

  for (const row of deduped) {
    const cityHint = row.city && row.city !== '—' ? row.city.toLowerCase() : undefined;
    const resolved = resolveServiceIdFromCatalog(row.service, services, cityHint);
    if (!resolved) continue;
    const svc = services.find((s) => s.service_id === resolved.serviceId);
    if (!svc) continue;

    const minDur = getMinDurationFromDbService(svc);
    if (!minDur) continue;

    // Normalize to months for comparison
    const reqMonths = userDur.unit === 'days' ? userDur.value / 30 : userDur.value;
    const minMonths = minDur.unit === 'days' ? minDur.value / 30 : minDur.value;

    if (reqMonths < minMonths) {
      violations.push({
        description: `${row.service} - ${row.city}`,
        requestedDuration: userDur.value,
        requestedDurationUnit: userDur.unit,
        originalRequested: userDur.value,
        minimumDuration: minDur.value,
        durationUnit: minDur.unit,
      });
    }
  }

  if (violations.length > 0) {
    return { type: 'min_dur', rows: deduped, violations };
  }
  return { type: 'confirm', rows: deduped };
}
