/**
 * Reusable PDF pagination engine.
 *
 * Architecture:
 *   measure (pt heights) → paginate (pack rows) → pageBuilder → React-PDF <Page>[]
 *
 * Templates supply adapters that measure their chrome/rows using style tokens.
 * The engine never hardcodes “6 rows on page 1”.
 */

export * from './types';
export * from './constants';
export * from './utils';
export * from './measure';
export * from './pagination';
export * from './pageBuilder';
