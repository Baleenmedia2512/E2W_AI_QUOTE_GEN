import type { Quote, QuoteItem } from '../types/quote';
import type { ClientInfo } from '../types/client';
import { toCampaignDays } from './durationUtils';

/** One line in the Baleen Media inbox payload — one object per service. */
export interface BaleenQuoteLine {
  serviceId: string;
  medium: string;
  adType: string;
  city: string;
  vendorName: string;
  /**
   * Vendor cost INCLUDING 18% GST (line total).
   * Field name is what Baleen Media inbox reads (legacy misnomer).
   */
  vendorCostExclGst: number;
  /** Selling price INCLUDING 18% GST (line total). */
  priceInclGst: number;
  qty: number;
  qtyUnit: string;
}

/** Body POSTed to Baleen Media (via Edge Function). */
export interface BaleenQuotePayload {
  quoteId: string;
  clientName: string;
  mobile: string;
  lines: BaleenQuoteLine[];
}

/**
 * Optional catalog metadata on a quote row.
 * Prefer attaching via enrichQuoteItemsWithVendorMeta (Baleen push path).
 */
export type QuoteItemWithMeta = QuoteItem & { metadata?: Record<string, unknown> };

const BALEEN_GST_MULT = 1.18;

/** Money fields allowed for Baleen inbox amounts — nowhere else. */
const PRICE_UNIT_FIELD = 'display_unit_price_per_day';
const PRICE_PM_FIELD = 'printing_and_mounting_price';
const COST_UNIT_FIELD = 'display_unit_cost_per_day';
const COST_PM_FIELD = 'printing_and_mounting_cost';

function digitsOnlyPhone(phone: string | undefined): string {
  return String(phone || '').replace(/\D/g, '');
}

function roundMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Positive finite amount; treats NA / blank / 0 as missing. */
function usableAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const t = value.trim().toUpperCase();
    if (!t || t === 'NA' || t === 'N/A' || t === '-' || t === 'NULL' || t === 'NONE') {
      return null;
    }
    const cleaned = t
      .replace(/,/g, '')
      .replace(/^₹\s*/u, '')
      .replace(/^RS\.?\s*/i, '')
      .trim();
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Read exactly one named amount:
 * metadata.<field> → metadata.pricing.<field> → absent.
 * Does not consult any other keys.
 */
export function readBaleenNamedMetaAmount(
  meta: Record<string, unknown>,
  field: string,
): number | null {
  const fromTop = usableAmount(meta[field]);
  if (fromTop != null) return fromTop;
  const pricing =
    meta.pricing && typeof meta.pricing === 'object' && !Array.isArray(meta.pricing)
      ? (meta.pricing as Record<string, unknown>)
      : null;
  if (!pricing) return null;
  return usableAmount(pricing[field]);
}

function resolveServiceMetadata(
  items: QuoteItem[],
  lookup?: (serviceId: string) => Record<string, unknown> | null,
): Record<string, unknown> {
  for (const item of items) {
    const direct = (item as QuoteItemWithMeta).metadata;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct;
    }
  }

  if (!lookup) return {};
  const sid = items
    .map((i) => (i.serviceId || '').trim())
    .find((s) => s.length > 0);
  if (!sid) return {};
  return lookup(sid) || {};
}

function lineQty(item: QuoteItem): number | null {
  const q = Number(item.quantity);
  if (Number.isFinite(q) && q > 0) return q;
  const min = Number(item.minimumQuantity);
  if (Number.isFinite(min) && min > 0) return min;
  return null;
}

function lineDays(item: QuoteItem): number | null {
  const days = toCampaignDays(item.duration, item.durationUnit);
  if (days != null && days > 0) return days;
  return null;
}

/** Group key: one Baleen line per service (+ city when multi-city). */
function serviceGroupKey(item: QuoteItem): string {
  const sid = (item.serviceId || '').trim().toLowerCase();
  const city = (item.city || '').trim().toLowerCase();
  if (sid) return `${sid}|${city}`;
  const name = (item.serviceName || item.title || item.medium || item.description || '')
    .trim()
    .toLowerCase();
  return `${name}|${city}`;
}

interface MergedUnits {
  displayPricePerDay: number | null;
  displayCostPerDay: number | null;
  pmPrice: number | null;
  pmCost: number | null;
  qty: number;
  /** null when days are missing/NA after line + min_days fallbacks. */
  days: number | null;
  qtyUnit: string;
  serviceId: string;
  medium: string;
  adType: string;
  city: string;
  vendorName: string;
}

/**
 * One service → one Baleen line.
 * Money sources: only the four named metadata fields (meta → meta.pricing).
 * Quote Display + P&M rows share a serviceId and collapse here.
 */
