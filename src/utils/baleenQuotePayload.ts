import type { Quote, QuoteItem } from '../types/quote';
import type { ClientInfo } from '../types/client';
import {
  computeRecurringLineTotal,
  isOneTimeLineDescription,
  toCampaignDays,
} from './durationUtils';
import {
  resolveMergedDisplayTermEntries,
  termsLabelFromItem,
} from './termsMerge';

/** One line in the Baleen Media inbox payload — one object per service. */
export interface BaleenQuoteLine {
  serviceId: string;
  medium: string;
  adType: string;
  city: string;
  vendorName: string;
  /** From public.vendors.vendor_gst (matched by vendorName). Empty when unknown/NA. */
  vendorGstNumber: string;
  /** Vendor cost EXCLUDING GST (line total). */
  vendorCostExclGst: number;
  /** GST % applied on vendor cost (Baleen contract). */
  vendorGstPercent: number;
  /** Selling price INCLUDING 18% GST (line total). */
  priceInclGst: number;
  qty: number;
  qtyUnit: string;
  /** Campaign length in days (same basis as line pricing). */
  duration: number;
  durationUnit: 'days';
  /** This service's terms (Bus Semi line gets Bus Semi terms, and so on). */
  termsAndConditions: string;
}

/** Body POSTed to Baleen Media (via Edge Function). */
export interface BaleenQuotePayload {
  quoteId: string;
  clientName: string;
  mobile: string;
  lines: BaleenQuoteLine[];
}

const BALEEN_GST_MULT = 1.18;
const BALEEN_VENDOR_GST_PERCENT = 18;

function digitsOnlyPhone(phone: string | undefined): string {
  return String(phone || '').replace(/\D/g, '');
}

/** Whole rupees — same as Quote Preview totals, not 2dp. */
function roundMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
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

function normTermKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Word-boundary match so "Bus Semi" hits "Bus Semi Branding" without matching every "Bus". */
function looseServiceMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(long);
}

function serviceNeedles(items: QuoteItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    out.push(
      termsLabelFromItem(item),
      item.serviceName || '',
      item.medium || '',
      item.adType || '',
      item.title || '',
    );
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

function formatTermBullets(lines: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const text = raw.replace(/^•\s*/, '').trim();
    if (!text) continue;
    const key = normTermKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(`• ${text}`);
  }
  return out.join('\n');
}

/**
 * Terms for one Baleen line.
 * Per-item text wins. Otherwise split quote.termsAndConditions by service label
 * so Bus Semi and Auto Semi each send their own terms.
 */
function termsForServiceGroup(quote: Quote, items: QuoteItem[]): string {
  const fromItem = items.map((item) => (item.termsAndConditions || '').trim()).find(Boolean);
  if (fromItem) return fromItem;

  const resolved = resolveMergedDisplayTermEntries(
    quote.termsAndConditions,
    quote.items || [],
  );
  const needles = serviceNeedles(items).map(normTermKey).filter((k) => k.length >= 3);
  const matched = resolved.filter(
    (term) =>
      term.text.trim()
      && term.labels.some((label) => {
        const key = normTermKey(label);
        return needles.some((needle) => looseServiceMatch(key, needle));
      }),
  );
  if (matched.length) return formatTermBullets(matched.map((term) => term.text));

  const serviceGroups = new Set((quote.items || []).map(serviceGroupKey));
  if (serviceGroups.size <= 1) {
    const labeled = resolved.filter((term) => term.labels.length > 0 && term.text.trim());
    const pool = labeled.length ? labeled : resolved.filter((term) => term.text.trim());
    if (pool.length) return formatTermBullets(pool.map((term) => term.text));
    return (quote.termsAndConditions || '').trim();
  }

  return '';
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
 * Recurring display uses Quote Preview math (`computeRecurringLineTotal`):
 * - days multiple of 30 → monthlyRate = Math.round(daily × 30), then qty × monthly × months
 * - else → qty × daily × days
 * P&F / one-time: unit × qty (no duration).
 * vendorCostExclGst = displayCost + pmCost (excl GST), whole ₹
 * priceInclGst      = (displayPrice + pmPrice) × 1.18, whole ₹
 */
export function computeBaleenLineTotals(units: {
  displayPricePerDay: number | null;
  displayCostPerDay: number | null;
  pmPrice: number | null;
  pmCost: number | null;
  qty: number;
  days: number;
}): { vendorCostExclGst: number; priceInclGst: number } {
  const qty = units.qty > 0 ? units.qty : 1;
  const days = units.days > 0 ? units.days : 0;
  const hasDisplay =
    units.displayPricePerDay != null || units.displayCostPerDay != null;

  let costExcl: number;
  let priceExcl: number;

  if (hasDisplay) {
    const displayCost = computeRecurringLineTotal(
      qty,
      units.displayCostPerDay ?? 0,
      days > 0 ? days : null,
    );
    const displayPrice = computeRecurringLineTotal(
      qty,
      units.displayPricePerDay ?? 0,
      days > 0 ? days : null,
    );
    const pmCostAmt = (units.pmCost ?? 0) * qty;
    const pmPriceAmt = (units.pmPrice ?? 0) * qty;
    costExcl = displayCost + pmCostAmt;
    priceExcl = displayPrice + pmPriceAmt;
  } else {
    costExcl = (units.pmCost ?? 0) * qty;
    priceExcl = (units.pmPrice ?? 0) * qty;
  }

  return {
    vendorCostExclGst: roundMoney(costExcl),
    priceInclGst: roundMoney(priceExcl * BALEEN_GST_MULT),
  };
}

/** @deprecated Use computeBaleenLineTotals after merge — kept for tests. */
export function computeBaleenInboxLineAmounts(item: QuoteItem): {
  vendorCostExclGst: number;
  priceInclGst: number;
} {
  return computeBaleenLineTotals(mergeServiceGroup([item]));
}

/** @deprecated Alias — prefer computeBaleenLineTotals. */
export function computeBaleenInclGstTotals(units: {
  displayPricePerDay: number | null;
  displayCostPerDay: number | null;
  pmPrice: number | null;
  pmCost: number | null;
  qty: number;
  days: number;
}): { costInclGst: number; priceInclGst: number } {
  const t = computeBaleenLineTotals(units);
  return {
    costInclGst: roundMoney(t.vendorCostExclGst * BALEEN_GST_MULT),
    priceInclGst: t.priceInclGst,
  };
}

function normalizeVendorKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Reject NA / blank GST values from vendors.vendor_gst. */
export function usableVendorGst(value: unknown): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (upper === 'NA' || upper === 'N/A' || upper === '-' || upper === 'NULL' || upper === 'NONE') {
    return '';
  }
  return raw;
}

