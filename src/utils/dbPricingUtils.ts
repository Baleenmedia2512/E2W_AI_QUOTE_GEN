import { QuoteItem } from '../types/quote';
import { DbMetadataLike, resolveQuoteLineDuration } from './durationUtils';
import type { DbService } from './serviceResolver';

function getMinQtyFromService(svc: DbService): number | undefined {
  const m = svc.metadata || {};
  const pricing = (m.pricing || {}) as { min_quantity?: number };
  const raw = pricing.min_quantity ?? (m as { min_quantity?: number }).min_quantity;
  if (raw == null || (typeof raw === 'string' && raw === '')) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? n : undefined;
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
    if (v == null || v === '') continue;
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

/** Normalize all pricing fields from metadata (+ optional content fallback). */
export function extractDbPricingFields(svc: DbService): DbPricingFields {
  const m = svc.metadata || {};
  const p = (m.pricing || {}) as Record<string, unknown>;
  const meta = m as Record<string, unknown>;

  const base: DbPricingFields = {
    structure: typeof p.structure === 'string' ? p.structure : undefined,
    displayPrice: readDbPrice(p.display_price, p.rental_price, p.rental),
    productionPrice: readDbPrice(p.production_price, p.printing_price, p.printing_and_fixing_price),
    unitPrice: readDbPrice(p.unit_price, meta.unit_price),
    rentalPrice: readDbPrice(p.rental_price, p.price, p.rental, p.combined_price),
    designCost: readDbPrice(p.design_cost, p.design_price, meta.design_cost),
    combinedPrice: readDbPrice(p.combined_price, p.price),
    totalPrice: readDbPrice(p.total_price, p.final_total, p.grand_total, p.campaign_total),
    displayPeriod:
      String(p.display_period || p.period || meta.duration || 'per month').trim() || 'per month',
    productionUnit: String(p.production_unit || 'per unit').trim() || 'per unit',
    period:
      String(p.period || p.display_period || meta.duration || 'per month').trim() || 'per month',
    minQuantity: readDbPrice(p.min_quantity, meta.min_quantity) || undefined,
    fromContentFallback: false,
  };

  if (!hasQuotablePricingFromFields(base)) {
    const fromContent = parsePricesFromContent(svc.content);
    if (fromContent.fromContentFallback) {
      return {
        ...base,
        displayPrice: fromContent.displayPrice || base.displayPrice,
        productionPrice: fromContent.productionPrice || base.productionPrice,
        unitPrice: fromContent.unitPrice || base.unitPrice,
        rentalPrice: fromContent.rentalPrice || base.rentalPrice,
        designCost: fromContent.designCost || base.designCost,
        combinedPrice: fromContent.combinedPrice || base.combinedPrice,
        totalPrice: fromContent.totalPrice || base.totalPrice,
        fromContentFallback: true,
      };
    }
  }

  return base;
}

function hasQuotablePricingFromFields(f: DbPricingFields): boolean {
  if (f.displayPrice > 0 && f.productionPrice > 0) return true;
  if (f.displayPrice > 0 || f.productionPrice > 0) return true;
  if (f.unitPrice > 0) return true;
  if (f.rentalPrice > 0 || f.combinedPrice > 0 || f.totalPrice > 0) return true;
  if (f.designCost > 0 && (f.rentalPrice > 0 || f.combinedPrice > 0 || f.totalPrice > 0)) {
    return true;
  }
  return false;
}

/** True when at least one billable rate can be read from this DB row. */
export function hasQuotablePricing(svc: DbService): boolean {
  return hasQuotablePricingFromFields(extractDbPricingFields(svc));
}

function pricingCompletenessScore(svc: DbService): number {
  const f = extractDbPricingFields(svc);
  let score = 0;
  if (f.displayPrice > 0) score += 3;
  if (f.productionPrice > 0) score += 3;
  if (f.unitPrice > 0) score += 3;
  if (f.rentalPrice > 0) score += 3;
  if (f.combinedPrice > 0) score += 2;
  if (f.totalPrice > 0) score += 2;
  if (f.designCost > 0) score += 1;
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

/** Build quote line items from normalized DB pricing (shared by confirm-table quote builder). */
export function buildLineItemsFromDbPricing(
  svc: DbService,
  quantity: number,
  userMessage: string,
  sectionIndex: number,
): QuoteItem[] {
  const f = extractDbPricingFields(svc);
  const m = svc.metadata || {};
  const meta = m as DbMetadataLike;
  const serviceName = svc.service_name;
  const minQty = getMinQtyFromService(svc) ?? undefined;
  const items: QuoteItem[] = [];
  let lineIndex = 0;

  const mkId = () => `${sectionIndex}-${lineIndex++}`;

  const addLine = (description: string, rate: number, qty: number, isRecurring: boolean) => {
    if (rate <= 0) return;
    const resolved = resolveQuoteLineDuration({ description }, userMessage, meta);
    const mult = isRecurring ? resolved.multiplier : 1;
    items.push({
      id: mkId(),
      title: serviceName,
      description,
      serviceId: svc.service_id,
      serviceName,
      quantity: qty,
      rate,
      duration: isRecurring ? resolved.duration : undefined,
      durationUnit: isRecurring ? resolved.durationUnit : undefined,
      durationIsAuto: isRecurring ? resolved.isAutoFromDb : undefined,
      total: qty * rate * mult,
      minimumQuantity: minQty,
    });
  };

  // Type A — separate display + production (both must be > 0)
  if (f.displayPrice > 0 && f.productionPrice > 0) {
    addLine(
      `${serviceName} - Display Price (${f.displayPeriod})`,
      f.displayPrice,
      quantity,
      true,
    );
    addLine(
      `${serviceName} - Printing & Fixing Price (${f.productionUnit})`,
      f.productionPrice,
      quantity,
      false,
    );
    return items;
  }

  // Type B — campaign / unit pricing (skip when rental/display already present — avoids duplicate lines)
  const hasRentalLike =
    f.rentalPrice > 0 || f.combinedPrice > 0 || f.displayPrice > 0;

  const isCampaign =
    f.structure === 'campaign' ||
    (f.unitPrice > 0 && (f.minQuantity ?? 0) > 1 && !hasRentalLike);
  if (isCampaign && f.unitPrice > 0) {
    addLine(
      `${serviceName} - Unit Price${f.period ? ` (${f.period})` : ''}`,
      f.unitPrice,
      quantity,
      true,
    );
    return items;
  }

  // Type C — rental / combined / display-only (printing included in rental)
  const primaryRental =
    f.rentalPrice ||
    f.combinedPrice ||
    f.displayPrice ||
    (f.totalPrice > 0 && f.designCost > 0 ? f.totalPrice - f.designCost : f.totalPrice);

  if (primaryRental > 0) {
    addLine(
      `${serviceName} - Rental Price (${f.period})`,
      primaryRental,
      quantity,
      true,
    );
    if (f.designCost > 0) {
      addLine(`${serviceName} - Design Cost`, f.designCost, quantity, false);
    }
    return items;
  }

  if (f.productionPrice > 0) {
    addLine(
      `${serviceName} - Printing & Fixing Price (${f.productionUnit})`,
      f.productionPrice,
      quantity,
      false,
    );
  }

  if (f.unitPrice > 0) {
    addLine(
      `${serviceName} - Unit Price${f.period ? ` (${f.period})` : ''}`,
      f.unitPrice,
      quantity,
      true,
    );
  }

  return items;
}
