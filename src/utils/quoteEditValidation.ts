/**
 * Validate quote edits against vendor floors / cost margin.
 * Qty / duration: vendor top-level only (never pricing.min_qty / min_days).
 * Display rate: 4% margin vs display_unit_cost_per_day (fallback: display_cost).
 * P&F rate: margin only when service is P&F-only (no display); otherwise free edit.
 */

import {
  getVendorRatesCache,
  vendorRatesToDbServices,
} from '../services/vendorRateService';
import { getMinQuantityFromDbService } from './cloudQuoteValidation';
import {
  listOneTimeAddOnComponents,
} from './dbPricingUtils';
import {
  MIN_MARGIN_PERCENT,
  minSellingForMargin,
  computePackageCost,
  computePackageSell,
  isPackageMarginOk,
  resolveDisplayUnitCostPerDay,
  resolveDisplayUnitPricePerDay,
  resolvePfCostFloor,
  resolvePfComponentCostFloors,
  type PackageMarginInput,
} from './marginUtils';
import {
  isOneTimeLineDescription,
  isVendorDailyDisplayRate,
  DAYS_PER_MONTH,
  computeQuoteItemTotal,
  vendorMinDays,
  type DbMetadataLike,
} from './durationUtils';
import type { DbService } from './serviceResolver';
import { resolveServiceIdFromCatalog } from './serviceResolver';
import type { QuoteItem } from '../types/quote';

export {
  MIN_MARGIN_PERCENT,
  minSellingForMargin,
  computePackageCost,
  computePackageSell,
  isPackageMarginOk,
  resolveDisplayUnitCostPerDay,
  resolveDisplayUnitPricePerDay,
  resolvePfCostFloor,
  resolvePfComponentCostFloors,
} from './marginUtils';
export type { PackageMarginInput } from './marginUtils';

function isNaLike(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'NA') return true;
  return false;
}

export type QuoteEditField = 'quantity' | 'duration' | 'displayRate' | 'pfRate';

export type RateUiMode = 'per_day' | 'per_month';

export interface VendorEditFloors {
  minQty: number | null;
  minDuration: number | null;
  /**
   * Catalog day-wise display selling rate (unit price per day, else old display_price).
   * Used for package repair only — edit floor uses displayUnitCostPerDay + margin.
   */
  displayPriceFloor: number | null;
  /** True when display rate is treated as per-day. */
  displayPriceIsDaily: boolean;
  /** Display vendor cost per unit per day (margin floor source). */
  displayUnitCostPerDay: number | null;
  /** True when service has a display/rental selling line. */
  hasDisplayPricing: boolean;
  /**
   * P&F cost floor (printing + mounting cost).
   * Enforced with 4% margin only when hasDisplayPricing is false (P&F-only).
   */
  pfCostFloor: number | null;
  /** Legacy selling P&F sum — not used when hasDisplayPricing. */
  pfPriceFloor: number | null;
  /** Per-component cost floors keyed by label (Printing, Mounting, …). */
  pfComponentCostFloors: Record<string, number>;
  qtyUnit?: string;
  durationUnitLabel?: string;
}

export interface ValidateQuoteEditResult {
  ok: boolean;
  message?: string;
}

/** P&F floor = sum of named one-time add-ons (Printing, RTO, …), same as quote build. */
export function getPfPriceFloorFromPricing(pricing: Record<string, unknown> | undefined): number | null {
  if (!pricing) return null;
  const total = listOneTimeAddOnComponents(pricing).reduce((sum, c) => sum + c.amount, 0);
  return total > 0 ? total : null;
}

/** Per-component selling floor for a named one-time add-on (from vendor pricing). */
export function getOneTimeComponentFloor(
  pricing: Record<string, unknown> | undefined,
  label: string,
): number | null {
  if (!pricing) return null;
  const match = listOneTimeAddOnComponents(pricing).find((c) => c.label === label);
  return match && match.amount > 0 ? match.amount : null;
}

