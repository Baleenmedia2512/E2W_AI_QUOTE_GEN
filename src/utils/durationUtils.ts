/** Parse campaign length from user chat text (e.g. "6 months", "12 days"). */
export function parseDurationFromUserText(
  text: string,
): { value: number; unit: 'months' | 'days' } | null {
  const m = text.match(/(\d+)\s*(days?|months?|mos?\.?)/i);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  if (!Number.isFinite(value) || value < 1) return null;
  const unit = m[2].toLowerCase().startsWith('day') ? 'days' : 'months';
  return { value, unit };
}

export function userMentionedDuration(text: string): boolean {
  return parseDurationFromUserText(text) !== null;
}

/**
 * DB metadata for duration.
 * Source of truth: vendor top-level `min_days` only.
 * Do not use duration_measurement_unit or pricing.display_period for billing.
 * `min_duration` is legacy read-only fallback while old rows migrate.
 */
export interface DbMetadataLike {
  duration?: string;
  medium?: string;
  /** Vendor-level minimum campaign days (preferred). */
  min_days?: number | string;
  /** @deprecated Prefer min_days — legacy alias only. */
  min_duration?: number | string;
  /** @deprecated Unused for billing — display prices are always day-wise. */
  duration_measurement_unit?: string;
  pricing?: {
    period?: string;
    display_period?: string;
    unit?: string;
    structure?: string;
    min_days?: number | string;
    min_duration?: number | string;
    duration_measurement_unit?: string;
  };
}

