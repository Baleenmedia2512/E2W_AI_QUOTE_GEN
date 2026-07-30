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
  paddingBottom: 32,
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
 * Small buffer for Yoga/font rounding — large values leave empty page-1 gaps.
 */
export const PAGE_PACKING_BUFFER_PT = 12;

/** Dynamic safety margin thresholds (pt). */
export const SAFETY_MARGIN_SMALL_PT = 6;
export const SAFETY_MARGIN_MEDIUM_PT = 9;
export const SAFETY_MARGIN_LARGE_PT = 12;

export const SAFETY_ROW_SMALL_MAX_PT = 42;
export const SAFETY_ROW_MEDIUM_MAX_PT = 56;

/**
 * Typical rendered logo height (pt). Style maxHeight is 143, but most logos
 * paint much shorter; reserving 143 wastes ~2–3 rows on page 1.
 */
export const TYPICAL_LOGO_HEIGHT_PT = 72;