function hasDisplaySelling(meta: Record<string, unknown>, pricing: Record<string, unknown>): boolean {
  return resolveDisplayUnitPricePerDay(pricing, meta) > 0;
}

export function getVendorEditFloors(svc: DbService): VendorEditFloors {
  const m = (svc.metadata || {}) as Record<string, unknown>;
  const pricing = (m.pricing || {}) as Record<string, unknown>;

  const minQty = getMinQuantityFromDbService(svc);

  const days = vendorMinDays(svc.metadata as DbMetadataLike);
  const minDuration = Number.isFinite(days) && days > 0 ? days : null;

  const displayRaw = resolveDisplayUnitPricePerDay(pricing, m);
  const displayPriceFloor = displayRaw > 0 ? displayRaw : null;
  const pfPriceFloor = getPfPriceFloorFromPricing(pricing);
  const displayPriceIsDaily = isVendorDailyDisplayRate(
    svc.metadata as DbMetadataLike,
    svc.service_name,
  );

  const displayUnitCostPerDay = resolveDisplayUnitCostPerDay(m);
  const hasDisplayPricing = hasDisplaySelling(m, pricing);
  let pfCostFloor = resolvePfCostFloor(m);
  let pfComponentCostFloors = resolvePfComponentCostFloors(m);

  // P&F-only catalogs (e.g. Auto Full) often store unit cost in display_unit_cost_per_day
  // even when there is no display selling price — treat it as P&F cost.
  if (
    (pfCostFloor == null || pfCostFloor <= 0) &&
    !hasDisplayPricing &&
    displayUnitCostPerDay != null &&
    displayUnitCostPerDay > 0
  ) {
    pfCostFloor = displayUnitCostPerDay;
    if (!pfComponentCostFloors['Printing & Mounting']) {
      pfComponentCostFloors = {
        ...pfComponentCostFloors,
        'Printing & Mounting': displayUnitCostPerDay,
      };
    }
    marginDebug('getVendorEditFloors: P&F-only — using displayUnitCostPerDay as pfCostFloor', {
      serviceId: svc.service_id,
      pfCostFloor,
    });
  }

  const qtyUnit = !isNaLike(m.qty_measurement_unit)
    ? String(m.qty_measurement_unit).trim().replace(/^per\s+/i, '')
    : undefined;

  const floors: VendorEditFloors = {
    minQty,
    minDuration,
    displayPriceFloor,
    displayPriceIsDaily,
    // Don't double-count as display cost when we remapped it to P&F for P&F-only
    displayUnitCostPerDay: hasDisplayPricing ? displayUnitCostPerDay : null,
    hasDisplayPricing,
    pfCostFloor,
    pfPriceFloor,
    pfComponentCostFloors,
    qtyUnit,
    durationUnitLabel: 'days',
  };

  marginDebug('getVendorEditFloors', {
    serviceId: svc.service_id,
    serviceName: svc.service_name,
    pfCostFloor,
    pfPriceFloor,
    displayUnitCostPerDay: floors.displayUnitCostPerDay,
    rawDisplayUnitCostPerDay: displayUnitCostPerDay,
    hasDisplayPricing,
    pfComponentCostFloors,
    costFieldsInMeta: costFieldSnapshot(m),
  });

  return floors;
}