/** Read vendor min campaign days (min_days, else legacy min_duration). Never from pricing.*. */
export function vendorMinDays(metadata: DbMetadataLike | undefined | null): number {
  const raw = metadata?.min_days ?? metadata?.min_duration;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** Mobile Van (LED / Non LED) — kept for name heuristics elsewhere. */
export function isMobileVanService(
  serviceName?: string | null,
  metadata?: DbMetadataLike | null,
): boolean {
  const blob = [serviceName || '', metadata?.medium || '', metadata?.duration || '']
    .join(' ')
    .toLowerCase();
  return /mobile\s*van/.test(blob);
}

/**
 * All vendor display_price values are day-wise.
 * Always multiply: qty × display_price × days.
 * Does not use duration_measurement_unit or display_period.
 */
export function isVendorDailyDisplayRate(
  _metadata?: DbMetadataLike | null,
  _serviceName?: string | null,
): boolean {
  return true;
}

/**
 * Default Duration column from DB = min_days (always stored/billed as days).
 */
export function parseDurationFromDbMetadata(
  metadata: DbMetadataLike | undefined | null,
  _serviceName?: string | null,
): { value: number; unit: 'months' | 'days' } | null {
  if (!metadata) return null;
  const days = vendorMinDays(metadata);
  if (!Number.isFinite(days) || days <= 0) return null;
  return { value: days, unit: 'days' };
}

/** One-time charges (printing, fixing, etc.) — never show campaign duration. */
export function isOneTimeLineDescription(description: string): boolean {
  const d = description.toLowerCase();
  return /\b(printing|fixing|installation|mounting|pasting|design|artwork|creative)\b/i.test(d)
    && !/\bper\s+(month|day)\b/i.test(d);
}

/** Recurring / campaign-priced lines (rental, display per month/day). */
export function isRecurringLineDescription(description: string): boolean {
  if (isOneTimeLineDescription(description)) return false;
  const d = description.toLowerCase();
  return /per\s+\w*\s*month|per\s+day|\/\s*month|per frame month|per bus month|per auto month|daily rate|\brental\b|\bdisplay price\b/i.test(d);
}

export interface GeminiLineDurationInput {
  duration?: number;
  durationUnit?: 'months' | 'days';
  description?: string;
}

function isRecurringLine(
  description: string,
  dbMetadata?: DbMetadataLike | null,
  serviceName?: string | null,
): boolean {
  if (isOneTimeLineDescription(description)) return false;
  if (isRecurringLineDescription(description)) return true;
  return parseDurationFromDbMetadata(dbMetadata, serviceName || description) != null;
}

/**
 * Resolve display duration + pricing multiplier for a quote line.
 * Priority: user chat > DB min_days (auto) > none.
 * Display prices are always daily: qty × rate × days.
 * - One-time (P&F): multiplier 1
 */
export function resolveQuoteLineDuration(
  geminiLine: GeminiLineDurationInput,
  userMessage: string,
  dbMetadata?: DbMetadataLike | null,
  serviceName?: string | null,
): { duration?: number; durationUnit?: 'months' | 'days'; multiplier: number; isAutoFromDb?: boolean } {
  const userDur = parseDurationFromUserText(userMessage);
  const desc = geminiLine.description || '';
  const nameHint = serviceName || desc;
  const dbDur = parseDurationFromDbMetadata(dbMetadata, nameHint);

  if (isOneTimeLineDescription(desc)) {
    return { multiplier: 1 };
  }

  if (!isRecurringLine(desc, dbMetadata, nameHint)) {
    return { multiplier: 1 };
  }

  // Always day-wise billing from DB / user
  const userAskedDays = userDur?.unit === 'days';
  const userAskedMonths = userDur?.unit === 'months';

  if (userAskedDays) {
    const value =
      geminiLine.duration != null && geminiLine.duration >= 1
        ? geminiLine.duration
        : userDur!.value;
    return { duration: value, durationUnit: 'days', multiplier: value };
  }

  if (userAskedMonths) {
    const months = userDur!.value;
    const blockDays =
      dbDur?.unit === 'days' && dbDur.value > 0 ? dbDur.value : DAYS_PER_MONTH;
    // "2 months" with min_days=30 → 60 days; with min_days=15 → 30 days (2× block)
    const days = months * blockDays;
    return { duration: days, durationUnit: 'days', multiplier: days };
  }

  if (dbDur) {
    return {
      duration: dbDur.value,
      durationUnit: 'days',
      multiplier: dbDur.value,
      isAutoFromDb: true,
    };
  }

  return { multiplier: 1 };
}

/** Multiplier for qty × rate × duration (display months/days). */
export function lineItemPricingMultiplier(item: {
  duration?: number;
  durationIsAuto?: boolean;
}): number {
  if (item.duration == null || item.duration <= 0) return 1;
  return item.duration;
}

/**
 * Recurring line total aligned with the pricing-breakdown formula.
 * Exact ×30-day campaigns show a rounded monthly rate — use that for the amount
 * so ₹14,000 × 10 × 1 month = ₹1,40,000 (not a daily×days off-by-one).
 * Non-month campaigns stay qty × daily × days.
 */
export function computeRecurringLineTotal(
  quantity: number,
  dailyRate: number,
  durationDays: number | undefined | null,
): number {
  const qty = Number.isFinite(quantity) ? quantity : 0;
  const rate = Number.isFinite(dailyRate) ? dailyRate : 0;
  if (durationDays == null || !Number.isFinite(durationDays) || durationDays <= 0) {
    return qty * rate;
  }
  if (shouldDisplayAsMonths(durationDays)) {
    const months = durationDays / DAYS_PER_MONTH;
    const perMonth = Math.round(rate * DAYS_PER_MONTH);
    return qty * perMonth * months;
  }
  return qty * rate * durationDays;
}

/**
 * Line total from stored quote fields (daily or legacy monthly rate + duration).
 * One-time / no-duration lines: qty × rate.
 */
export function computeQuoteItemTotal(item: {
  quantity: number;
  oneTimeQuantity?: number;
  rate?: number;
  unitPrice?: number;
  duration?: number;
  durationUnit?: 'months' | 'days' | string | null;
  description?: string;
}): number {
  const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
  const oneTimeQty = Number.isFinite(item.oneTimeQuantity) ? (item.oneTimeQuantity ?? 0) : qty;
  const rawRate = item.rate ?? item.unitPrice ?? 0;
  const rate = Number.isFinite(rawRate) ? rawRate : 0;

  if (item.description && isOneTimeLineDescription(item.description)) {
    return oneTimeQty * rate;
  }

  const days = toCampaignDays(item.duration, item.durationUnit);
  if (days == null || days <= 0) {
    return qty * rate;
  }

  const daily = toDailyRate(rate, item.durationUnit);
  return computeRecurringLineTotal(qty, daily, days);
}

/** @deprecated use lineItemPricingMultiplier */
export function durationMultiplier(item: { duration?: number; durationIsAuto?: boolean }): number {
  return lineItemPricingMultiplier(item);
}

/** Pricing multiplier: duration scales total when present. */
export function pricingDurationMultiplier(
  item: { duration?: number },
  _userMessage: string,
): number {
  if (item.duration == null || item.duration <= 0) return 1;
  return item.duration;
}

export function shouldShowDuration(item: { duration?: number }): boolean {
  return item.duration != null && item.duration > 0;
}

/** Billing convention: 1 month = 30 days everywhere in UI / PDF. */
export const DAYS_PER_MONTH = 30;

/**
 * Show months only when campaign days are an exact multiple of 30 (30→1, 60→2).
 * 34 / 45 days stay day-wise (not 1.13 / 1.5 months).
 */
export function shouldDisplayAsMonths(durationDays: number | undefined | null): boolean {
  if (durationDays == null || !Number.isFinite(durationDays) || durationDays < DAYS_PER_MONTH) {
    return false;
  }
  return durationDays % DAYS_PER_MONTH === 0;
}

/** UI duration value + unit from stored campaign days. */
export function toDisplayDuration(durationDays: number): {
  value: number;
  unit: 'months' | 'days';
  label: string;
} {
  if (shouldDisplayAsMonths(durationDays)) {
    const months = durationDays / DAYS_PER_MONTH;
    return {
      value: months,
      unit: 'months',
      label: months === 1 ? 'month' : 'months',
    };
  }
  return {
    value: durationDays,
    unit: 'days',
    label: durationDays === 1 ? 'day' : 'days',
  };
}

/** UI recurring rate: monthly (= daily × 30) only when duration shows as months.
 * Monthly display is rounded to the nearest rupee (1699.8 → 1700).
 * One-time charges are not handled here.
 */
export function toDisplayRecurringRate(
  dailyRate: number,
  durationDays: number | undefined | null,
): { rate: number; period: 'per_day' | 'per_month' } {
  if (shouldDisplayAsMonths(durationDays)) {
    return {
      rate: Math.round(dailyRate * DAYS_PER_MONTH),
      period: 'per_month',
    };
  }
  return { rate: dailyRate, period: 'per_day' };
}

/** Convert stored rate to daily when item was saved with month unit. */
export function toDailyRate(
  rate: number,
  durationUnit?: 'months' | 'days' | string | null,
): number {
  if (durationUnit === 'months') {
    return rate / DAYS_PER_MONTH;
  }
  return rate;
}

/** Campaign length in days from a quote line / exec row. */
export function toCampaignDays(
  duration: number | undefined | null,
  durationUnit?: 'months' | 'days' | string | null,
): number | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  if (durationUnit === 'months') return duration * DAYS_PER_MONTH;
  return duration;
}

