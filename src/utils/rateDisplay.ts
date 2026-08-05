/**
 * Display-only formatting for unit rates (recurring / one-time / breakdown formula).
 * Does not change stored values.
 *
 * Cases:
 * - |n| < 10        → always 2 decimals (0.90, 1.20)
 * - within ₹0.10 of a whole number → integer (999.90 → 1,000, 1700.00 → 1,700)
 * - otherwise       → up to 2 decimals, trailing zeros trimmed (3,133.33)
 *
 * Grouping uses Indian locale (en-IN): 12,500 / 1,00,000.
 */

const SMALL_RATE_ABS = 10;
const NEAR_WHOLE_EPS = 0.1;

/** Round to 2 decimal places (paise). */
export function roundRate2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Apply Indian digit grouping to a plain numeric string ("12500" | "3133.33"). */
function withIndianCommas(numStr: string): string {
  const neg = numStr.startsWith('-');
  const raw = neg ? numStr.slice(1) : numStr;
  const [intPart, decPart] = raw.split('.');
  const grouped = Number(intPart || '0').toLocaleString('en-IN', {
    maximumFractionDigits: 0,
    useGrouping: true,
  });
  const out = decPart != null && decPart !== '' ? `${grouped}.${decPart}` : grouped;
  return neg ? `-${out}` : out;
}

/**
 * Format a unit rate for tables (Indian commas, no ₹ symbol).
 */
export function formatUnitRateDisplay(n: number): string {
  if (!Number.isFinite(n)) return '—';

  const v = roundRate2(n);

  // Small unit rates — always keep 2 decimals
  if (Math.abs(v) < SMALL_RATE_ABS) {
    return withIndianCommas(v.toFixed(2));
  }

  // Almost / exact whole number — show as integer
  const nearest = Math.round(v);
  if (Math.abs(v - nearest) <= NEAR_WHOLE_EPS + 1e-9) {
    return nearest.toLocaleString('en-IN', { maximumFractionDigits: 0, useGrouping: true });
  }

  // Real decimals — up to 2 places, no trailing zeros
  const trimmed = parseFloat(v.toFixed(2)).toString();
  return withIndianCommas(trimmed);
}

/**
 * Same rules, with ₹ prefix (matches Amount column style: ₹12,500).
 */
export function formatUnitRateInr(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `₹${formatUnitRateDisplay(n)}`;
}

/**
 * Parse a user-typed rate that may include ₹, spaces, or Indian/Western commas.
 */
export function parseRateInput(raw: string): number {
  const cleaned = String(raw)
    .replace(/₹/g, '')
    .replace(/rs\.?/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
  return parseFloat(cleaned);
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