/** Prefer catalog floors; fill gaps from costs stamped on the quote line at build time. */
export function mergeFloorsWithQuoteItem(
  floors: VendorEditFloors,
  item?: Pick<QuoteItem, 'vendorPfUnitCost' | 'vendorDisplayUnitCostPerDay' | 'serviceId'> | null,
  allItems?: Array<Pick<QuoteItem, 'vendorPfUnitCost' | 'vendorDisplayUnitCostPerDay' | 'serviceId'>>,
): VendorEditFloors {
  let pfFromItem =
    item?.vendorPfUnitCost != null && item.vendorPfUnitCost > 0
      ? item.vendorPfUnitCost
      : null;
  let displayFromItem =
    item?.vendorDisplayUnitCostPerDay != null && item.vendorDisplayUnitCostPerDay > 0
      ? item.vendorDisplayUnitCostPerDay
      : null;

  // Sibling lines in the same service (Display + P&F) may hold the stamp
  if ((!pfFromItem || !displayFromItem) && item?.serviceId && allItems?.length) {
    const sid = item.serviceId.trim().toLowerCase();
    for (const other of allItems) {
      if ((other.serviceId || '').trim().toLowerCase() !== sid) continue;
      if (!pfFromItem && other.vendorPfUnitCost != null && other.vendorPfUnitCost > 0) {
        pfFromItem = other.vendorPfUnitCost;
      }
      if (
        !displayFromItem &&
        other.vendorDisplayUnitCostPerDay != null &&
        other.vendorDisplayUnitCostPerDay > 0
      ) {
        displayFromItem = other.vendorDisplayUnitCostPerDay;
      }
    }
  }

  const merged: VendorEditFloors = {
    ...floors,
    pfCostFloor:
      floors.pfCostFloor != null && floors.pfCostFloor > 0
        ? floors.pfCostFloor
        : pfFromItem ?? floors.pfCostFloor,
    displayUnitCostPerDay:
      floors.displayUnitCostPerDay != null && floors.displayUnitCostPerDay > 0
        ? floors.displayUnitCostPerDay
        : displayFromItem ?? floors.displayUnitCostPerDay,
  };

  marginDebug('mergeFloorsWithQuoteItem', {
    catalogPfCostFloor: floors.pfCostFloor,
    itemVendorPfUnitCost: item?.vendorPfUnitCost ?? null,
    siblingPfFromItem: pfFromItem,
    mergedPfCostFloor: merged.pfCostFloor,
    catalogDisplayCost: floors.displayUnitCostPerDay,
    mergedDisplayCost: merged.displayUnitCostPerDay,
    serviceId: item?.serviceId ?? null,
  });

  return merged;
}

/** Resolve catalog row for a quote line (cache → optional service list). */
export function resolveDbServiceForQuoteItem(
  item: {
    serviceId?: string;
    serviceName?: string;
    description?: string;
    city?: string;
  },
  services?: DbService[],
): DbService | null {
  const catalog =
    services && services.length > 0
      ? services
      : vendorRatesToDbServices(getVendorRatesCache());

  if (!catalog.length) {
    marginDebug('resolveDbServiceForQuoteItem: empty catalog', {
      cacheLen: getVendorRatesCache().length,
      lookup: item,
    });
    return null;
  }

  if (item.serviceId?.trim()) {
    const id = item.serviceId.trim().toLowerCase();
    const byId = catalog.find((s) => s.service_id.toLowerCase() === id);
    if (byId) {
      marginDebug('resolveDbServiceForQuoteItem: by serviceId', {
        serviceId: byId.service_id,
        serviceName: byId.service_name,
      });
      return byId;
    }
  }

  const lookupName = item.serviceName || item.description || '';
  const cityHint = item.city?.trim() && item.city !== '—' ? item.city.toLowerCase() : undefined;
  const resolved = resolveServiceIdFromCatalog(lookupName, catalog, cityHint);
  if (!resolved) {
    marginDebug('resolveDbServiceForQuoteItem: NOT FOUND', {
      lookupName,
      cityHint,
      serviceId: item.serviceId ?? null,
      catalogSize: catalog.length,
    });
    return null;
  }
  const svc = catalog.find((s) => s.service_id === resolved.serviceId) || null;
  marginDebug('resolveDbServiceForQuoteItem: by name', {
    lookupName,
    resolvedId: resolved.serviceId,
    found: !!svc,
  });
  return svc;
}

const MARGIN_DEBUG = true; // set false to silence [MarginDebug] logs

