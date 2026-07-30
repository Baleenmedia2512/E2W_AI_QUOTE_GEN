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

/** DB metadata shape for duration (vendor top-level min_duration preferred). */
export interface DbMetadataLike {
  duration?: string;
  medium?: string;
  /** Vendor-level only — never use pricing.min_duration */
  min_duration?: number | string;
  /** Vendor-level only — never use pricing.duration_measurement_unit */
  duration_measurement_unit?: string;
  pricing?: {
    period?: string;
    display_period?: string;
    unit?: string;
    structure?: string;
    min_duration?: number | string;
    duration_measurement_unit?: string;
  };
}

const MONTH_DAY_PACKAGE_MIN = 28;
const MONTH_DAY_PACKAGE_MAX = 31;

function vendorMinDuration(metadata: DbMetadataLike | undefined | null): number {
  const md = Number(metadata?.min_duration);
  return Number.isFinite(md) && md > 0 ? md : NaN;
}

function vendorDurationUnit(metadata: DbMetadataLike | undefined | null): string {
  return String(metadata?.duration_measurement_unit || '').trim().toLowerCase();
}

/** Mobile Van (LED / Non LED) — daily display even when min_duration is 30. */
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
 * True when display_price is a per-day unit rate (multiply by days).
 * False for period packages like Apartment Lift (min_duration ≈ 30 days = 1 month bill).
 * Exception: Mobile Van is always daily when duration unit is days (even min=30).
 * Duration fields: vendor top-level only (never pricing.min_duration).
 */
export function isVendorDailyDisplayRate(
  metadata: DbMetadataLike | undefined | null,
  serviceName?: string | null,
): boolean {
  if (!metadata) return false;
  const du = vendorDurationUnit(metadata);
  const md = vendorMinDuration(metadata);

  // Long-term rule: explicit vendor day unit means day-wise billing.
  // This avoids legacy 30-day package heuristics when DB has been migrated.
  if (du.startsWith('day') && Number.isFinite(md) && md > 0) {
    return true;
  }

  const p = metadata.pricing || {};
  const periodHint = [p.display_period, p.period, p.unit]
    .filter((x) => x != null && String(x).trim() !== '' && String(x).trim().toUpperCase() !== 'NA')
    .join(' ')
    .toLowerCase();

  if (/per\s*day|\/\s*days?|daily\b/i.test(periodHint)) return true;
  if (/per\s*\w*\s*month|\/\s*month|monthly/i.test(periodHint)) {
    // Mobile Van overrides "per month" label if unit is still days in DB
    if (!isMobileVanService(serviceName, metadata)) return false;
  }
  if (!du.startsWith('day')) return false;
  if (!Number.isFinite(md) || md <= 0) return false;

  // Mobile Van: display × min_duration days (e.g. 3167 × 30) — do not collapse to 1 month
  if (isMobileVanService(serviceName, metadata)) return true;

  // Full-month package in days (28–31) → period price, NOT daily (Apartment Lift, etc.)
  if (md >= MONTH_DAY_PACKAGE_MIN && md <= MONTH_DAY_PACKAGE_MAX) return false;

  // Short min duration in days (e.g. LED Hoardings 10) → daily unit rate
  return md < MONTH_DAY_PACKAGE_MIN;
}

/** Days to bill for a daily display rate = vendor min_duration (top-level only). */
function dailyRateDurationDays(
  metadata: DbMetadataLike,
): number {
  const md = vendorMinDuration(metadata);
  if (Number.isFinite(md) && md > 0) return md;
  return 1;
}

/**
 * Parse rate/campaign period from DB metadata (e.g. "1 month", "30 days", "per month").
 * Used as default Duration column when the user did not type a campaign length.
 * Duration: vendor top-level min_duration only (never pricing.min_duration).
 */
