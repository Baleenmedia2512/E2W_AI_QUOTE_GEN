import type { Quote, QuoteItem } from '../types/quote';
import type { ClientInfo } from '../types/client';
import { isOneTimeLineDescription, toCampaignDays } from './durationUtils';

/** One line in the Baleen Media inbox payload — one object per service. */
export interface BaleenQuoteLine {
  serviceId: string;
  medium: string;
  adType: string;
  city: string;
  vendorName: string;
  /** Vendor cost INCLUDING 18% GST (line total). */
  costInclGst: number;
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

const BALEEN_GST_MULT = 1.18;

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
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function lineQty(item: QuoteItem): number {
  const q = Number(item.quantity);
  if (Number.isFinite(q) && q > 0) return q;
  const min = Number(item.minimumQuantity);
  if (Number.isFinite(min) && min > 0) return min;
  return 1;
}

function lineDays(item: QuoteItem): number {
  const days = toCampaignDays(item.duration, item.durationUnit);
  if (days != null && days > 0) return days;
  return 0;
}

function isOneTimeItem(item: QuoteItem): boolean {
  return isOneTimeLineDescription(
    item.description || item.title || item.serviceName || '',
  );
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
  days: number;
  qtyUnit: string;
  serviceId: string;
  medium: string;
  adType: string;
  city: string;
  vendorName: string;
}

/**
 * Merge quote Display + P&M rows for the same service into unit fields.
 * Quote Buddy often stores these as two QuoteItems — Baleen gets one line.
 */
function mergeServiceGroup(items: QuoteItem[]): MergedUnits {
  let displayPricePerDay: number | null = null;
  let displayCostPerDay: number | null = null;
  let pmPrice: number | null = null;
  let pmCost: number | null = null;
  let qty = 0;
  let days = 0;
  let qtyUnit = '';
  let serviceId = '';
  let medium = '';
  let adType = '';
  let city = '';
  let vendorName = '';

  const preferMeta = (item: QuoteItem) => {
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
  };

  for (const item of items) {
    preferMeta(item);
    const q = lineQty(item);
    if (q > qty) qty = q;

    if (isOneTimeItem(item)) {
      const p = usableAmount(item.rate);
      const c =
        usableAmount(item.vendorPfUnitCost)
        ?? usableAmount(item.vendorCostExclGst);
      if (p != null) pmPrice = p;
      if (c != null) pmCost = c;
      continue;
    }

    // Recurring / display row
    const d = lineDays(item);
    if (d > days) days = d;

    const dp = usableAmount(item.rate);
    const dc =
      usableAmount(item.vendorDisplayUnitCostPerDay)
      ?? usableAmount(item.vendorCostExclGst);
    if (dp != null) displayPricePerDay = dp;
    if (dc != null) displayCostPerDay = dc;

    const stampedPm = usableAmount(item.vendorPfUnitCost);
    if (stampedPm != null && pmCost == null) pmCost = stampedPm;

    if (item.oneTimeComponents?.length && pmPrice == null) {
      const pmFromComponents = item.oneTimeComponents.reduce(
        (sum, c) => sum + (usableAmount(c.amount) ?? 0),
        0,
      );
      if (pmFromComponents > 0) pmPrice = pmFromComponents;
    }
  }

  if (qty <= 0) qty = 1;

  return {
    displayPricePerDay,
    displayCostPerDay,
    pmPrice,
    pmCost,
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
 * display = unit_per_day × qty × days
 * pm      = pm_unit × qty
 * excl    = display + pm  (or only pm if no display unit)
 * incl    = excl × 1.18  → costInclGst / priceInclGst
 */
export function computeBaleenInclGstTotals(units: {
  displayPricePerDay: number | null;
  displayCostPerDay: number | null;
  pmPrice: number | null;
  pmCost: number | null;
  qty: number;
  days: number;
}): { costInclGst: number; priceInclGst: number } {
  const qty = units.qty > 0 ? units.qty : 1;
  const days = units.days > 0 ? units.days : 0;
  const hasDisplay =
    units.displayPricePerDay != null || units.displayCostPerDay != null;

  let costExcl: number;
  let priceExcl: number;

  if (hasDisplay) {
    const displayCost = (units.displayCostPerDay ?? 0) * qty * days;
    const displayPrice = (units.displayPricePerDay ?? 0) * qty * days;
    const pmCostAmt = (units.pmCost ?? 0) * qty;
    const pmPriceAmt = (units.pmPrice ?? 0) * qty;
    costExcl = displayCost + pmCostAmt;
    priceExcl = displayPrice + pmPriceAmt;
  } else {
    costExcl = (units.pmCost ?? 0) * qty;
    priceExcl = (units.pmPrice ?? 0) * qty;
  }

  return {
    costInclGst: roundMoney(costExcl * BALEEN_GST_MULT),
    priceInclGst: roundMoney(priceExcl * BALEEN_GST_MULT),
  };
}

/** @deprecated Use computeBaleenInclGstTotals after merge — kept for tests. */
export function computeBaleenInboxLineAmounts(item: QuoteItem): {
  costInclGst: number;
  priceInclGst: number;
} {
  return computeBaleenInclGstTotals(mergeServiceGroup([item]));
}

/**
 * Build Baleen Media inbox JSON from the live quote + client.
 * One line per service (Display + P&M merged). Amounts are Baleen POST only.
 */
export function buildBaleenQuotePayload(
  quote: Quote,
  client: ClientInfo,
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
    const merged = mergeServiceGroup(groups.get(key)!);
    const amounts = computeBaleenInclGstTotals(merged);
    return {
      serviceId: merged.serviceId,
      medium: merged.medium,
      adType: merged.adType,
      city: merged.city,
      vendorName: merged.vendorName,
      costInclGst: amounts.costInclGst,
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
