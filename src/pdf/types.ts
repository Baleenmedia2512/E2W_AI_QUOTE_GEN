/**
 * Reusable PDF layout / pagination types.
 * Template-agnostic: adapters supply measured heights; the engine packs pages.
 */

/** Physical page geometry (pt). */
export interface PageGeometry {
  pageHeight: number;
  pageWidth: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
}

/** A measured atomic content unit (never split across pages). */
export interface MeasuredUnit<TData = unknown> {
  id: string;
  /** Measured height in pt (includes padding + borders). */
  height: number;
  data: TData;
}

/** Chrome heights that reserve vertical space before table body rows. */
export interface PageChromeHeights {
  /** Fixed / absolute footer reserve (not in normal flow). */
  footerReserve: number;
  /** Accent bar / other absolute top chrome already outside padding. */
  accentReserve?: number;
  /** Company / quotation header (first and/or continuation pages). */
  companyHeader: number;
  /** Client block — typically first page only. */
  clientDetails: number;
  /** Section title above the table — typically first page only. */
  sectionHeading: number;
  /** Table column header row(s). Repeated on every page that has rows. */
  tableHeader: number;
  /** Totals / tfoot block — last page only, never split. */
  totals: number;
}

export interface WidowOrphanOptions {
  /**
   * Prefer at least this many body rows on a page when enough rows remain.
   * Prevents a lone row at the top/bottom of a page (ERP-style).
   */
  minRowsPerPage: number;
}

export interface PaginationOptions extends WidowOrphanOptions {
  /**
   * When true, continuation pages include companyHeader chrome.
   * When false, only tableHeader + rows (+ totals on last) + footer.
   */
  repeatCompanyHeaderOnContinuation: boolean;
  /**
   * Log every fit / new-page decision to the console.
   * Intended for local tuning — keep false in production.
   */
  debug?: boolean;
}

export interface PaginateTableInput<TRow> {
  geometry: PageGeometry;
  /** Chrome used on the first page (full header + client + heading). */
  chrome: PageChromeHeights;
  /**
   * Optional chrome overrides for continuation pages.
   * Typical: companyHeader/clientDetails/sectionHeading = 0.
   */
  continuationChrome?: Partial<PageChromeHeights>;
  rows: MeasuredUnit<TRow>[];
  options?: Partial<PaginationOptions>;
}

/**
 * One logical PDF page produced by the engine (before React-PDF render).
 */
export interface BuiltTablePage<TRow> {
  pageNumber: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  showCompanyHeader: boolean;
  showClientDetails: boolean;
  showSectionHeading: boolean;
  showTableHeader: boolean;
  showTotals: boolean;
  /** Absolute indices into the original measured row array. */
  rowStartIndex: number;
  rows: MeasuredUnit<TRow>[];
  /** Content box height available for body (+ totals when last). */
  availableBodyHeight: number;
  usedBodyHeight: number;
}

/** One debug line emitted when `options.debug` is true. */
export interface PaginationDebugEvent {
  pageNumber: number;
  availableHeight: number;
  usedHeight: number;
  remainingHeight: number;
  currentRowHeight: number;
  nextRowHeight: number | null;
  safetyMargin: number;
  decision: 'Fits' | 'NewPage' | 'ForceOversized' | 'TotalsNextPage';
  rowId?: string;
}

export interface TextMeasureStyle {
  fontSize: number;
  /** Average glyph width as a fraction of fontSize (Calibri ≈ 0.48–0.52). */
  avgCharWidthFactor: number;
  lineHeight: number;
  /** Horizontal padding deducted from column width before wrapping. */
  paddingHorizontal?: number;
}

export interface StackedCellMeasure {
  /** Primary value line(s). */
  primaryText: string;
  primaryStyle: TextMeasureStyle;
  /** Optional secondary unit label under the value. */
  secondaryText?: string | null;
  secondaryStyle?: TextMeasureStyle;
  /** Vertical padding inside the cell. */
  paddingVertical: number;
  columnWidth: number;
  /** Use kebab-segment wrap for SERVICE & LOCATION cells. */
  primaryWrap?: 'default' | 'serviceId';
}

export interface MeasureContext {
  contentWidth: number;
  geometry: PageGeometry;
}