/**
 * Attach vendor GST numbers from a name → gst map (case-insensitive).
 * Lookup source: public.vendors.vendor_gst (not vendor_rate_chunks metadata).
 */
export function applyVendorGstNumbers(
  payload: BaleenQuotePayload,
  gstByVendorName: Map<string, string> | Record<string, string>,
): BaleenQuotePayload {
  const map =
    gstByVendorName instanceof Map
      ? gstByVendorName
      : new Map(
          Object.entries(gstByVendorName).map(([k, v]) => [normalizeVendorKey(k), usableVendorGst(v)]),
        );

  const lookup = (vendorName: string): string => {
    const key = normalizeVendorKey(vendorName);
    if (!key) return '';
    if (map.has(key)) return usableVendorGst(map.get(key));
    for (const [k, v] of map.entries()) {
      if (normalizeVendorKey(k) === key) return usableVendorGst(v);
    }
    return '';
  };

  return {
    ...payload,
    lines: payload.lines.map((line) => ({
      ...line,
      vendorGstNumber: lookup(line.vendorName),
    })),
  };
}

/**
 * Build Baleen Media inbox JSON from the live quote + client.
 * One line per service (Display + P&M merged). Amounts are Baleen POST only.
 * vendorGstNumber starts empty — call applyVendorGstNumbers after vendors lookup.
 */
export function buildBaleenQuotePayload(
  quote: Quote,
  client: ClientInfo,
  options?: { vendorGstByName?: Map<string, string> | Record<string, string> },
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
    const amounts = computeBaleenLineTotals(merged);
    return {
      serviceId: merged.serviceId,
      medium: merged.medium,
      adType: merged.adType,
      city: merged.city,
      vendorName: merged.vendorName,
      vendorGstNumber: '',
      vendorCostExclGst: amounts.vendorCostExclGst,
      vendorGstPercent: BALEEN_VENDOR_GST_PERCENT,
      priceInclGst: amounts.priceInclGst,
      qty: merged.qty,
      qtyUnit: merged.qtyUnit,
      duration: merged.days > 0 ? merged.days : 0,
      durationUnit: 'days',
      termsAndConditions: termsForServiceGroup(quote, groups.get(key)!),
    };
  });

  const payload: BaleenQuotePayload = {
    quoteId: String(quote.quoteNumber || quote.id || '').trim(),
    clientName: String(client.name || client.company || '').trim(),
    mobile: digitsOnlyPhone(client.phone),
    lines,
  };

  if (options?.vendorGstByName) {
    return applyVendorGstNumbers(payload, options.vendorGstByName);
  }
  return payload;
}