function marginDebug(label: string, payload?: Record<string, unknown>): void {
  if (!MARGIN_DEBUG) return;
  if (payload) console.log(`[MarginDebug] ${label}`, payload);
  else console.log(`[MarginDebug] ${label}`);
}

function marginFailMessage(): string {
  return `Margin below ${MIN_MARGIN_PERCENT}%`;
}

/** Snapshot cost-related keys from vendor metadata for debug. */
function costFieldSnapshot(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const pricing = (meta.pricing || {}) as Record<string, unknown>;
  const costs =
    meta.costs && typeof meta.costs === 'object' && !Array.isArray(meta.costs)
      ? (meta.costs as Record<string, unknown>)
      : {};
  const pick = (obj: Record<string, unknown>, keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== '') out[k] = obj[k];
    }
    return out;
  };
  const keys = [
    'printing_and_mounting_cost',
    'printingAndMountingCost',
    'printing_cost',
    'mounting_cost',
    'fixing_cost',
    'production_cost',
    'pf_cost',
    'unit_cost',
    'total_cost',
    'total_unit_cost',
    'display_unit_cost_per_day',
    'display_cost',
  ];
  return {
    meta: pick(meta, keys),
    pricing: pick(pricing, keys),
    costs: Object.keys(costs).length ? costs : undefined,
  };
}

/** Build package margin input from floors + live qty/days/rates. */
export function buildPackageMarginInput(params: {
  floors: VendorEditFloors;
  quantity: number;
  durationDays: number;
  displayDailyRate: number;
  pfUnitRate: number;
}): PackageMarginInput {
  return {
    quantity: params.quantity,
    durationDays: params.durationDays,
    displayDailyRate: params.displayDailyRate,
    pfUnitRate: params.pfUnitRate,
    displayUnitCostPerDay: params.floors.displayUnitCostPerDay,
    pfUnitCost: params.floors.pfCostFloor,
  };
}

function checkPackageMargin(input: PackageMarginInput): ValidateQuoteEditResult {
  const cost = computePackageCost(input);
  const sell = computePackageSell(input);
  if (!(cost > 0)) {
    marginDebug('checkPackageMargin: cost unknown/0 → skip (ok)', { input, cost, sell });
    return { ok: true };
  }
  const ok = isPackageMarginOk(sell, cost);
  const marginPct = sell > 0 ? ((sell - cost) / sell) * 100 : null;
  marginDebug('checkPackageMargin', {
    cost,
    sell,
    marginPct,
    minPercent: MIN_MARGIN_PERCENT,
    ok,
  });
  if (!ok) {
    return { ok: false, message: marginFailMessage() };
  }
  return { ok: true };
}

/** True when this edit is on a P&F-only quote line (no live display rental). */
function isPfOnlyEditContext(
  floors: VendorEditFloors,
  packageContext?: { displayDailyRate: number; durationDays: number },
): boolean {
  if (!floors.hasDisplayPricing) return true;
  if (!packageContext) return false;
  return !(packageContext.displayDailyRate > 0 && packageContext.durationDays > 0);
}

