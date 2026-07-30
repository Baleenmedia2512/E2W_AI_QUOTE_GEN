import { QuoteItem } from '../types/quote';
import {
  DbMetadataLike,
  isVendorDailyDisplayRate,
  resolveQuoteLineDuration,
} from './durationUtils';
import type { DbService } from './serviceResolver';
import { formatServiceDisplayName } from './serviceResolver';

function isNaLike(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'NA') return true;
  return false;
}

/** Qty column label: "bus" not "per bus" (rate period uses "per month" separately). */
function formatQtyUnitLabel(...candidates: Array<string | undefined | null>): string | undefined {
  for (const raw of candidates) {
    if (raw == null || String(raw).trim() === '') continue;
    const cleaned = String(raw).trim().replace(/^per\s+/i, '').trim();
    if (cleaned && cleaned.toUpperCase() !== 'NA') return cleaned;
  }
  return undefined;
}

function getMinQtyFromService(svc: DbService): number | undefined {
  const m = svc.metadata || {};
  // Vendor top-level only — never pricing.min_qty
  const raw =
    (m as { min_qty?: number | string }).min_qty ??
    (m as { min_quantity?: number | string }).min_quantity;
  if (isNaLike(raw)) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? n : undefined;
}

function formatPricingPeriod(
  p: Record<string, unknown>,
  meta: Record<string, unknown>,
  serviceName?: string,
): string {
  if (p.display_period && !isNaLike(p.display_period)) {
    const hint = String(p.display_period).trim();
    // Mobile Van may still say "per month" in display_period while billing is daily × days
    if (
      isVendorDailyDisplayRate(
        { pricing: p as DbMetadataLike['pricing'], medium: meta.medium as string | undefined, min_duration: meta.min_duration as number | string | undefined, duration_measurement_unit: meta.duration_measurement_unit as string | undefined },
        serviceName,
      )
    ) {
      return 'per day';
    }
    return hint;
  }
  if (p.period && !isNaLike(p.period)) {
    return String(p.period).trim();
  }

  // Vendor top-level duration only — never pricing.min_duration
  const md = Number(meta.min_duration);
  const du = String(meta.duration_measurement_unit || '').trim().toLowerCase();

  // Daily unit rate (Mobile Van any min days, or short min like LED Hoardings)
  if (
    isVendorDailyDisplayRate(
      { pricing: p as DbMetadataLike['pricing'], medium: meta.medium as string | undefined, min_duration: meta.min_duration as number | string | undefined, duration_measurement_unit: meta.duration_measurement_unit as string | undefined },
      serviceName,
    )
  ) {
    return 'per day';
  }

  // 28–31 day campaign package = one billing month (Apartment Lift, etc.)
  if (Number.isFinite(md) && md >= 28 && md <= 31 && du.startsWith('day')) {
    return 'per month';
  }
  if (meta.min_duration != null && !isNaLike(meta.min_duration) && du && !isNaLike(du)) {
    return `per ${meta.min_duration} ${meta.duration_measurement_unit}`.trim();
  }
  if (meta.duration && !isNaLike(meta.duration)) {
    return String(meta.duration).trim();
  }
  return 'per month';
}

function formatProductionUnit(p: Record<string, unknown>): string {
  if (p.production_unit && !isNaLike(p.production_unit)) {
    return String(p.production_unit).trim();
  }
  const qtyUnit = p.qty_measurement_unit;
  if (qtyUnit && !isNaLike(qtyUnit)) {
    return `per ${String(qtyUnit).trim()}`;
  }
  return 'per unit';
}

export interface DbPricingFields {
  structure?: string;
  displayPrice: number;
  productionPrice: number;
  unitPrice: number;
  rentalPrice: number;
  designCost: number;
  combinedPrice: number;
  totalPrice: number;
  displayPeriod: string;
  productionUnit: string;
  period: string;
  minQuantity?: number;
  fromContentFallback: boolean;
}

