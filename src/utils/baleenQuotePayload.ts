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

/** Recurring unit (× qty × days when days present). */
const PRICE_UNIT_FIELD = 'display_unit_price_per_day';
const COST_UNIT_FIELD = 'display_unit_cost_per_day';

/** P&F: combined, else printing + mounting/fixing (do not double-count). */
const PRICE_PM_COMBINED = 'printing_and_mounting_price';
const COST_PM_COMBINED = 'printing_and_mounting_cost';
const PRICE_PRINTING = 'printing_price';
const COST_PRINTING = 'printing_cost';
const PRICE_MOUNTING = 'mounting_price';
const PRICE_FIXING = 'fixing_price';
const COST_MOUNTING = 'mounting_cost';
const COST_FIXING = 'fixing_cost';

/** Other one-time add-ons (× qty). */
const PRICE_OFFICIAL = 'official_and_incidental_price';
const COST_OFFICIAL = 'official_and_incidental_cost';
const PRICE_FREIGHT = 'freight_price';
const PRICE_EXTRA_KM = 'extra_km_price';
const COST_FREIGHT = 'freight_cost';
const COST_EXTRA_KM = 'extra_km_cost';
const PRICE_RECCE = 'recce_price';
const COST_RECCE = 'recce_cost';

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

/** First present among named fields (meta → pricing). */
function readFirstNamed(
  meta: Record<string, unknown>,
  ...fields: string[]
): number | null {
  for (const field of fields) {
    const v = readBaleenNamedMetaAmount(meta, field);
    if (v != null) return v;
  }
  return null;
}

/**
 * P&F unit: combined if present; else printing + mounting/fixing.
 * Never sum combined with split parts.
 */
export function resolveBaleenPfUnit(
  meta: Record<string, unknown>,
  side: 'price' | 'cost',
): number | null {
  if (side === 'price') {
    const combined = readBaleenNamedMetaAmount(meta, PRICE_PM_COMBINED);
    if (combined != null) return combined;
    const printing = readBaleenNamedMetaAmount(meta, PRICE_PRINTING) ?? 0;
    const mounting =
      readBaleenNamedMetaAmount(meta, PRICE_MOUNTING)
      ?? readBaleenNamedMetaAmount(meta, PRICE_FIXING)
      ?? 0;
    const split = printing + mounting;
    return split > 0 ? split : null;
  }
  const combined = readBaleenNamedMetaAmount(meta, COST_PM_COMBINED);
  if (combined != null) return combined;
  const printing = readBaleenNamedMetaAmount(meta, COST_PRINTING) ?? 0;
  const mounting =
    readBaleenNamedMetaAmount(meta, COST_MOUNTING)
    ?? readBaleenNamedMetaAmount(meta, COST_FIXING)
    ?? 0;
  const split = printing + mounting;
  return split > 0 ? split : null;
}

/** Sum of one-time units (P&F + official + freight/extra_km + recce). */
export function resolveBaleenOneTimeUnit(
  meta: Record<string, unknown>,
  side: 'price' | 'cost',
): number {
  const pf = resolveBaleenPfUnit(meta, side) ?? 0;
  if (side === 'price') {
    const official = readBaleenNamedMetaAmount(meta, PRICE_OFFICIAL) ?? 0;
    const freight = readFirstNamed(meta, PRICE_FREIGHT, PRICE_EXTRA_KM) ?? 0;
    const recce = readBaleenNamedMetaAmount(meta, PRICE_RECCE) ?? 0;
    return pf + official + freight + recce;
  }
  const official = readBaleenNamedMetaAmount(meta, COST_OFFICIAL) ?? 0;
  const freight = readFirstNamed(meta, COST_FREIGHT, COST_EXTRA_KM) ?? 0;
  const recce = readBaleenNamedMetaAmount(meta, COST_RECCE) ?? 0;
  return pf + official + freight + recce;
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
  /** One-time unit total (P&F + official + freight + recce). */
  oneTimePrice: number;
  oneTimeCost: number;
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
 * Money from named metadata fields only (meta → meta.pricing).
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
    oneTimePrice: resolveBaleenOneTimeUnit(meta, 'price'),
    oneTimeCost: resolveBaleenOneTimeUnit(meta, 'cost'),
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
 * oneTime  = (pf + official + freight/extra_km + recce) × qty
 * excl     = unitPart + oneTime
 * incl     = excl × 1.18  → vendorCostExclGst / priceInclGst
 */
export function computeBaleenInclGstTotals(units: {
  displayPricePerDay: number | null;
  displayCostPerDay: number | null;
  oneTimePrice: number;
  oneTimeCost: number;
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

  const priceOneTime = (units.oneTimePrice > 0 ? units.oneTimePrice : 0) * qty;
  const costOneTime = (units.oneTimeCost > 0 ? units.oneTimeCost : 0) * qty;

  const priceExcl = priceUnitPart + priceOneTime;
  const costExcl = costUnitPart + costOneTime;

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
 * One line per service. Amounts are Baleen POST only.
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