/** P&F-only: enforce 4% margin vs vendor cost (not catalog selling price). */
function validatePfOnlyRate(params: {
  floors: VendorEditFloors;
  /** Edited component amount (or bundled P&F unit rate). */
  value: number;
  /** Full P&F unit rate after edit (sum of components or bundled). */
  pfUnitRate: number;
  label?: string;
}): ValidateQuoteEditResult {
  const { floors, value, pfUnitRate, label } = params;

  if (label) {
    const costForLabel = floors.pfComponentCostFloors[label];
    if (costForLabel != null && costForLabel > 0) {
      const minSell = minSellingForMargin(costForLabel);
      const blocked = value + 1e-9 < minSell;
      marginDebug('validatePfOnlyRate: component cost', {
        label,
        value,
        costForLabel,
        minSell,
        blocked,
      });
      if (blocked) {
        return { ok: false, message: marginFailMessage() };
      }
    } else {
      marginDebug('validatePfOnlyRate: no component cost for label', {
        label,
        pfComponentCostFloors: floors.pfComponentCostFloors,
      });
    }
  }

  if (floors.pfCostFloor != null && floors.pfCostFloor > 0) {
    const minSell = minSellingForMargin(floors.pfCostFloor);
    const blocked = pfUnitRate + 1e-9 < minSell;
    marginDebug('validatePfOnlyRate: pfCostFloor', {
      pfUnitRate,
      pfCostFloor: floors.pfCostFloor,
      minSell,
      blocked,
    });
    if (blocked) {
      return { ok: false, message: marginFailMessage() };
    }
    return { ok: true };
  }

  marginDebug('validatePfOnlyRate: NO pfCostFloor → allow edit', {
    value,
    pfUnitRate,
    pfPriceFloor: floors.pfPriceFloor,
    hasDisplayPricing: floors.hasDisplayPricing,
  });
  // Do NOT fall back to catalog selling (pfPriceFloor) — that locked edits at list
  // price (e.g. ₹999) even when cost+4% would allow a lower rate (~₹885 for cost 850).
  return { ok: true };
}

/**
 * Validate a single edit against vendor floors / package cost margin.
 * Margin uses DB unit costs vs live sell total:
 *   cost = display_unit_cost_per_day×qty×days + (printing+mounting)×qty
 *   sell = displayDaily×qty×days + pfUnit×qty
 *
 * Pass `packageContext` for display/P&F/qty/duration edits so package margin is checked.
 */
export function validateQuoteEdit(params: {
  field: QuoteEditField;
  value: number;
  floors: VendorEditFloors;
  rateUiMode?: RateUiMode;
  /** When set, rate/qty/duration edits also enforce package 4% margin. */
  packageContext?: {
    quantity: number;
    durationDays: number;
    displayDailyRate: number;
    pfUnitRate: number;
  };
}): ValidateQuoteEditResult {
  const { field, value, floors, rateUiMode = 'per_day', packageContext } = params;

  if (!Number.isFinite(value)) {
    return { ok: false, message: 'Enter a valid number' };
  }

  if (field === 'quantity') {
    if (value < 1) return { ok: false, message: 'Quantity must be at least 1' };
    if (floors.minQty != null && value < floors.minQty) {
      const unit = floors.qtyUnit ? ` ${floors.qtyUnit}` : '';
      return {
        ok: false,
        message: `Minimum quantity is ${floors.minQty}${unit}`,
      };
    }
    if (packageContext) {
      return checkPackageMargin(
        buildPackageMarginInput({
          floors,
          quantity: value,
          durationDays: packageContext.durationDays,
          displayDailyRate: packageContext.displayDailyRate,
          pfUnitRate: packageContext.pfUnitRate,
        }),
      );
    }
    return { ok: true };
  }

  if (field === 'duration') {
    if (value < 1) return { ok: false, message: 'Duration must be at least 1' };
    if (floors.minDuration != null && value < floors.minDuration) {
      const unit = floors.durationUnitLabel || 'days';
      return {
        ok: false,
        message: `Minimum duration is ${floors.minDuration} ${unit}`,
      };
    }
    if (packageContext) {
      return checkPackageMargin(
        buildPackageMarginInput({
          floors,
          quantity: packageContext.quantity,
          durationDays: value,
          displayDailyRate: packageContext.displayDailyRate,
          pfUnitRate: packageContext.pfUnitRate,
        }),
      );
    }
    return { ok: true };
  }

  if (field === 'displayRate') {
    if (value <= 0) return { ok: false, message: 'Rate must be greater than 0' };

    const dailyEquivalent =
      rateUiMode === 'per_month' ? value / DAYS_PER_MONTH : value;

    if (packageContext) {
      const pkg = buildPackageMarginInput({
        floors,
        quantity: packageContext.quantity,
        durationDays: packageContext.durationDays,
        displayDailyRate: dailyEquivalent,
        pfUnitRate: packageContext.pfUnitRate,
      });
      const cost = computePackageCost(pkg);
      if (cost > 0) {
        return checkPackageMargin(pkg);
      }
    }

    // Fallback: display unit cost only (package cost unknown)
    const costPerDay = floors.displayUnitCostPerDay;
    if (costPerDay == null || costPerDay <= 0) return { ok: true };
    const minSell = minSellingForMargin(costPerDay);
    if (dailyEquivalent + 1e-9 < minSell) {
      return { ok: false, message: marginFailMessage() };
    }
    return { ok: true };
  }

  // pfRate
  if (value <= 0) return { ok: false, message: 'Rate must be greater than 0' };

  if (packageContext) {
    const pkg = buildPackageMarginInput({
      floors,
      quantity: packageContext.quantity,
      durationDays: packageContext.durationDays,
      displayDailyRate: packageContext.displayDailyRate,
      pfUnitRate: value,
    });
    const cost = computePackageCost(pkg);
    if (cost > 0) {
      return checkPackageMargin(pkg);
    }
  }

  // Display+P&F services: P&F edits are free when package cost unknown
  if (!isPfOnlyEditContext(floors, packageContext)) {
    return { ok: true };
  }

  return validatePfOnlyRate({ floors, value, pfUnitRate: value });
}

