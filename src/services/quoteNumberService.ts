import { supabase } from './supabaseClient';

/** First issued number when QuoteDownload has no sequential QT-* rows yet. */
const START_NUMBER = 10001;
/**
 * Last number that was actually issued on download (not a draft peek).
 * Used only as a same-browser guard between allocate and QuoteDownload insert.
 */
const LOCAL_ISSUED_KEY = 'qb_quote_seq_issued';
/**
 * Old generator used Date.now().slice(-6) → large 6-digit tails (e.g. 942044).
 * Those must not drive the sequential counter.
 */
const LEGACY_TIMESTAMP_FLOOR = 900000;

function formatQuoteNumber(n: number): string {
  return `QT-${n}`;
}

/** Parse QT-10001 → 10001; ignore non-matching values. */
export function parseQuoteSeq(quoteNumber: string | null | undefined): number | null {
  const m = String(quoteNumber || '')
    .trim()
    .toUpperCase()
    .match(/^QT-(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** True for old Date.now()-style numbers (not QT-10001 sequence). */
export function isLegacyTimestampQuoteNumber(
  quoteNumber: string | null | undefined,
): boolean {
  const n = parseQuoteSeq(quoteNumber);
  if (n == null) return true;
  return n >= LEGACY_TIMESTAMP_FLOOR;
}

function isSequentialCandidate(n: number): boolean {
  return n >= START_NUMBER && n < LEGACY_TIMESTAMP_FLOOR;
}

function readIssuedLocal(): number {
  try {
    const raw = localStorage.getItem(LOCAL_ISSUED_KEY);
    if (!raw) return START_NUMBER - 1;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || !isSequentialCandidate(n)) return START_NUMBER - 1;
    return n;
  } catch {
    return START_NUMBER - 1;
  }
}

function rememberIssuedLocal(n: number): void {
  try {
    if (!isSequentialCandidate(n)) return;
    localStorage.setItem(LOCAL_ISSUED_KEY, String(n));
  } catch {
    /* ignore */
  }
}

/** Max sequential QT-* already stored in QuoteDownload (issued on download). */
async function maxIssuedFromQuoteDownload(): Promise<number> {
  let dbMax = START_NUMBER - 1;
  try {
    // Prefer newest rows; fall back to a plain select if createdAt is unavailable.
    let rows: { quoteNumber?: string }[] | null = null;
    const primary = await supabase
      .from('QuoteDownload')
      .select('quoteNumber')
      .order('createdAt', { ascending: false })
      .limit(500);

    if (primary.error) {
      const fallback = await supabase
        .from('QuoteDownload')
        .select('quoteNumber')
        .limit(1000);
      if (fallback.error) {
        console.warn('⚠️ QuoteDownload lookup failed:', fallback.error.message);
        return dbMax;
      }
      rows = fallback.data;
    } else {
      rows = primary.data;
    }

    for (const row of rows || []) {
      const n = parseQuoteSeq(row.quoteNumber);
      if (n != null && isSequentialCandidate(n) && n > dbMax) dbMax = n;
    }
    console.log('📊 QuoteDownload max sequential:', dbMax);
  } catch (err) {
    console.warn('⚠️ maxIssuedFromQuoteDownload exception:', err);
  }
  return dbMax;
}

export async function isQuoteNumberIssuedInDb(
  quoteNumber: string,
): Promise<boolean> {
  const qn = (quoteNumber || '').trim();
  if (!qn || isLegacyTimestampQuoteNumber(qn)) return false;
  try {
    const { data, error } = await supabase
      .from('QuoteDownload')
      .select('id')
      .eq('quoteNumber', qn)
      .limit(1);
    if (error) return false;
    return !!(data && data.length > 0);
  } catch {
    return false;
  }
}

/**
 * Preview / create / regenerate: next number = last in DB (+ local issued) + 1.
 * Does not consume. If DB has QT-10001 → returns QT-10002.
 */
export async function peekNextQuoteNumber(): Promise<string> {
  const dbMax = await maxIssuedFromQuoteDownload();
  const localIssued = readIssuedLocal();
  const next = Math.max(dbMax, localIssued, START_NUMBER - 1) + 1;
  console.log(
    '👀 Quote number peek (not issued):',
    formatQuoteNumber(next),
    `(dbMax=${dbMax}, localIssued=${localIssued})`,
  );
  return formatQuoteNumber(next);
}

/** Sync peek for buildQuote fallback — does not consume a number. */
export function peekNextQuoteNumberSync(): string {
  const next = Math.max(readIssuedLocal(), START_NUMBER - 1) + 1;
  return formatQuoteNumber(next);
}

/** @deprecated Use peekNextQuoteNumberSync — kept name for older imports. */
export function allocateLocalQuoteNumberSync(): string {
  return peekNextQuoteNumberSync();
}

/**
 * DOWNLOAD ONLY: consume next sequential number and remember it locally.
 * Source of truth remains QuoteDownload rows after recordQuoteDownload.
 */
export async function allocateNextQuoteNumber(): Promise<string> {
  const dbMax = await maxIssuedFromQuoteDownload();
  const localIssued = readIssuedLocal();
  const next = Math.max(dbMax, localIssued, START_NUMBER - 1) + 1;
  rememberIssuedLocal(next);
  console.log('✅ Quote number ISSUED on download:', formatQuoteNumber(next));
  return formatQuoteNumber(next);
}
