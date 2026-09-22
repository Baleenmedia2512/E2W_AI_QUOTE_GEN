import type { Quote, QuoteItem } from '../types/quote';
import type { ClientInfo } from '../types/client';
import { isOneTimeLineDescription, toCampaignDays } from './durationUtils';

/** One line in the Baleen Media inbox payload. */
export interface BaleenQuoteLine {
  serviceId: string;
  medium: string;
  adType: string;
  city: string;
  vendorName: string;
  /**
   * Field name kept for Baleen Media API compatibility.
   * Value is vendor COST INCLUDING 18% GST (line total), not excl.
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

/**
 * Baleen inbox line totals (API payload only — does not affect PDF / UI).
 *
 * Price: display_unit_price_per_day (quote line `rate` for recurring) +
 *        printing_and_mounting_price (quote line `rate` for one-time / P&M).
 * Cost:  display_unit_cost_per_day + printing_and_mounting_cost (stamped on item).
 *
 * display = unit_per_day × qty × days
 * pm      = pm_unit × qty
 * ONLY P&M → unit × qty
 * else → display + pm
 * Both amounts sent WITH 18% GST.
 */
export function computeBaleenInboxLineAmounts(item: QuoteItem): {
  vendorCostExclGst: number;
  priceInclGst: number;
} {
  const qty = lineQty(item);
  const days = lineDays(item);
  const oneTime = isOneTimeLineDescription(
    item.description || item.title || item.serviceName || '',
  );

  // Recurring display line vs one-time P&M line (catalog usually splits these).
  let displayPricePerDay: number | null = null;
  let displayCostPerDay: number | null = null;
  let pmPrice: number | null = null;
  let pmCost: number | null = null;

  if (oneTime) {
    pmPrice = usableAmount(item.rate);
    pmCost =
      usableAmount(item.vendorPfUnitCost)
      ?? usableAmount(item.vendorCostExclGst);
  } else {
    displayPricePerDay = usableAmount(item.rate);
    displayCostPerDay =
      usableAmount(item.vendorDisplayUnitCostPerDay)
      ?? usableAmount(item.vendorCostExclGst);
    // Optional P&M stamped on the same recurring row
    pmCost = usableAmount(item.vendorPfUnitCost);
    if (item.oneTimeComponents?.length) {
      const pmFromComponents = item.oneTimeComponents.reduce(
        (sum, c) => sum + (usableAmount(c.amount) ?? 0),
        0,
      );
      if (pmFromComponents > 0) {
        pmPrice = pmFromComponents;
      }
    }
  }

  const hasDisplayUnit =
    displayPricePerDay != null || displayCostPerDay != null;

  let costExcl: number;
  let priceExcl: number;

  if (hasDisplayUnit) {
    const d = days > 0 ? days : 0;
    const displayCost = (displayCostPerDay ?? 0) * qty * d;
    const displayPrice = (displayPricePerDay ?? 0) * qty * d;
    const pmCostAmt = (pmCost ?? 0) * qty;
    const pmPriceAmt = (pmPrice ?? 0) * qty;
    costExcl = displayCost + pmCostAmt;
    priceExcl = displayPrice + pmPriceAmt;
  } else {
    // ONLY P&M (no display_unit_*_per_day)
    costExcl = (pmCost ?? 0) * qty;
    priceExcl = (pmPrice ?? 0) * qty;
  }

  return {
    // API field name remains vendorCostExclGst; value is INCL 18% GST.
    vendorCostExclGst: roundMoney(costExcl * BALEEN_GST_MULT),
    priceInclGst: roundMoney(priceExcl * BALEEN_GST_MULT),
  };
}

/**
 * Build Baleen Media inbox JSON from the live quote + client.
 * Amounts are for the Baleen POST only — never used for client PDF / UI pricing.
 */
export function buildBaleenQuotePayload(
  quote: Quote,
  client: ClientInfo,
): BaleenQuotePayload {
  const lines: BaleenQuoteLine[] = quote.items.map((item) => {
    const medium = (item.medium || item.serviceName || item.title || item.description || '')
      .trim();
    const adType = (item.adType || item.serviceName || item.title || medium).trim();
    const amounts = computeBaleenInboxLineAmounts(item);
    return {
      serviceId: (item.serviceId || item.id || '').trim(),
      medium,
      adType,
      city: (item.city || '').trim(),
      vendorName: (item.vendorName || '').trim(),
      vendorCostExclGst: amounts.vendorCostExclGst,
      priceInclGst: amounts.priceInclGst,
      qty: lineQty(item),
      qtyUnit: (item.quantityUnit || '').trim(),
    };
  });

  return {
    quoteId: String(quote.quoteNumber || quote.id || '').trim(),
    clientName: String(client.name || client.company || '').trim(),
    mobile: digitsOnlyPhone(client.phone),
    lines,
  };
}