/**
 * Validate one P&F component edit.
 * 1) Package margin when cost > 0
 * 2) P&F-only cost margin (block e.g. ₹200 when cost is ₹850)
 * 3) Display+P&F with unknown cost → allow (P&F free edit per product rule)
 */
export function validateOneTimeComponentEdit(params: {
  floors: VendorEditFloors;
  label: string;
  value: number;
  nextComponents?: { label: string; amount: number }[];
  packageContext?: {
    quantity: number;
    durationDays: number;
    displayDailyRate: number;
  };
}): ValidateQuoteEditResult {
  const { floors, label, value, nextComponents, packageContext } = params;

  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, message: 'Enter a valid number' };
  }

  const pfUnitRate = nextComponents
    ? nextComponents.reduce((s, c) => s + c.amount, 0)
    : value;

  const pfOnly = isPfOnlyEditContext(floors, packageContext);
  marginDebug('validateOneTimeComponentEdit: start', {
    label,
    value,
    pfUnitRate,
    nextComponents,
    packageContext,
    pfOnly,
    floors: {
      pfCostFloor: floors.pfCostFloor,
      pfPriceFloor: floors.pfPriceFloor,
      hasDisplayPricing: floors.hasDisplayPricing,
      displayUnitCostPerDay: floors.displayUnitCostPerDay,
      pfComponentCostFloors: floors.pfComponentCostFloors,
    },
  });

  if (packageContext && nextComponents) {
    const pkg = buildPackageMarginInput({
      floors,
      quantity: packageContext.quantity,
      durationDays: packageContext.durationDays,
      displayDailyRate: packageContext.displayDailyRate,
      pfUnitRate,
    });
    const cost = computePackageCost(pkg);
    marginDebug('validateOneTimeComponentEdit: package attempt', {
      pkg,
      packageCost: cost,
    });
    if (cost > 0) {
      const result = checkPackageMargin(pkg);
      marginDebug('validateOneTimeComponentEdit: package result', result as unknown as Record<string, unknown>);
      return result;
    }
  }

  if (!pfOnly) {
    marginDebug('validateOneTimeComponentEdit: display+P&F free P&F edit → allow');
    return { ok: true };
  }

  const result = validatePfOnlyRate({ floors, value, pfUnitRate, label });
  marginDebug('validateOneTimeComponentEdit: pf-only result', result as unknown as Record<string, unknown>);
  return result;
}

