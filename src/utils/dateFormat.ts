/** Strict 3-letter English months (avoids en-IN "Sept"). */
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Quote header dates: "6 Aug 2026", "5 Sep 2026"
 */
export function formatQuoteDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  const month = MONTH_ABBR[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}