export function campaignDays(row: {
  duration?: number;
  durationUnit?: 'months' | 'days';
  durationDays?: number;
}): number {
  if (row.durationDays != null && Number.isFinite(row.durationDays)) {
    return row.durationDays;
  }
  return toCampaignDays(row.duration, row.durationUnit) ?? 0;
}

/**
 * Convert month-based duration/rate on a quote line to day-based storage.
 * Leaves already-day items unchanged (sets durationUnit to 'days' when duration present).
 */
export function normalizeDurationToDays<T extends {
  duration?: number;
  durationUnit?: 'months' | 'days' | string | null;
  durationLabel?: string;
  unitPrice?: number;
  rate?: number;
}>(item: T): T {
  if (item.duration == null || !Number.isFinite(item.duration) || item.duration <= 0) {
    return item;
  }
  if (item.durationUnit === 'months') {
    const days = item.duration * DAYS_PER_MONTH;
    const next: T = {
      ...item,
      duration: days,
      durationUnit: 'days',
      durationLabel: 'day',
    };
    if (typeof item.unitPrice === 'number') {
      next.unitPrice = toDailyRate(item.unitPrice, 'months');
    }
    if (typeof item.rate === 'number') {
      next.rate = toDailyRate(item.rate, 'months');
    }
    return next;
  }
  return {
    ...item,
    durationUnit: 'days',
    durationLabel: item.durationLabel || (item.duration === 1 ? 'day' : 'days'),
  };
}

/** True when any quote item (or nested line) has a campaign duration. */
export function quoteHasAnyDuration(
  items: Array<{
    duration?: number;
    lineItems?: Array<{ duration?: number }>;
  }>,
): boolean {
  return items.some((item) => {
    if (item.duration != null && item.duration > 0) return true;
    return item.lineItems?.some((li) => li.duration != null && li.duration > 0) ?? false;
  });
}

/**
 * After DB quote build, ensure recurring lines have duration from min_days when missing.
 */
export function enrichQuoteItemsDurationFromDb<T extends {
  description: string;
  duration?: number;
  durationUnit?: 'months' | 'days';
  durationIsAuto?: boolean;
  serviceId?: string;
  serviceName?: string;
  rate: number;
  quantity: number;
  total: number;
}>(
  items: T[],
  userMessage: string,
  services: Array<{ service_id: string; service_name?: string; metadata?: DbMetadataLike }>,
): T[] {
  return items.map((item) => {
    if (isOneTimeLineDescription(item.description)) return item;
    if (item.duration != null && item.duration > 0) return item;

    const svc =
      (item.serviceId && services.find((s) => s.service_id === item.serviceId)) ||
      services.find(
        (s) =>
          (s.service_name || '').toLowerCase() ===
          (item.serviceName || '').toLowerCase(),
      );
    if (!svc?.metadata) return item;

    const resolved = resolveQuoteLineDuration(
      { description: item.description, duration: item.duration, durationUnit: item.durationUnit },
      userMessage,
      svc.metadata,
      item.serviceName || svc.service_name,
    );
    if (!resolved.duration || resolved.duration <= 0) return item;

    const next = {
      ...item,
      duration: resolved.duration,
      durationUnit: 'days' as const,
      durationIsAuto: resolved.isAutoFromDb,
    };
    return {
      ...next,
      total: computeQuoteItemTotal(next),
    };
  });
}