/** Infer display vs P&F from line description. */
export function rateFieldForLineDescription(description: string): 'displayRate' | 'pfRate' {
  return isOneTimeLineDescription(description) ? 'pfRate' : 'displayRate';
}

function roundRate(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function recalcItemTotal(item: QuoteItem): QuoteItem {
  return {
    ...item,
    total: computeQuoteItemTotal(item),
  };
}

/**
 * Scope for executive-summary / P&F edits.
 * Prefer serviceId+serviceName(+city) so Auto Full vs Auto Semi stay distinct even when
 * catalog service_id is missing or wrongly duplicated across medium types.
 */
function groupKey(item: QuoteItem): string {
  const sid = item.serviceId?.trim().toLowerCase() || '';
  const name = item.serviceName?.trim().toLowerCase() || '';
  const city = item.city?.trim().toLowerCase();
  const cityPart = city && city !== '—' ? city : '';

  if (sid && name) {
    return cityPart ? `${sid}|${cityPart}|${name}` : `${sid}|${name}`;
  }
  if (sid) {
    return cityPart ? `${sid}|${cityPart}` : sid;
  }
  if (name) {
    return cityPart ? `${cityPart}|${name}` : name;
  }
  return (item.description || item.id).toLowerCase();
}

/**
 * Normalize a recurring line to days + daily rate before applying edits.
 * Also repairs package rates that were left as monthly under durationUnit "days".
 */
function normalizeRecurringToDailyDays(
  item: QuoteItem,
  floors?: Pick<VendorEditFloors, 'displayPriceFloor' | 'displayPriceIsDaily'>,
): QuoteItem {
  if (isOneTimeLineDescription(item.description)) return item;

  let rate = item.rate;
  let duration = item.duration;
  let durationUnit = item.durationUnit;

  if (durationUnit === 'months' && duration != null && duration > 0) {
    rate = roundRate(rate / DAYS_PER_MONTH);
    duration = Math.round(duration * DAYS_PER_MONTH);
    durationUnit = 'days';
  }

  // Repair corrupted package: monthly display_price stored with durationUnit days
  if (
    durationUnit === 'days' &&
    floors &&
    floors.displayPriceIsDaily === false &&
    floors.displayPriceFloor != null &&
    floors.displayPriceFloor > 0 &&
    rate > 0
  ) {
    const monthFloor = floors.displayPriceFloor;
    if (Math.abs(rate - monthFloor) <= monthFloor * 0.02 + 0.01) {
      rate = roundRate(monthFloor / DAYS_PER_MONTH);
    }
  }

  return {
    ...item,
    rate,
    duration,
    durationUnit: durationUnit ?? item.durationUnit,
    durationLabel: durationUnit === 'days' ? 'day' : item.durationLabel,
  };
}

/**
 * Apply an executive-summary cell edit to all quote items in that service group.
 * Qty updates both Display + P&F; duration/recurring → Display only; one-time → P&F only.
 *
 * `value` is already in **storage units** (days for duration, daily rate for requiringCharge).
 * Recurring lines are normalized to daily/days first so month package rates are not double-counted.
 */
export function applyExecutiveSummaryFieldEdit(
  items: QuoteItem[],
  primaryItemId: string,
  field: 'quantity' | 'duration' | 'requiringCharge' | 'oneTimeCharge',
  value: number,
  floors?: Pick<VendorEditFloors, 'displayPriceFloor' | 'displayPriceIsDaily'>,
): QuoteItem[] {
  const primary = items.find((i) => i.id === primaryItemId);
  if (!primary) return items;
  const key = groupKey(primary);

  return items.map((item) => {
    if (groupKey(item) !== key) return item;

    const isOneTime = isOneTimeLineDescription(item.description);

    if (field === 'quantity') {
      // Normalize display lines so a qty edit also repairs corrupt month/day rates
      const base = isOneTime ? item : normalizeRecurringToDailyDays(item, floors);
      return recalcItemTotal({ ...base, quantity: value });
    }

    if (field === 'duration') {
      if (isOneTime) return item;
      const base = normalizeRecurringToDailyDays(item, floors);
      const days = Math.round(value);
      return recalcItemTotal({
        ...base,
        duration: days,
        durationUnit: 'days',
        durationLabel: 'day',
        durationIsAuto: false,
      });
    }

    if (field === 'requiringCharge') {
      if (isOneTime) return item;
      const base = normalizeRecurringToDailyDays(item, floors);
      return recalcItemTotal({ ...base, rate: roundRate(value) });
    }

    // oneTimeCharge
    if (!isOneTime) return item;
    // When primary is P&F-only, only patch that line (same as applyOneTimeComponentEdit)
    if (isOneTimeLineDescription(primary.description) && item.id !== primary.id) {
      return item;
    }
    return recalcItemTotal({ ...item, rate: roundRate(value), oneTimeComponents: undefined });
  });
}

/**
 * Update one named one-time add-on (Printing & Mounting, RTO, …) and recompute
 * the bundled P&F line rate as the sum of components.
 *
 * When the primary row is itself a P&F line (P&F-only services), update only that
 * item by id so Auto Full / Auto Semi never cross-update.
 * When primary is a Display line, update one-time siblings in the same groupKey.
 */
export function applyOneTimeComponentEdit(
  items: QuoteItem[],
  primaryItemId: string,
  components: { label: string; amount: number }[],
  editedLabel: string,
  newAmount: number,
): QuoteItem[] {
  const primary = items.find((i) => i.id === primaryItemId);
  if (!primary || components.length === 0) return items;

  const updatedComponents = components.map((c) =>
    c.label === editedLabel ? { ...c, amount: roundRate(Math.max(0, newAmount)) } : c,
  );
  const newSum = roundRate(updatedComponents.reduce((s, c) => s + c.amount, 0));

  const patchOneTime = (item: QuoteItem): QuoteItem =>
    recalcItemTotal({
      ...item,
      rate: newSum,
      oneTimeComponents: updatedComponents,
    });

  // P&F-only primary → pin to this line only (avoids shared serviceId collisions)
  if (isOneTimeLineDescription(primary.description)) {
    return items.map((item) => (item.id === primary.id ? patchOneTime(item) : item));
  }

  const key = groupKey(primary);
  return items.map((item) => {
    if (groupKey(item) !== key) return item;
    if (!isOneTimeLineDescription(item.description)) return item;
    return patchOneTime(item);
  });
}

/** Convert UI edit value to storage units based on executive-summary display mode. */
export function uiEditToStorageValue(
  field: 'duration' | 'requiringCharge',
  uiValue: number,
  row: { durationUnit?: 'months' | 'days'; ratePeriod?: 'per_day' | 'per_month' },
): number {
  if (field === 'duration') {
    if (row.durationUnit === 'months') {
      return Math.round(uiValue * DAYS_PER_MONTH);
    }
    return Math.round(uiValue);
  }
  // requiringCharge — always store daily when UI shows per month
  if (row.ratePeriod === 'per_month') {
    return uiValue / DAYS_PER_MONTH;
  }
  return uiValue;
}

/** Recalculate quote subtotal / GST / total after item edits. */
export function recalcQuoteTotals<T extends {
  items: QuoteItem[];
  gstEnabled: boolean;
  gstPercentage: number;
}>(quote: T): T & { subtotal: number; gstAmount: number; total: number; updatedAt: Date } {
  const subtotal = quote.items.reduce((sum, i) => sum + (i.total || 0), 0);
  const gstAmount = quote.gstEnabled ? subtotal * (quote.gstPercentage / 100) : 0;
  return {
    ...quote,
    subtotal,
    gstAmount,
    total: subtotal + gstAmount,
    updatedAt: new Date(),
  };
}
