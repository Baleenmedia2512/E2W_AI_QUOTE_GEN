/**
 * Validate quote edits against vendor floors (no floors stored on quote items).
 * Qty / duration: vendor top-level only (never pricing.min_qty / min_duration).
 * Rates: pricing.display_price and P&F price fields only.
 *
 * Display rate floor unit follows isVendorDailyDisplayRate:
 * - daily vendor → display_price is per day
 * - package / monthly vendor → display_price is per month (do not ×30)
 */

import {
  getVendorRatesCache,
  vendorRatesToDbServices,
} from '../services/vendorRateService';
import { getMinQuantityFromDbService } from './cloudQuoteValidation';
import { readDbPrice } from './dbPricingUtils';
import {
  isOneTimeLineDescription,
  isVendorDailyDisplayRate,
  DAYS_PER_MONTH,
  lineItemPricingMultiplier,
  type DbMetadataLike,
} from './durationUtils';
import type { DbService } from './serviceResolver';
import { resolveServiceIdFromCatalog } from './serviceResolver';
import type { QuoteItem } from '../types/quote';

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
  /** Raw pricing.display_price (daily or monthly per displayPriceIsDaily). */
  displayPriceFloor: number | null;
  /** True when display_price is a per-day unit rate. */
  displayPriceIsDaily: boolean;
  pfPriceFloor: number | null;
  qtyUnit?: string;
  durationUnitLabel?: string;
}

export interface ValidateQuoteEditResult {
  ok: boolean;
  message?: string;
}

/** P&F floor = printing/mounting/production (+ add-ons), same as quote build. */
export function getPfPriceFloorFromPricing(pricing: Record<string, unknown> | undefined): number | null {
  if (!pricing) return null;
  const pf = readDbPrice(
    pricing.printing_and_mounting_price,
    pricing.printing_price,
    pricing.mounting_price,
    pricing.production_price,
    pricing.printing_and_fixing_price,
  );
  const official = readDbPrice(pricing.official_and_incidental_price);
  const rto = readDbPrice(pricing.rto_price);
  const freight = readDbPrice(pricing.freight_price);
  const recce = readDbPrice(pricing.recce_price);
  const total = pf + official + rto + freight + recce;
  return total > 0 ? total : null;
}

export function getVendorEditFloors(svc: DbService): VendorEditFloors {
  const m = (svc.metadata || {}) as Record<string, unknown>;
  const pricing = (m.pricing || {}) as Record<string, unknown>;

  const minQty = getMinQuantityFromDbService(svc);

  let minDuration: number | null = null;
  const mdRaw = m.min_duration;
  if (!isNaLike(mdRaw)) {
    const n = Number(mdRaw);
    if (Number.isFinite(n) && n > 0) minDuration = n;
  }

  const displayRaw = readDbPrice(pricing.display_price);
  const displayPriceFloor = displayRaw > 0 ? displayRaw : null;
  const pfPriceFloor = getPfPriceFloorFromPricing(pricing);
  const displayPriceIsDaily = isVendorDailyDisplayRate(
    svc.metadata as DbMetadataLike,
    svc.service_name,
  );

  const qtyUnit = !isNaLike(m.qty_measurement_unit)
    ? String(m.qty_measurement_unit).trim().replace(/^per\s+/i, '')
    : undefined;
  const durationUnitLabel = !isNaLike(m.duration_measurement_unit)
    ? String(m.duration_measurement_unit).trim()
    : undefined;

  return {
    minQty,
    minDuration,
    displayPriceFloor,
    displayPriceIsDaily,
    pfPriceFloor,
    qtyUnit,
    durationUnitLabel,
  };
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

  if (!catalog.length) return null;

  if (item.serviceId?.trim()) {
    const id = item.serviceId.trim().toLowerCase();
    const byId = catalog.find((s) => s.service_id.toLowerCase() === id);
    if (byId) return byId;
  }

  const lookupName = item.serviceName || item.description || '';
  const cityHint = item.city?.trim() && item.city !== '—' ? item.city.toLowerCase() : undefined;
  const resolved = resolveServiceIdFromCatalog(lookupName, catalog, cityHint);
  if (!resolved) return null;
  return catalog.find((s) => s.service_id === resolved.serviceId) || null;
}

/**
 * Validate a single edit against vendor floors.
 * displayRate: UI value; compared in the same unit as vendor display_price
 * (daily vs monthly package via displayPriceIsDaily).
 */
export function validateQuoteEdit(params: {
  field: QuoteEditField;
  value: number;
  floors: VendorEditFloors;
  rateUiMode?: RateUiMode;
}): ValidateQuoteEditResult {
  const { field, value, floors, rateUiMode = 'per_day' } = params;

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
    return { ok: true };
  }

  if (field === 'displayRate') {
    if (value <= 0) return { ok: false, message: 'Rate must be greater than 0' };
    if (floors.displayPriceFloor == null) return { ok: true };

    const floor = floors.displayPriceFloor;

    if (floors.displayPriceIsDaily) {
      const dailyEquivalent =
        rateUiMode === 'per_month' ? value / DAYS_PER_MONTH : value;

      if (dailyEquivalent + 1e-9 < floor) {
        if (rateUiMode === 'per_month') {
          const monthFloor = Math.round(floor * DAYS_PER_MONTH * 100) / 100;
          return {
            ok: false,
            message: `Rate cannot be below ₹${monthFloor.toLocaleString('en-IN')} per month`,
          };
        }
        return {
          ok: false,
          message: `Rate cannot be below ₹${floor.toLocaleString('en-IN')} per day`,
        };
      }
      return { ok: true };
    }

    // Package / monthly display_price — compare in month units
    const monthEquivalent =
      rateUiMode === 'per_month' ? value : value * DAYS_PER_MONTH;

    if (monthEquivalent + 1e-9 < floor) {
      if (rateUiMode === 'per_month') {
        return {
          ok: false,
          message: `Rate cannot be below ₹${floor.toLocaleString('en-IN')} per month`,
        };
      }
      const dayFloor = Math.round((floor / DAYS_PER_MONTH) * 100) / 100;
      return {
        ok: false,
        message: `Rate cannot be below ₹${dayFloor.toLocaleString('en-IN')} per day`,
      };
    }
    return { ok: true };
  }

  // pfRate
  if (value <= 0) return { ok: false, message: 'Rate must be greater than 0' };
  if (floors.pfPriceFloor != null && value + 1e-9 < floors.pfPriceFloor) {
    const unit = floors.qtyUnit ? ` per ${floors.qtyUnit}` : '';
    return {
      ok: false,
      message: `Rate cannot be below ₹${floors.pfPriceFloor.toLocaleString('en-IN')}${unit}`,
    };
  }
  return { ok: true };
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
  const mult = lineItemPricingMultiplier(item);
  return {
    ...item,
    total: item.quantity * item.rate * mult,
  };
}

function groupKey(item: QuoteItem): string {
  if (item.serviceId?.trim()) return item.serviceId.trim().toLowerCase();
  return (item.serviceName || item.description || item.id).toLowerCase();
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
    return recalcItemTotal({ ...item, rate: roundRate(value) });
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
