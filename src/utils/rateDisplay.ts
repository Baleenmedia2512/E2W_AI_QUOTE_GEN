/**
 * Display-only formatting for unit rates (recurring / one-time / breakdown formula).
 * Does not change stored values.
 *
 * Cases:
 * - |n| < 10        → always 2 decimals (0.90, 1.20)
 * - within ₹0.10 of a whole number → integer (999.90 → 1000, 1700.00 → 1700)
 * - otherwise       → up to 2 decimals, trailing zeros trimmed (3133.33)
 */

const SMALL_RATE_ABS = 10;
const NEAR_WHOLE_EPS = 0.1;

/** Round to 2 decimal places (paise). */
export function roundRate2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Format a unit rate for tables / formulas (no ₹ symbol).
 */
export function formatUnitRateDisplay(n: number): string {
  if (!Number.isFinite(n)) return '—';

  const v = roundRate2(n);

  // Small unit rates — always keep 2 decimals
  if (Math.abs(v) < SMALL_RATE_ABS) {
    return v.toFixed(2);
  }

  // Almost / exact whole number — show as integer
  const nearest = Math.round(v);
  if (Math.abs(v - nearest) <= NEAR_WHOLE_EPS + 1e-9) {
    return String(nearest);
  }

  // Real decimals — up to 2 places, no trailing zeros
  return parseFloat(v.toFixed(2)).toString();
}

/**
 * Same rules, with ₹ prefix for breakdown formula lines.
 */
export function formatUnitRateInr(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `₹ ${formatUnitRateDisplay(n)}`;
}

/**
 * Recurring unit-rate caption under the charge value.
 * With a qty unit, wraps as two lines so narrow columns stay readable:
 *   (per month per
 *   board)
 */
export function formatRecurringRateUnitLabel(
  ratePeriod: 'per_month' | 'per_day' | undefined,
  quantityUnit?: string | null,
  options?: { wrapUnit?: boolean },
): string {
  const period = ratePeriod === 'per_month' ? 'per month' : 'per day';
  const unit = String(quantityUnit || '')
    .trim()
    .replace(/^per\s+/i, '')
    .trim();
  if (!unit) return `(${period})`;
  if (options?.wrapUnit === false) {
    return `(${period} per ${unit})`;
  }
  return `(${period} per\n${unit})`;
}