function mergeServiceGroup(
  items: QuoteItem[],
  lookup?: (serviceId: string) => Record<string, unknown> | null,
): MergedUnits {
  let qty: number | null = null;
  let days: number | null = null;
  let qtyUnit = '';
  let serviceId = '';
  let medium = '';
  let adType = '';
  let city = '';
  let vendorName = '';

  for (const item of items) {
    if (!serviceId) serviceId = (item.serviceId || item.id || '').trim();
    if (!medium) {
      medium = (item.medium || item.serviceName || item.title || item.description || '').trim();
    }
    if (!adType) {
      adType = (item.adType || item.serviceName || item.title || medium).trim();
    }
    if (!city) city = (item.city || '').trim();
    if (!vendorName) vendorName = (item.vendorName || '').trim();
    if (!qtyUnit) qtyUnit = (item.quantityUnit || '').trim();

    const q = lineQty(item);
    if (q != null && (qty == null || q > qty)) qty = q;

    const d = lineDays(item);
    if (d != null && (days == null || d > days)) days = d;
  }

  const meta = resolveServiceMetadata(items, lookup);

  if (qty == null) {
    qty = usableAmount(meta.min_qty) ?? 1;
  }
  if (days == null) {
    days = usableAmount(meta.min_days);
  }

  return {
    displayPricePerDay: readBaleenNamedMetaAmount(meta, PRICE_UNIT_FIELD),
    displayCostPerDay: readBaleenNamedMetaAmount(meta, COST_UNIT_FIELD),
    pmPrice: readBaleenNamedMetaAmount(meta, PRICE_PM_FIELD),
    pmCost: readBaleenNamedMetaAmount(meta, COST_PM_FIELD),
    qty,
    days,
    qtyUnit,
    serviceId,
    medium,
    adType,
    city,
    vendorName,
  };
}

/**
 * unitPart = unit_per_day × qty × days  when unit_per_day AND days both present
 * pmPart   = pm × qty                   when pm present
 * excl     = unitPart + pmPart
 * incl     = excl × 1.18  → vendorCostExclGst / priceInclGst
 * (vendorCostExclGst name is what Baleen reads; value is INCL GST.)
 */
export function computeBaleenInclGstTotals(units: {
  displayPricePerDay: number | null;
  displayCostPerDay: number | null;
  pmPrice: number | null;
  pmCost: number | null;
  qty: number;
  days: number | null;
}): { vendorCostExclGst: number; priceInclGst: number } {
  const qty = units.qty > 0 ? units.qty : 1;
  const daysOk = units.days != null && units.days > 0;
  const days = daysOk ? units.days! : 0;

  const priceUnitPart =
    units.displayPricePerDay != null && daysOk
      ? units.displayPricePerDay * qty * days
      : 0;
  const costUnitPart =
    units.displayCostPerDay != null && daysOk
      ? units.displayCostPerDay * qty * days
      : 0;

  const pricePmPart = units.pmPrice != null ? units.pmPrice * qty : 0;
  const costPmPart = units.pmCost != null ? units.pmCost * qty : 0;

  const priceExcl = priceUnitPart + pricePmPart;
  const costExcl = costUnitPart + costPmPart;

  return {
    vendorCostExclGst: roundMoney(costExcl * BALEEN_GST_MULT),
    priceInclGst: roundMoney(priceExcl * BALEEN_GST_MULT),
  };
}

/** @deprecated Use computeBaleenInclGstTotals after merge — kept for tests. */
export function computeBaleenInboxLineAmounts(item: QuoteItem): {
  vendorCostExclGst: number;
  priceInclGst: number;
} {
  return computeBaleenInclGstTotals(mergeServiceGroup([item]));
}

export type BaleenMetaLookup = (serviceId: string) => Record<string, unknown> | null;

/**
 * Build Baleen Media inbox JSON from the live quote + client.
 * One line per service (Display + P&M merged). Amounts are Baleen POST only.
 *
 * Money fields come ONLY from metadata / metadata.pricing named keys
 * (see PRICE_* / COST_* above). Optional lookup supplies vendor catalog meta
 * when items are not already stamped.
 */
export function buildBaleenQuotePayload(
  quote: Quote,
  client: ClientInfo,
  metaLookup?: BaleenMetaLookup,
): BaleenQuotePayload {
  const groups = new Map<string, QuoteItem[]>();
  const order: string[] = [];

  for (const item of quote.items) {
    const key = serviceGroupKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }

  const lines: BaleenQuoteLine[] = order.map((key) => {
    const merged = mergeServiceGroup(groups.get(key)!, metaLookup);
    const amounts = computeBaleenInclGstTotals(merged);
    return {
      serviceId: merged.serviceId,
      medium: merged.medium,
      adType: merged.adType,
      city: merged.city,
      vendorName: merged.vendorName,
      vendorCostExclGst: amounts.vendorCostExclGst,
      priceInclGst: amounts.priceInclGst,
      qty: merged.qty,
      qtyUnit: merged.qtyUnit,
    };
  });

  return {
    quoteId: String(quote.quoteNumber || quote.id || '').trim(),
    clientName: String(client.name || client.company || '').trim(),
    mobile: digitsOnlyPhone(client.phone),
    lines,
  };
}
