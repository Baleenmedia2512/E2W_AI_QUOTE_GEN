import { apiFetch } from './apiClient';

const START_NUMBER = 10001;
const LOCAL_ISSUED_KEY = 'qb_quote_seq_issued';
const LEGACY_TIMESTAMP_FLOOR = 900000;

function formatQuoteNumber(n: number): string {
  return `QT-${n}`;
}

export function parseQuoteSeq(quoteNumber: string | null | undefined): number | null {
  const m = String(quoteNumber || '')
    .trim()
    .toUpperCase()
    .match(/^QT-(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

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

async function maxIssuedFromQuoteDownload(): Promise<number> {
  try {
    const { data, error } = await apiFetch<{ max?: number }>('/api/quotes/numbers/max');
    if (error) {
      console.warn('⚠️ QuoteDownload lookup failed:', error);
      return START_NUMBER - 1;
    }
    const dbMax = Number(data?.max);
    return Number.isFinite(dbMax) ? dbMax : START_NUMBER - 1;
  } catch (err) {
    console.warn('⚠️ maxIssuedFromQuoteDownload exception:', err);
    return START_NUMBER - 1;
  }
}

export async function isQuoteNumberIssuedInDb(quoteNumber: string): Promise<boolean> {
  const qn = (quoteNumber || '').trim();
  if (!qn || isLegacyTimestampQuoteNumber(qn)) return false;
  try {
    const { data, error } = await apiFetch<{ issued?: boolean }>(
      `/api/quotes/numbers/issued?quoteNumber=${encodeURIComponent(qn)}`,
    );
    if (error) return false;
    return !!data?.issued;
  } catch {
    return false;
  }
}

export async function peekNextQuoteNumber(): Promise<string> {
  const dbMax = await maxIssuedFromQuoteDownload();
  const localIssued = readIssuedLocal();
  const next = Math.max(dbMax, localIssued, START_NUMBER - 1) + 1;
  return formatQuoteNumber(next);
}

export function peekNextQuoteNumberSync(): string {
  const next = Math.max(readIssuedLocal(), START_NUMBER - 1) + 1;
  return formatQuoteNumber(next);
}

export function allocateLocalQuoteNumberSync(): string {
  return peekNextQuoteNumberSync();
}

export async function allocateNextQuoteNumber(): Promise<string> {
  const dbMax = await maxIssuedFromQuoteDownload();
  const localIssued = readIssuedLocal();
  const next = Math.max(dbMax, localIssued, START_NUMBER - 1) + 1;
  rememberIssuedLocal(next);
  console.log('✅ Quote number ISSUED on download:', formatQuoteNumber(next));
  return formatQuoteNumber(next);
}
