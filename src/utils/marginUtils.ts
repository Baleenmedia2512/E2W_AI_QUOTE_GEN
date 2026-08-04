/**
 * Vendor cost + day-wise price/cost helpers (no Supabase / heavy app imports).
 */

import { DAYS_PER_MONTH } from './durationUtils';

function isNaLike(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'NA') return true;
  return false;
}

/** Parse positive amounts; strips ₹ / Rs / commas. */
function readPrice(...values: unknown[]): number {
  for (const v of values) {
    if (isNaLike(v)) continue;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    if (typeof v === 'string') {
      const cleaned = v
        .trim()
        .replace(/,/g, '')
        .replace(/^₹\s*/u, '')
        .replace(/^Rs\.?\s*/i, '')
        .trim();
      if (isNaLike(cleaned)) continue;
      const n = Number(cleaned);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 0;
}

/** Minimum selling margin vs vendor cost (percent). */
export const MIN_MARGIN_PERCENT = 4;

/**
 * Lowest allowed selling price for a given cost at MIN_MARGIN_PERCENT.
 * margin = (sell − cost) / sell ≥ 4%  ⇒  sell ≥ cost / 0.96
 */
export function minSellingForMargin(
  cost: number,
  marginPercent: number = MIN_MARGIN_PERCENT,
): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const denom = 1 - marginPercent / 100;
  if (denom <= 0) return cost;
  return cost / denom;
}

/**
 * Day-wise display selling rate:
 * 1) display_unit_price_per_day (new)
 * 2) pricing.display_price (old fallback)
 */
export function resolveDisplayUnitPricePerDay(
  pricing: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): number {
  return readPrice(
    pricing.display_unit_price_per_day,
    meta.display_unit_price_per_day,
    pricing.display_price,
  );
}

/**
 * Display unit cost per day:
 * 1) display_unit_cost_per_day (new)
 * 2) display_cost ÷ 30 when MONTH, else display_cost (old fallback)
 */
export function resolveDisplayUnitCostPerDay(meta: Record<string, unknown>): number | null {
  const pricing = (meta.pricing || {}) as Record<string, unknown>;
  const unitDay = readPrice(
    meta.display_unit_cost_per_day,
    pricing.display_unit_cost_per_day,
  );
  if (unitDay > 0) return unitDay;

  const displayCost = readPrice(meta.display_cost, pricing.display_cost);
  if (displayCost <= 0) return null;

  const unit = String(
    meta.display_cost_measurement_unit || pricing.display_cost_measurement_unit || '',
  )
    .trim()
    .toUpperCase();
  if (unit.startsWith('MONTH') || unit === 'PER_MONTH' || unit === 'PER MONTH') {
    return displayCost / DAYS_PER_MONTH;
  }
  if (unit.startsWith('DAY') || unit === 'PER_DAY' || unit === 'PER DAY') {
    return displayCost;
  }
  if (displayCost >= 1000) return displayCost / DAYS_PER_MONTH;
  return displayCost;
}

/** Sum of P&F vendor costs (printing + mounting, or combined). */
export function resolvePfCostFloor(meta: Record<string, unknown>): number | null {
  const pricing = (meta.pricing || {}) as Record<string, unknown>;
  const costs =
    meta.costs && typeof meta.costs === 'object' && !Array.isArray(meta.costs)
      ? (meta.costs as Record<string, unknown>)
      : {};

  const combined = readPrice(
    meta.printing_and_mounting_cost,
    pricing.printing_and_mounting_cost,
    meta.printingAndMountingCost,
    pricing.printingAndMountingCost,
    meta.printing_mounting_cost,
    pricing.printing_mounting_cost,
    meta.production_cost,
    pricing.production_cost,
    meta.pf_cost,
    pricing.pf_cost,
    costs.printing_and_mounting_cost,
    costs.printing_and_mounting,
    costs.pf_cost,
    // Per-unit total when service is P&F-only (no display cost)
    meta.unit_cost,
    pricing.unit_cost,
    meta.total_unit_cost,
    pricing.total_unit_cost,
  );
  if (combined > 0) return combined;

  const printing = readPrice(
    meta.printing_cost,
    pricing.printing_cost,
    meta.printingCost,
    pricing.printingCost,
    costs.printing_cost,
    costs.printing,
  );
  const mounting = readPrice(
    meta.mounting_cost,
    pricing.mounting_cost,
    meta.fixing_cost,
    pricing.fixing_cost,
    meta.mountingCost,
    pricing.mountingCost,
    meta.fixingCost,
    pricing.fixingCost,
    costs.mounting_cost,
    costs.fixing_cost,
    costs.mounting,
    costs.fixing,
  );
  const sum = printing + mounting;
  if (sum > 0) return sum;

  // Package total_cost ÷ min_qty → per-unit (P&F-only catalogs)
  const totalCost = readPrice(meta.total_cost, pricing.total_cost, costs.total_cost);
  const minQty = readPrice(meta.min_qty, meta.min_quantity, pricing.min_qty);
  if (totalCost > 0 && minQty > 0) {
    const perUnit = totalCost / minQty;
    if (perUnit > 0) return perUnit;
  }

  return null;
}

/** Map component labels → cost floors for P&F-only margin checks. */
export function resolvePfComponentCostFloors(
  meta: Record<string, unknown>,
): Record<string, number> {
  const pricing = (meta.pricing || {}) as Record<string, unknown>;
  const costs =
    meta.costs && typeof meta.costs === 'object' && !Array.isArray(meta.costs)
      ? (meta.costs as Record<string, unknown>)
      : {};
  const out: Record<string, number> = {};
  const printing = readPrice(
    meta.printing_cost,
    pricing.printing_cost,
    meta.printingCost,
    costs.printing_cost,
    costs.printing,
  );
  const mounting = readPrice(
    meta.mounting_cost,
    pricing.mounting_cost,
    meta.fixing_cost,
    meta.mountingCost,
    meta.fixingCost,
    costs.mounting_cost,
    costs.fixing_cost,
    costs.mounting,
    costs.fixing,
  );
  if (printing > 0) out.Printing = printing;
  if (mounting > 0) out.Mounting = mounting;
  const combined = readPrice(
    meta.printing_and_mounting_cost,
    pricing.printing_and_mounting_cost,
    meta.printingAndMountingCost,
    pricing.printingAndMountingCost,
    meta.printing_mounting_cost,
    pricing.printing_mounting_cost,
    meta.production_cost,
    pricing.production_cost,
    meta.pf_cost,
    pricing.pf_cost,
    costs.printing_and_mounting_cost,
    costs.printing_and_mounting,
    costs.pf_cost,
  );
  if (combined > 0 && printing <= 0 && mounting <= 0) {
    out['Printing & Mounting'] = combined;
  }
  return out;
}

/** Live package inputs for margin = (sell − cost) / sell. */
export interface PackageMarginInput {
  quantity: number;
  /** Campaign days (0 if no display / one-time only). */
  durationDays: number;
  /** Display selling rate per unit per day (0 if no display line). */
  displayDailyRate: number;
  /** P&F selling rate per unit (0 if none). */
  pfUnitRate: number;
  /** display_unit_cost_per_day from DB (null if unknown). */
  displayUnitCostPerDay: number | null;
  /** printing_cost + mounting_cost per unit from DB (null if unknown). */
  pfUnitCost: number | null;
}

/**
 * Vendor package cost from DB unit costs:
 * display_unit_cost_per_day × qty × days + (printing + mounting) × qty
 */
export function computePackageCost(input: PackageMarginInput): number {
  const qty = Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 0;
  const days =
    Number.isFinite(input.durationDays) && input.durationDays > 0 ? input.durationDays : 0;
  const displayCostPerDay =
    input.displayUnitCostPerDay != null && input.displayUnitCostPerDay > 0
      ? input.displayUnitCostPerDay
      : 0;
  const pfCost =
    input.pfUnitCost != null && input.pfUnitCost > 0 ? input.pfUnitCost : 0;

  const hasDisplay = input.displayDailyRate > 0 || displayCostPerDay > 0;
  const displayPart = hasDisplay && days > 0 ? displayCostPerDay * qty * days : 0;
  const pfPart = pfCost * qty;
  return displayPart + pfPart;
}

/**
 * Live package sell (excl. GST):
 * displayDaily × qty × days + pfUnit × qty
 */
export function computePackageSell(input: PackageMarginInput): number {
  const qty = Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 0;
  const days =
    Number.isFinite(input.durationDays) && input.durationDays > 0 ? input.durationDays : 0;
  const displayDaily =
    Number.isFinite(input.displayDailyRate) && input.displayDailyRate > 0
      ? input.displayDailyRate
      : 0;
  const pf =
    Number.isFinite(input.pfUnitRate) && input.pfUnitRate > 0 ? input.pfUnitRate : 0;

  const displayPart = displayDaily > 0 && days > 0 ? displayDaily * qty * days : 0;
  const pfPart = pf * qty;
  return displayPart + pfPart;
}

/** True when sell margin vs cost is at least MIN_MARGIN_PERCENT (or cost unknown). */
export function isPackageMarginOk(sell: number, cost: number): boolean {
  if (!Number.isFinite(cost) || cost <= 0) return true;
  if (!Number.isFinite(sell) || sell <= 0) return false;
  const margin = (sell - cost) / sell;
  return margin + 1e-12 >= MIN_MARGIN_PERCENT / 100;
}
