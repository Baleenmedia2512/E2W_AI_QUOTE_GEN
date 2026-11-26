/** Quote number seq helpers — same as server/routes/quotes.ts */
export const QUOTE_START_NUMBER = 10001;
export const QUOTE_LEGACY_TIMESTAMP_FLOOR = 900000;

export function parseQuoteSeq(quoteNumber: string | null | undefined): number | null {
  const m = String(quoteNumber || '')
    .trim()
    .toUpperCase()
    .match(/^QT-(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function isSequentialCandidate(n: number): boolean {
  return n >= QUOTE_START_NUMBER && n < QUOTE_LEGACY_TIMESTAMP_FLOOR;
}