/** Read first positive numeric value from candidates. */
export function readDbPrice(...values: unknown[]): number {
  for (const v of values) {
    if (isNaLike(v)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function parseAmountFromText(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  if (!m?.[1]) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Last-resort price extraction from chunk content when metadata.pricing is empty. */
function parsePricesFromContent(content?: string): Partial<DbPricingFields> {
  if (!content?.trim()) return {};
  const t = content;

  const rentalPrice = parseAmountFromText(
    t,
    /rental\s+price[^₹\d]*[₹Rs.]?\s*([\d,]+)/i,
  );
  const displayPrice = parseAmountFromText(
    t,
    /display\s+(?:price|total)[^₹\d]*[₹Rs.]?\s*([\d,]+)/i,
  );
  const designCost = parseAmountFromText(
    t,
    /design\s+(?:cost|price)[^₹\d]*[₹Rs.]?\s*([\d,]+)/i,
  );
  const productionPrice = parseAmountFromText(
    t,
    /(?:printing\s*&?\s*fixing|production)\s+(?:price)?[^₹\d]*[₹Rs.]?\s*([\d,]+)/i,
  );
  const unitPrice = parseAmountFromText(
    t,
    /unit\s+price[^₹\d]*[₹Rs.]?\s*([\d,]+)/i,
  );
  const totalPrice = parseAmountFromText(
    t,
    /(?:final\s+)?total[^₹\d]*[₹Rs.]?\s*([\d,]+)/i,
  );

  const any =
    rentalPrice || displayPrice || designCost || productionPrice || unitPrice || totalPrice;
  if (!any) return {};

  return {
    rentalPrice: rentalPrice || displayPrice,
    displayPrice: displayPrice || rentalPrice,
    designCost,
    productionPrice,
    unitPrice,
    totalPrice,
    fromContentFallback: true,
  };
}

/**
 * One-time add-ons on the Printing & Fixing line:
 * P&F + official + RTO + freight + recce (skip NA / 0).
 */
function sumOneTimeAddOns(p: Record<string, unknown>): number {
  const pf = readDbPrice(
    p.printing_and_mounting_price,
    p.printing_price,
    p.mounting_price,
    p.production_price,
    p.printing_and_fixing_price,
  );
  const official = readDbPrice(p.official_and_incidental_price);
  const rto = readDbPrice(p.rto_price);
  const freight = readDbPrice(p.freight_price);
  const recce = readDbPrice(p.recce_price);
  return pf + official + rto + freight + recce;
}

/** Normalize quote pricing — raw display_price (never pre-folded) + one-time add-ons.
 * Duration math (× days vs 1 month) is handled in resolveQuoteLineDuration.
 */
export function extractDbPricingFields(svc: DbService): DbPricingFields {
  const m = svc.metadata || {};
  const p = (m.pricing || {}) as Record<string, unknown>;
  const meta = m as Record<string, unknown>;

  const displayPeriod = formatPricingPeriod(p, meta, svc.service_name);
  const productionUnit = formatProductionUnit({
    ...p,
    qty_measurement_unit:
      p.qty_measurement_unit && !isNaLike(p.qty_measurement_unit)
        ? p.qty_measurement_unit
        : meta.qty_measurement_unit,
  });

  const base: DbPricingFields = {
    structure: typeof p.structure === 'string' ? p.structure : undefined,
    displayPrice: readDbPrice(p.display_price),
    productionPrice: sumOneTimeAddOns(p),
    unitPrice: 0,
    rentalPrice: 0,
    designCost: 0,
    combinedPrice: 0,
    totalPrice: 0,
    displayPeriod,
    productionUnit,
    period: displayPeriod,
    minQuantity: readDbPrice(meta.min_qty, meta.min_quantity) || undefined,
    fromContentFallback: false,
  };

  return base;
}

function hasQuotablePricingFromFields(f: DbPricingFields): boolean {
  return f.displayPrice > 0 || f.productionPrice > 0;
}

/** True when display and/or P&F rate can be read from metadata.pricing. */
export function hasQuotablePricing(svc: DbService): boolean {
  return hasQuotablePricingFromFields(extractDbPricingFields(svc));
}

function pricingCompletenessScore(svc: DbService): number {
  const f = extractDbPricingFields(svc);
  let score = 0;
  if (f.displayPrice > 0) score += 3;
  if (f.productionPrice > 0) score += 3;
  if (!f.fromContentFallback) score += 5;
  return score;
}

/** When multiple chunks share a name, prefer the row with complete pricing metadata. */
export function pickPreferredDbService(candidates: DbService[]): DbService | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const quotable = candidates.filter(hasQuotablePricing);
  const pool = quotable.length > 0 ? quotable : candidates;
  return [...pool].sort((a, b) => pricingCompletenessScore(b) - pricingCompletenessScore(a))[0];
}

/**
 * Build quote line items from vendor pricing:
 * - Period package (Apartment etc.): raw display × qty × 1 month
 * - Daily (Mobile Van any min days, or min_duration < 28): raw display × qty × min_duration days
 * - Printing & Fixing: P&F + official (+ extras), no duration
 */
export function buildLineItemsFromDbPricing(
  svc: DbService,
  quantity: number,
  userMessage: string,
  sectionIndex: number,
): QuoteItem[] {
  const f = extractDbPricingFields(svc);
  const m = svc.metadata || {};
  const meta = m as DbMetadataLike;
  const serviceName = formatServiceDisplayName(svc);
  const minQty = getMinQtyFromService(svc) ?? undefined;
  const items: QuoteItem[] = [];
  let lineIndex = 0;

  const mkId = () => `${sectionIndex}-${lineIndex++}`;

  const unitLabel = formatQtyUnitLabel(
    (m as { qty_measurement_unit?: string }).qty_measurement_unit,
    (m as Record<string, unknown>).unit_label as string | undefined,
  );

  const addLine = (description: string, rate: number, qty: number, isRecurring: boolean) => {
    if (rate <= 0) return;
    const resolved = resolveQuoteLineDuration(
      { description },
      userMessage,
      meta,
      serviceName,
    );
    const mult = isRecurring ? resolved.multiplier : 1;
    items.push({
      id: mkId(),
      title: serviceName,
      description,
      serviceId: svc.service_id,
      serviceName,
      quantity: qty,
      quantityUnit: unitLabel,
      rate,
      duration: isRecurring ? resolved.duration : undefined,
      durationUnit: isRecurring ? resolved.durationUnit : undefined,
      durationIsAuto: isRecurring ? resolved.isAutoFromDb : undefined,
      total: qty * rate * mult,
      minimumQuantity: minQty,
    });
  };

  if (f.displayPrice > 0) {
    addLine(
      `${serviceName} - Display Price`,
      f.displayPrice,
      quantity,
      true,
    );
  }

  if (f.productionPrice > 0) {
    addLine(
      `${serviceName} - Printing & Fixing Price`,
      f.productionPrice,
      quantity,
      false,
    );
  }

  // OLD Type B (campaign/unit) and Type C (rental/design/total) — disabled
  // Quote pricing is display + P&F from vendor_rate_chunks only.

  return items;
}
