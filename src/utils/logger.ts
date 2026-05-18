/**
 * PII-Safe Logger
 *
 * Centralised logging utility that:
 * - Respects VITE_LOG_LEVEL env var (debug | info | warn | error)
 * - Redacts common PII patterns (emails, phone numbers, GSTINs) in production
 * - Routes through console.* in dev, suppresses debug/info in prod
 *
 * Governance: PART 8.4 (PII Handling) of claude.md.
 *
 * Usage:
 *   import { logger } from '@/utils/logger';
 *   logger.info('User signed in', { userId: '123' });
 *   logger.error('Sync failed', err);
 */

/* eslint-disable no-console */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const isProd =
  typeof import.meta !== 'undefined' &&
  Boolean((import.meta as ImportMeta).env?.PROD);

const envLevel = (() => {
  try {
    const raw =
      typeof import.meta !== 'undefined'
        ? ((import.meta as ImportMeta).env?.VITE_LOG_LEVEL as string | undefined)
        : undefined;
    if (raw && raw in LEVEL_RANK) return raw as LogLevel;
  } catch {
    // ignore
  }
  return isProd ? ('warn' as LogLevel) : ('debug' as LogLevel);
})();

const MIN_RANK = LEVEL_RANK[envLevel];

// PII patterns — applied to string args in production only.
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?:\+?\d[\s-]?){10,15}/g;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g;

function redactString(value: string): string {
  return value
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(GSTIN_RE, '[REDACTED_GSTIN]')
    .replace(PHONE_RE, '[REDACTED_PHONE]');
}

function redact(arg: unknown): unknown {
  if (!isProd) return arg;
  if (typeof arg === 'string') return redactString(arg);
  if (arg instanceof Error) {
    const clone = new Error(redactString(arg.message));
    clone.name = arg.name;
    clone.stack = arg.stack;
    return clone;
  }
  return arg;
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVEL_RANK[level] < MIN_RANK) return;
  const sanitized = args.map(redact);
  switch (level) {
    case 'debug':
      console.debug(...sanitized);
      break;
    case 'info':
      console.info(...sanitized);
      break;
    case 'warn':
      console.warn(...sanitized);
      break;
    case 'error':
      console.error(...sanitized);
      break;
  }
}

export const logger = {
  debug: (...args: unknown[]): void => emit('debug', args),
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),
};

// Exposed for tests only.
export const __internal = {
  redactString,
  isProd,
  envLevel,
};
