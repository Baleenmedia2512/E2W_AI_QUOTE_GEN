import { QuoteItem } from '../types/quote';
import {
  DbMetadataLike,
  computeQuoteItemTotal,
  resolveQuoteLineDuration,
} from './durationUtils';
import { resolveDisplayUnitPricePerDay, resolveDisplayUnitCostPerDay, resolvePfCostFloor } from './marginUtils';
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

/** All vendor display_price values are day-wise — ignore display_period / duration unit. */
function formatPricingPeriod(
  _p: Record<string, unknown>,
  _meta: Record<string, unknown>,
  _serviceName?: string,
): string {
  return 'per day';
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
 * One-time add-on parts with display names (skip NA / 0).
 * Prefer combined Printing & Mounting / Fixing; else separate Printing + Mounting.
 */
export interface OneTimeAddOnComponent {
  label: string;
  amount: number;
}

export function listOneTimeAddOnComponents(
  p: Record<string, unknown> | undefined | null,
): OneTimeAddOnComponent[] {
  if (!p) return [];
  const parts: OneTimeAddOnComponent[] = [];

  const printingAndMounting = readDbPrice(p.printing_and_mounting_price);
  const printingAndFixing = readDbPrice(p.printing_and_fixing_price);
  const printing = readDbPrice(p.printing_price);
  const mounting = readDbPrice(p.mounting_price);
  const production = readDbPrice(p.production_price);

  if (printingAndMounting > 0) {
    parts.push({ label: 'Printing & Mounting', amount: printingAndMounting });
  } else if (printingAndFixing > 0) {
    parts.push({ label: 'Printing & Fixing', amount: printingAndFixing });
  } else {
    if (printing > 0) parts.push({ label: 'Printing', amount: printing });
    if (mounting > 0) parts.push({ label: 'Mounting', amount: mounting });
    if (printing <= 0 && mounting <= 0 && production > 0) {
      parts.push({ label: 'Production', amount: production });
    }
  }

  const official = readDbPrice(p.official_and_incidental_price);
  if (official > 0) parts.push({ label: 'Official & Incidental', amount: official });

  const rto = readDbPrice(p.rto_price);
  if (rto > 0) parts.push({ label: 'RTO', amount: rto });

  const freight = readDbPrice(p.freight_price);
  if (freight > 0) parts.push({ label: 'Freight', amount: freight });

  const recce = readDbPrice(p.recce_price);
  if (recce > 0) parts.push({ label: 'Recce', amount: recce });

  return parts;
}

/**
 * One-time add-ons on the Printing & Fixing line:
 * named components only (Printing / Mounting / RTO / …), skip NA / 0.
 */
export function sumOneTimeAddOns(p: Record<string, unknown>): number {
  return listOneTimeAddOnComponents(p).reduce((sum, c) => sum + c.amount, 0);
}

/**
 * Day-wise display selling rate:
 * 1) display_unit_price_per_day (new)
 * 2) pricing.display_price (old fallback)
 * @deprecated Prefer importing from marginUtils — re-exported for callers.
 */
export { resolveDisplayUnitPricePerDay } from './marginUtils';

/** Normalize quote pricing — day-wise display rate + one-time add-ons.
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
    displayPrice: resolveDisplayUnitPricePerDay(p, meta),
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
 * - Display: raw display_price × qty × days (days from min_days / user)
 * - Printing & Fixing: one-time add-ons, no duration
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

  const hasDisplayPrice = f.displayPrice > 0;
  let pfUnitCost = resolvePfCostFloor(m as Record<string, unknown>);
  const displayUnitCostPerDay = resolveDisplayUnitCostPerDay(m as Record<string, unknown>);
  // P&F-only: cost often lives in display_unit_cost_per_day (Auto Full etc.)
  if ((pfUnitCost == null || pfUnitCost <= 0) && !hasDisplayPrice && displayUnitCostPerDay != null) {
    pfUnitCost = displayUnitCostPerDay;
  }

  const addLine = (description: string, rate: number, qty: number, isRecurring: boolean) => {
    if (rate <= 0) return;
    const resolved = resolveQuoteLineDuration(
      { description },
      userMessage,
      meta,
      serviceName,
    );
    const line: QuoteItem = {
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
      minimumQuantity: minQty,
      total: 0,
      vendorPfUnitCost: pfUnitCost ?? undefined,
      vendorDisplayUnitCostPerDay: hasDisplayPrice
        ? displayUnitCostPerDay ?? undefined
        : undefined,
    };
    line.total = computeQuoteItemTotal(line);
    items.push(line);
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