export function parseDurationFromDbMetadata(
  metadata: DbMetadataLike | undefined | null,
  serviceName?: string | null,
): { value: number; unit: 'months' | 'days' } | null {
  if (!metadata) return null;
  const du = vendorDurationUnit(metadata);
  const md = vendorMinDuration(metadata);

  // Long-term rule: when vendor explicitly sets day unit, keep days as-is.
  if (du.startsWith('day') && Number.isFinite(md) && md > 0) {
    return { value: md, unit: 'days' };
  }

  // Daily display rate → Duration = vendor min_duration days
  if (isVendorDailyDisplayRate(metadata, serviceName)) {
    return { value: dailyRateDurationDays(metadata), unit: 'days' };
  }

  const pricing = metadata.pricing || {};
  const durationRaw = String(metadata.duration || '').trim();
  const minDur = metadata.min_duration;
  const durUnit = metadata.duration_measurement_unit;
  const vendorPeriod =
    minDur != null &&
    String(minDur).trim() !== '' &&
    durUnit &&
    String(durUnit).trim().toUpperCase() !== 'NA'
      ? `${minDur} ${durUnit}`
      : '';
  const periodStr = [
    durationRaw,
    vendorPeriod,
    pricing.period,
    pricing.display_period,
    pricing.unit,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!periodStr) return null;

  const isPerDay = /per\s*day|\/\s*day|daily\b|per van day/i.test(periodStr);
  const isPerMonth = /per\s*\w*\s*month|\/\s*month|monthly|per frame month|per bus month/i.test(periodStr);

  const m = periodStr.match(/(\d+)\s*(days?|months?)/i);
  if (m) {
    const value = parseInt(m[1], 10);
    const unit = m[2].toLowerCase().startsWith('day') ? 'days' as const : 'months' as const;
    // "30 days" campaign package = one billing month (unit rate is NOT × days)
    if (unit === 'days' && value >= MONTH_DAY_PACKAGE_MIN && value <= MONTH_DAY_PACKAGE_MAX && (isPerMonth || !isPerDay)) {
      return { value: 1, unit: 'months' };
    }
    // Longer day mins with monthly rate (e.g. 90 days) → bill N months
    if (unit === 'days' && value > MONTH_DAY_PACKAGE_MAX && (isPerMonth || !isPerDay)) {
      const months = Math.max(1, Math.round(value / 30));
      return { value: months, unit: 'months' };
    }
    if (unit === 'days' && isPerDay) {
      return { value: 1, unit: 'days' };
    }
    if (unit === 'months') {
      return { value, unit: 'months' };
    }
    return { value, unit };
  }

  if (isPerDay) return { value: 1, unit: 'days' };
  if (isPerMonth) return { value: 1, unit: 'months' };

  return null;
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
 * Priority: user chat > DB metadata (auto) > none.
 * - Monthly rates: qty × rate × months (e.g. 10 × 16200 × 3)
 * - Daily rates: qty × rate × days (Mobile Van / short min days)
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
  const dailyRate = isVendorDailyDisplayRate(dbMetadata, nameHint);
  const dbDur = parseDurationFromDbMetadata(dbMetadata, nameHint);

  if (isOneTimeLineDescription(desc)) {
    return { multiplier: 1 };
  }

  if (!isRecurringLine(desc, dbMetadata, nameHint)) {
    return { multiplier: 1 };
  }

  // Daily rates: prefer DB min_duration days over a vague "1 month" in chat,
  // unless the user explicitly asked for days (or months > 1).
  if (dailyRate && dbDur?.unit === 'days') {
    const userAskedDays = userDur?.unit === 'days';
    const userAskedMultiMonth =
      userDur?.unit === 'months' && (userDur.value ?? 0) > 1;

    if (userAskedDays) {
      const value =
        geminiLine.duration != null && geminiLine.duration >= 1
          ? geminiLine.duration
          : userDur!.value;
      return { duration: value, durationUnit: 'days', multiplier: value };
    }
    if (userAskedMultiMonth) {
      const months = userDur!.value;
      const days = months * dbDur.value; // e.g. 2 × 30-day blocks
      return { duration: days, durationUnit: 'days', multiplier: days };
    }

    // Default / "1 month" in chat → use DB min days (Mobile Van 30, Hoardings 10)
    return {
      duration: dbDur.value,
      durationUnit: 'days',
      multiplier: dbDur.value,
      isAutoFromDb: true,
    };
  }

  if (userDur) {
    const value =
      geminiLine.duration != null && geminiLine.duration >= 1
        ? geminiLine.duration
        : userDur.value;
    const unit = geminiLine.durationUnit || userDur.unit;
    return { duration: value, durationUnit: unit, multiplier: value };
  }

  if (dbDur) {
    // Monthly / period rates: amount = qty × rate × duration months
    return {
      duration: dbDur.value,
      durationUnit: dbDur.unit,
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

/** UI recurring rate: monthly (= daily × 30) only when duration shows as months. */
export function toDisplayRecurringRate(
  dailyRate: number,
  durationDays: number | undefined | null,
): { rate: number; period: 'per_month' | 'per_day' } {
  if (shouldDisplayAsMonths(durationDays)) {
    return {
      rate: Math.round(dailyRate * DAYS_PER_MONTH * 100) / 100,
      period: 'per_month',
    };
  }
  return {
    rate: Math.round(dailyRate * 100) / 100,
    period: 'per_day',
  };
}

/**
 * Campaign length in days (1 month → 30).
 * Returns undefined when duration is missing / not positive.
 */
export function toCampaignDays(
  duration?: number,
  durationUnit?: 'months' | 'days',
): number | undefined {
  if (duration == null || duration <= 0) return undefined;
  if (durationUnit === 'days') return duration;
  // months (or legacy unspecified with a duration value)
  return duration * DAYS_PER_MONTH;
}

/**
 * Unit rate as a per-day amount when the stored rate is monthly.
 * Daily / one-time rates are returned unchanged.
 */
export function toDailyRate(
  rate: number,
  durationUnit?: 'months' | 'days',
): number {
  if (!Number.isFinite(rate)) return 0;
  if (durationUnit === 'months') return rate / DAYS_PER_MONTH;
  return rate;
}

/**
 * Convert a stored months-based line to days + daily rate (totals unchanged).
 * No-op when already days or when there is no duration.
 */
export function normalizeDurationToDays<T extends {
  duration?: number;
  durationUnit?: 'months' | 'days';
  durationLabel?: string;
  rate?: number;
  unitPrice?: number;
}>(item: T): T {
  if (item.durationUnit !== 'months' || item.duration == null || item.duration <= 0) {
    return item;
  }
  const days = item.duration * DAYS_PER_MONTH;
  const next: T = {
    ...item,
    duration: days,
    durationUnit: 'days',
    durationLabel: 'day',
  };
  if (typeof item.rate === 'number') {
    next.rate = item.rate / DAYS_PER_MONTH;
  }
  if (typeof item.unitPrice === 'number') {
    next.unitPrice = item.unitPrice / DAYS_PER_MONTH;
  }
  return next;
}

export function formatDurationLabel(item: {
  duration?: number;
  durationUnit?: 'months' | 'days';
}): string {
  if (!shouldShowDuration(item)) return '—';
  const days = toCampaignDays(item.duration, item.durationUnit);
  return days != null ? `${days} day` : '—';
}

export function quoteHasAnyDuration(items: Array<{ duration?: number }>): boolean {
  return items.some(shouldShowDuration);
}

/** Fill duration from DB for quote lines that don't have it yet (after service_id attach). */
export function enrichQuoteItemsDurationFromDb<T extends {
  description: string;
  duration?: number;
  durationUnit?: 'months' | 'days';
  quantity: number;
  rate: number;
  total: number;
  serviceId?: string;
  serviceName?: string;
  durationIsAuto?: boolean;
}>(
  items: T[],
  userMessage: string,
  dbServices: Array<{ service_id: string; metadata?: DbMetadataLike }>,
): T[] {
  return items.map((item) => {
    if (shouldShowDuration(item)) return item;

    const meta = item.serviceId
      ? dbServices.find((s) => s.service_id === item.serviceId)?.metadata
      : undefined;

    const resolved = resolveQuoteLineDuration(
      {
        description: item.description,
        duration: item.duration,
        durationUnit: item.durationUnit,
      },
      userMessage,
      meta,
      item.serviceName || item.description,
    );

    if (!resolved.duration) return item;

    return {
      ...item,
      duration: resolved.duration,
      durationUnit: resolved.durationUnit,
      durationIsAuto: resolved.isAutoFromDb,
      total: item.quantity * item.rate * resolved.multiplier,
    };
  });
}
