/**
 * Measurement engine — convert document sections into pt heights.
 * Template adapters call these helpers with their style tokens.
 */

import {
  CALIBRI_AVG_CHAR_FACTOR,
  CALIBRI_BOLD_AVG_CHAR_FACTOR,
} from './constants';
import type {
  PageChromeHeights,
  PageGeometry,
  StackedCellMeasure,
  TextMeasureStyle,
} from './types';
import {
  atLeast,
  contentHeight,
  contentWidth,
  countWrappedLines,
  measureStackedCellHeight,
  textBlockHeight,
} from './utils';

export interface MeasureTextBlockArgs {
  text: string;
  style: TextMeasureStyle;
  maxWidth: number;
  marginTop?: number;
  marginBottom?: number;
  paddingTop?: number;
  paddingBottom?: number;
  borderTop?: number;
  borderBottom?: number;
}

/** Generic text block height including optional margins/borders/padding. */
export function measureTextBlock(args: MeasureTextBlockArgs): number {
  const lines = countWrappedLines(args.text, args.maxWidth, args.style);
  return (
    textBlockHeight(lines, args.style) +
    (args.marginTop ?? 0) +
    (args.marginBottom ?? 0) +
    (args.paddingTop ?? 0) +
    (args.paddingBottom ?? 0) +
    (args.borderTop ?? 0) +
    (args.borderBottom ?? 0)
  );
}

/** Tallest stacked cell wins (table row height). */
export function measureRowHeightFromCells(
  cells: StackedCellMeasure[],
  opts?: { minHeight?: number; borderTop?: number; borderBottom?: number },
): number {
  let maxContent = 0;
  for (const cell of cells) {
    const h = measureStackedCellHeight(cell);
    if (h > maxContent) maxContent = h;
  }
  const borders = (opts?.borderTop ?? 0) + (opts?.borderBottom ?? 0);
  return atLeast(maxContent + borders, opts?.minHeight ?? 0);
}

export interface CompanyHeaderMeasureInput {
  hasLogo: boolean;
  logoMaxHeight: number;
  logoRowMarginBottom: number;
  showQuoteTitle: boolean;
  quoteTitleHeight: number;
  /** Lines in the left company-details column (phone, email, gst, …). */
  companyDetailLineCount: number;
  companyDetailFontSize: number;
  companyDetailLineHeight: number;
  /** Meta rows on the right (quote #, dates). */
  metaRowCount: number;
  metaRowHeight: number;
  infoRowPaddingVertical: number;
  headerMarginBottom: number;
  headerPaddingBottom: number;
  headerBorderBottom: number;
  dividerHeight: number;
  dividerMarginBottom: number;
}

/**
 * Measure quotation header (logo + title + info row + divider).
 * Uses structural style tokens — not a fixed “header = 120pt” guess for all quotes.
 */
export function measureHeaderHeight(input: CompanyHeaderMeasureInput): number {
  let h = 0;
  if (input.hasLogo) {
    h += input.logoMaxHeight + input.logoRowMarginBottom;
  }
  if (input.showQuoteTitle) {
    h += input.quoteTitleHeight;
  }

  const leftCol =
    input.companyDetailLineCount *
    input.companyDetailFontSize *
    input.companyDetailLineHeight;
  const rightCol = input.metaRowCount * input.metaRowHeight;
  const infoInner = Math.max(leftCol, rightCol);
  h += infoInner + input.infoRowPaddingVertical * 2;

  h += input.headerPaddingBottom + input.headerBorderBottom;
  h += input.dividerHeight + input.dividerMarginBottom;
  h += input.headerMarginBottom;
  return h;
}

export interface ClientDetailsMeasureInput {
  contentWidth: number;
  primaryLine: string;
  overflowLine?: string | null;
  fontSize: number;
  lineHeight: number;
  paddingVertical: number;
  paddingHorizontal: number;
  marginBottom: number;
}

export function measureClientDetailsHeight(input: ClientDetailsMeasureInput): number {
  const innerW = Math.max(1, input.contentWidth - input.paddingHorizontal * 2);
  const style: TextMeasureStyle = {
    fontSize: input.fontSize,
    avgCharWidthFactor: CALIBRI_AVG_CHAR_FACTOR,
    lineHeight: input.lineHeight,
  };
  let lines = countWrappedLines(input.primaryLine, innerW, style);
  if (input.overflowLine?.trim()) {
    lines += countWrappedLines(input.overflowLine, innerW, style);
  }
  return (
    textBlockHeight(lines, style) +
    input.paddingVertical * 2 +
    input.marginBottom
  );
}

export interface SectionHeadingMeasureInput {
  text: string;
  contentWidth: number;
  fontSize: number;
  lineHeight?: number;
  marginTop: number;
  marginBottom: number;
  paddingBottom: number;
  borderBottom: number;
}

export function measureSummaryHeadingHeight(input: SectionHeadingMeasureInput): number {
  return measureTextBlock({
    text: input.text,
    maxWidth: input.contentWidth,
    style: {
      fontSize: input.fontSize,
      avgCharWidthFactor: CALIBRI_BOLD_AVG_CHAR_FACTOR,
      lineHeight: input.lineHeight ?? 1.2,
    },
    marginTop: input.marginTop,
    marginBottom: input.marginBottom,
    paddingBottom: input.paddingBottom,
    borderBottom: input.borderBottom,
  });
}

export interface TableHeaderMeasureInput {
  /** First header row (column titles) — often 2 text lines. */
  titleRowLineCount: number;
  titleFontSize: number;
  titleLineHeight: number;
  titlePaddingVertical: number;
  /** Second header row (A/B/C/D) — usually 1 line. */
  letterRowLineCount: number;
  letterFontSize: number;
  letterLineHeight: number;
  letterPaddingVertical: number;
  letterRowBorderTop: number;
}

export function measureTableHeaderHeight(input: TableHeaderMeasureInput): number {
  const title =
    input.titleRowLineCount * input.titleFontSize * input.titleLineHeight +
    input.titlePaddingVertical * 2;
  const letters =
    input.letterRowLineCount * input.letterFontSize * input.letterLineHeight +
    input.letterPaddingVertical * 2 +
    input.letterRowBorderTop;
  return title + letters;
}

export interface TotalsMeasureInput {
  /** Per-row specs when totals rows differ (excl vs incl). */
  rows: Array<{
    fontSize: number;
    lineHeight: number;
    paddingVertical: number;
  }>;
  borderTop: number;
}

export function measureTotalsHeight(input: TotalsMeasureInput): number {
  let h = input.borderTop;
  for (const row of input.rows) {
    h += row.fontSize * row.lineHeight + row.paddingVertical * 2;
  }
  return h;
}

/**
 * Available body height for table rows (+ optional totals) on a page.
 * Deducts all chrome that appears on that page.
 */
export function availableBodyHeight(args: {
  geometry: PageGeometry;
  chrome: PageChromeHeights;
  showCompanyHeader: boolean;
  showClientDetails: boolean;
  showSectionHeading: boolean;
  showTableHeader: boolean;
}): number {
  const box = contentHeight(args.geometry) - args.chrome.footerReserve;
  let used = 0;
  if (args.showCompanyHeader) used += args.chrome.companyHeader;
  if (args.showClientDetails) used += args.chrome.clientDetails;
  if (args.showSectionHeading) used += args.chrome.sectionHeading;
  if (args.showTableHeader) used += args.chrome.tableHeader;
  return Math.max(0, box - used);
}

export function measurePageContentWidth(geometry: PageGeometry): number {
  return contentWidth(geometry);
}

export { contentHeight, contentWidth, measureStackedCellHeight, countWrappedLines };
