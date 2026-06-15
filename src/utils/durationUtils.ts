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

/** DB metadata shape for duration / pricing period (proposal_chunks.metadata). */
export interface DbMetadataLike {
  duration?: string;
  pricing?: {
    period?: string;
    display_period?: string;
    unit?: string;
    structure?: string;
  };
}

/**
 * Parse rate/campaign period from DB metadata (e.g. "1 month", "30 days", "per month").
 * Used as default Duration column when the user did not type a campaign length.
 */
export function parseDurationFromDbMetadata(
  metadata: DbMetadataLike | undefined | null,
): { value: number; unit: 'months' | 'days' } | null {
  if (!metadata) return null;

  const pricing = metadata.pricing || {};
  const durationRaw = String(metadata.duration || '').trim();
  const periodStr = [durationRaw, pricing.period, pricing.display_period, pricing.unit]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!periodStr) return null;

  const isPerDay = /per\s*day|\/\s*day|daily\b|per van day/i.test(periodStr);
  const isPerMonth = /per\s*\w*\s*month|\/\s*month|monthly|per frame month|per bus month/i.test(periodStr);

  const m = durationRaw.match(/(\d+)\s*(days?|months?)/i);
  if (m) {
    const value = parseInt(m[1], 10);
    const unit = m[2].toLowerCase().startsWith('day') ? 'days' as const : 'months' as const;
    // "30 days" on a monthly/campaign package = one billing period (1 Mo), not ×30
    if (unit === 'days' && value >= 28 && (isPerMonth || !isPerDay)) {
      return { value: 1, unit: 'months' };
    }
    if (unit === 'days' && isPerDay) {
      return { value: 1, unit: 'days' };
    }
    return { value, unit };
  }

  if (isPerDay) return { value: 1, unit: 'days' };
  if (isPerMonth) return { value: 1, unit: 'months' };
  if (/30\s*days?/.test(periodStr)) return { value: 1, unit: 'months' };

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
): boolean {
  if (isOneTimeLineDescription(description)) return false;
  if (isRecurringLineDescription(description)) return true;
  return parseDurationFromDbMetadata(dbMetadata) != null;
}

/**
 * Resolve display duration + pricing multiplier for a quote line.
 * Priority: user chat > DB metadata (auto) > none.
 * Auto-fill from DB uses multiplier 1 (one billing period); user-requested duration multiplies the total.
 */
export function resolveQuoteLineDuration(
  geminiLine: GeminiLineDurationInput,
  userMessage: string,
  dbMetadata?: DbMetadataLike | null,
): { duration?: number; durationUnit?: 'months' | 'days'; multiplier: number; isAutoFromDb?: boolean } {
  const userDur = parseDurationFromUserText(userMessage);
  const desc = geminiLine.description || '';
  const dbDur = parseDurationFromDbMetadata(dbMetadata);

  if (isOneTimeLineDescription(desc)) {
    return { multiplier: 1 };
  }

  if (!isRecurringLine(desc, dbMetadata)) {
    return { multiplier: 1 };
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
    return {
      duration: dbDur.value,
      durationUnit: dbDur.unit,
      multiplier: 1,
      isAutoFromDb: true,
    };
  }

  return { multiplier: 1 };
}

/** Multiplier for qty × rate (respects auto-metadata vs user-requested duration). */
export function lineItemPricingMultiplier(item: {
  duration?: number;
  durationIsAuto?: boolean;
}): number {
  if (item.duration == null || item.duration <= 0) return 1;
  if (item.durationIsAuto) return 1;
  return item.duration;
}

/** @deprecated use lineItemPricingMultiplier */
export function durationMultiplier(item: { duration?: number; durationIsAuto?: boolean }): number {
  return lineItemPricingMultiplier(item);
}

/** Pricing multiplier: user-requested duration scales total; DB auto-fill does not. */
export function pricingDurationMultiplier(
  item: { duration?: number },
  userMessage: string,
): number {
  if (item.duration == null || item.duration <= 0) return 1;
  if (userMentionedDuration(userMessage)) return item.duration;
  return 1;
}

export function shouldShowDuration(item: { duration?: number }): boolean {
  return item.duration != null && item.duration > 0;
}

export function formatDurationLabel(item: {
  duration?: number;
  durationUnit?: 'months' | 'days';
}): string {
  if (!shouldShowDuration(item)) return '—';
  const unit = item.durationUnit === 'days' ? 'Da' : 'Mo';
  return `${item.duration} ${unit}`;
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
