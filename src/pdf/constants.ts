/**
 * PDF geometry constants (ISO A4 + shared layout tokens).
 * These are physical page facts — not "N rows per page" heuristics.
 */

import type { PageGeometry, PaginationOptions } from './types';

/** ISO A4 in points (1 pt = 1/72 in). */
export const A4_PAGE_WIDTH_PT = 595.28;
export const A4_PAGE_HEIGHT_PT = 841.89;

/**
 * Default Corporate Minimal page padding (must stay in sync with
 * CorporateMinimalPDF.styles `page` — adapters may override).
 */
export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  pageHeight: A4_PAGE_HEIGHT_PT,
  pageWidth: A4_PAGE_WIDTH_PT,
  paddingTop: 27,
  paddingBottom: 58,
  paddingLeft: 33,
  paddingRight: 33,
};

export const DEFAULT_PAGINATION_OPTIONS: PaginationOptions = {
  minRowsPerPage: 2,
  /** Continuation pages: thead + rows + footer only. */
  repeatCompanyHeaderOnContinuation: false,
  debug: false,
};

/**
 * Calibri average advance — slightly wide so wrap line counts are not
 * underestimated (under-measure → React-PDF auto-pages with no thead).
 */
export const CALIBRI_AVG_CHAR_FACTOR = 0.52;
export const CALIBRI_BOLD_AVG_CHAR_FACTOR = 0.56;

/**
 * Extra body reserve (pt) subtracted from available height on every page.
 * Keeps Yoga from overflowing a wrap={false} summary <Page> when measure is
 * a few pt optimistic — without leaving a full empty row gap.
 */
export const PAGE_PACKING_BUFFER_PT = 8;

/**
 * Allow packing a row that overshoots remaining by this many pt.
 * Measure stays slightly conservative; this recovers the last visible gap.
 * Keep small — large slack over-packs and clips on wrap={false} summary pages.
 */
export const PACK_OVERFILL_SLACK_PT = 12;

/**
 * @deprecated Tall rows use the same slack as short rows (see packOverfillSlack).
 * Kept so older imports do not break.
 */
export const PACK_TALL_ROW_OVERFILL_FRAC = 0;
export const PACK_TALL_ROW_OVERFILL_MAX_PT = 12;

/** Dynamic safety margin thresholds (pt). */
export const SAFETY_MARGIN_SMALL_PT = 2;
export const SAFETY_MARGIN_MEDIUM_PT = 4;
export const SAFETY_MARGIN_LARGE_PT = 6;

export const SAFETY_ROW_SMALL_MAX_PT = 42;
/** Allow 2-line recurring unit labels (~58pt) to stay on medium margin. */
export const SAFETY_ROW_MEDIUM_MAX_PT = 64;

/**
 * Typical rendered logo height (pt). Style maxHeight is 143, but most logos
 * paint much shorter; reserving 143 wastes ~2–3 rows on page 1.
 */
export const TYPICAL_LOGO_HEIGHT_PT = 72;
