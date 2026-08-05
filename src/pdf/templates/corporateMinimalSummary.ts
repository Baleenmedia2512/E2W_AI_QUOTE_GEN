/**
 * Corporate Minimal — Executive Pricing Summary measurement adapter.
 *
 * Maps TemplateData + ExecutiveSummaryRow[] → MeasuredUnit[] + PageChromeHeights
 * using the same style tokens as CorporateMinimalPDF.styles / fontSizes.
 *
 * Heights are cached per row id (O(n) measure once).
 */

import type { TemplateData } from '../../types/template';
import type { ExecutiveSummaryRow } from '../../utils/quoteGrouping';
import {
  formatRecurringRateUnitLabel,
  formatUnitRateInr,
} from '../../utils/rateDisplay';
import { PDF_FONT } from '../../components/Templates/CorporateMinimalPDF.fontSizes';
import {
  CALIBRI_AVG_CHAR_FACTOR,
  CALIBRI_BOLD_AVG_CHAR_FACTOR,
  DEFAULT_PAGE_GEOMETRY,
  TYPICAL_LOGO_HEIGHT_PT,
} from '../constants';
import {
  measureClientDetailsHeight,
  measureHeaderHeight,
  measurePageContentWidth,
  measureRowHeightFromCells,
  measureSummaryHeadingHeight,
  measureTableHeaderHeight,
  measureTotalsHeight,
} from '../measure';
import type {
  MeasuredUnit,
  PageChromeHeights,
  PageGeometry,
  StackedCellMeasure,
  TextMeasureStyle,
} from '../types';
import { buildTablePages } from '../pageBuilder';
import type { BuiltTablePage } from '../types';

/** Column widths — must match CorporateMinimalPDF.styles col* (pt). */
export const CM_COL = {
  serviceId: 100,
  qty: 70,
  dur: 74,
  recurring: 86,
  onetime: 80,
  amount: 119,
  remark: 40,
} as const;

const cellValueStyle = (): TextMeasureStyle => ({
  fontSize: PDF_FONT.cellValue,
  avgCharWidthFactor: CALIBRI_BOLD_AVG_CHAR_FACTOR,
  lineHeight: 1.2,
  paddingHorizontal: 4,
});

const unitLabelStyle = (): TextMeasureStyle => ({
  fontSize: PDF_FONT.itemUnitLabel,
  avgCharWidthFactor: CALIBRI_AVG_CHAR_FACTOR,
  lineHeight: 1.05,
  paddingHorizontal: 4,
});

const serviceIdStyle = (): TextMeasureStyle => ({
  fontSize: PDF_FONT.serviceIdText,
  // Calibri bold ~0.48–0.50; slightly under 0.5 so long locations don’t
  // over-count lines (under-pack). Do not go much lower — under-measure clips.
  avgCharWidthFactor: 0.48,
  lineHeight: 1.05,
  paddingHorizontal: 4,
});

function stripPer(unit: string | undefined): string {
  return String(unit || '').replace(/^per\s+/i, '');
}

function qtyUnitLabel(row: ExecutiveSummaryRow): string | null {
  return row.quantityUnit ? `(${stripPer(row.quantityUnit)})` : null;
}

function durUnitLabel(row: ExecutiveSummaryRow): string | null {
  if (row.duration == null) return null;
  return `(${row.durationLabel || (row.durationUnit === 'months' ? 'month' : 'days')})`;
}

function rateUnitLabel(row: ExecutiveSummaryRow): string | null {
  if (row.requiringCharge <= 0) return null;
  if (row.duration != null) {
    return formatRecurringRateUnitLabel(row.ratePeriod, row.quantityUnit);
  }
  return row.quantityUnit ? `(per ${stripPer(row.quantityUnit)})` : null;
}

function oneTimeUnitLabel(row: ExecutiveSummaryRow): string | null {
  if (row.oneTimeCharge <= 0 || !row.quantityUnit) return null;
  return `(per ${stripPer(row.quantityUnit)})`;
}

function formatAmountApprox(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function measureExecutiveSummaryRowHeight(
  row: ExecutiveSummaryRow,
  hasRemark: boolean,
): number {
  const padV = 8;
  const cells: StackedCellMeasure[] = [
    {
      primaryText: row.serviceId || '',
      primaryStyle: serviceIdStyle(),
      paddingVertical: padV,
      columnWidth: CM_COL.serviceId,
      primaryWrap: 'serviceId',
    },
    {
      primaryText: String(row.quantity),
      primaryStyle: cellValueStyle(),
      secondaryText: qtyUnitLabel(row),
      secondaryStyle: unitLabelStyle(),
      paddingVertical: padV,
      columnWidth: CM_COL.qty,
    },
    {
      primaryText: row.duration != null ? String(row.duration) : '—',
      primaryStyle: cellValueStyle(),
      secondaryText: durUnitLabel(row),
      secondaryStyle: unitLabelStyle(),
      paddingVertical: padV,
      columnWidth: CM_COL.dur,
    },
    {
      primaryText:
        row.requiringCharge > 0 ? formatUnitRateInr(row.requiringCharge) : '—',
      primaryStyle: cellValueStyle(),
      secondaryText: rateUnitLabel(row),
      secondaryStyle: unitLabelStyle(),
      paddingVertical: padV,
      columnWidth: CM_COL.recurring,
    },
    {
      primaryText:
        row.oneTimeCharge > 0 ? formatUnitRateInr(row.oneTimeCharge) : '—',
      primaryStyle: cellValueStyle(),
      secondaryText: oneTimeUnitLabel(row),
      secondaryStyle: unitLabelStyle(),
      paddingVertical: padV,
      columnWidth: CM_COL.onetime,
    },
    {
      primaryText: formatAmountApprox(row.amountExclGst),
      primaryStyle: cellValueStyle(),
      paddingVertical: padV,
      // colAmount also has paddingRight: 10 in styles
      columnWidth: CM_COL.amount - 6,
    },
  ];

  if (hasRemark) {
    cells.push({
      primaryText: row.remark || '',
      primaryStyle: cellValueStyle(),
      paddingVertical: padV,
      columnWidth: CM_COL.remark,
    });
  }

  // Rows own top+bottom borders in styles; both consume Yoga space.
  // −3pt: wrap measure stays slightly high after SERVICE & LOCATION font shrink.
  // Do NOT scale tall heights down — under-measure packs too many rows, then
  // React-PDF bounces the whole wrap={false} table and leaves heading-only page 1.
  return (
    measureRowHeightFromCells(cells, {
      minHeight: 38,
      borderTop: 1,
      borderBottom: 1,
    }) - 3
  );
}

export function measureCorporateMinimalChrome(args: {
  data: TemplateData;
  geometry?: PageGeometry;
  sectionHeadingText?: string;
}): {
  geometry: PageGeometry;
  chrome: PageChromeHeights;
} {
  const geometry = args.geometry ?? DEFAULT_PAGE_GEOMETRY;
  const cw = measurePageContentWidth(geometry);
  const { company, client } = args.data;

  const companyLines =
    (company.phone ? 1 : 0) +
    (company.email ? 1 : 0) +
    (company.gst ? 1 : 0) +
    (company.abn ? 1 : 0);

  // Header wrapper does NOT use s.header (no paddingBottom/borderBottom there).
  // Only logo, title, info row, and headerDivider are rendered.
  // IMPORTANT: do NOT reserve logo maxHeight (143) — actual paint is usually ~60–80pt.
  // Over-reserving here is why page 1 stopped after 2 rows with a large empty gap.
  const fullHeader = measureHeaderHeight({
    hasLogo: Boolean(company.logo),
    logoMaxHeight: TYPICAL_LOGO_HEIGHT_PT,
    logoRowMarginBottom: 9,
    showQuoteTitle: true,
    quoteTitleHeight: PDF_FONT.quoteTitle * 1.05 + 10 + 11,
    companyDetailLineCount: Math.max(1, companyLines),
    companyDetailFontSize: PDF_FONT.companyDetails,
    companyDetailLineHeight: 1.7,
    metaRowCount: 3,
    metaRowHeight: PDF_FONT.metaValue * 1.05 + 3,
    infoRowPaddingVertical: 11,
    headerMarginBottom: 0,
    headerPaddingBottom: 0,
    headerBorderBottom: 0,
    dividerHeight: 2,
    dividerMarginBottom: 14,
  });

  const primaryClient = `Quote Prepared For: ${(client.company || client.name || '').toUpperCase()}${
    client.phone ? ` | PH: ${client.phone}` : ''
  }`;
  const overflowParts: string[] = [];
  if (client.email) overflowParts.push(`Email: ${client.email}`);
  if (client.address) overflowParts.push(`Address: ${client.address}`);
  if (client.gst) overflowParts.push(`GST: ${client.gst}`);

  const clientH = measureClientDetailsHeight({
    contentWidth: cw,
    primaryLine: primaryClient,
    overflowLine: overflowParts.length ? overflowParts.join(' | ') : null,
    fontSize: PDF_FONT.clientDetail,
    lineHeight: 1.6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  });

  const sectionH = measureSummaryHeadingHeight({
    text: args.sectionHeadingText ?? 'Executive Pricing Summary',
    contentWidth: cw,
    fontSize: PDF_FONT.sectionHeading,
    marginTop: 6,
    marginBottom: 14,
    paddingBottom: 8,
    borderBottom: 2,
  });

  const tableHeader = measureTableHeaderHeight({
    titleRowLineCount: 2,
    titleFontSize: PDF_FONT.theadCell,
    titleLineHeight: 1.2,
    titlePaddingVertical: 12,
    letterRowLineCount: 1,
    letterFontSize: 12,
    letterLineHeight: 1.2,
    letterPaddingVertical: 7,
    letterRowBorderTop: 0.75,
  });

  // Excl + GST + incl measured separately (was overestimating both at incl size).
  const totals = measureTotalsHeight({
    borderTop: 2,
    rows: [
      {
        fontSize: PDF_FONT.tfootLabel,
        lineHeight: 1.15,
        paddingVertical: 8,
      },
      {
        fontSize: PDF_FONT.tfootLabel,
        lineHeight: 1.15,
        paddingVertical: 8,
      },
      {
        fontSize: PDF_FONT.tfootLabelIncl,
        lineHeight: 1.15,
        paddingVertical: 9,
      },
    ],
  });

  // Footer is absolute; geometry.paddingBottom already clears it.
  const footerReserve = 0;

  return {
    geometry,
    chrome: {
      footerReserve,
      companyHeader: fullHeader,
      clientDetails: clientH,
      sectionHeading: sectionH,
      tableHeader,
      totals,
    },
  };
}

/** Measure once per row id — O(n), no repeated work across pack passes. */
export function measureExecutiveSummaryRows(
  rows: ExecutiveSummaryRow[],
): MeasuredUnit<ExecutiveSummaryRow>[] {
  const hasRemark = rows.some((r) => Boolean(r.remark));
  const cache = new Map<string, number>();

  return rows.map((row) => {
    let height = cache.get(row.id);
    if (height == null) {
      height = measureExecutiveSummaryRowHeight(row, hasRemark);
      cache.set(row.id, height);
    }
    return { id: row.id, height, data: row };
  });
}

export interface CorporateMinimalSummaryPagesResult {
  pages: BuiltTablePage<ExecutiveSummaryRow>[];
  geometry: PageGeometry;
  chrome: PageChromeHeights;
  hasRemark: boolean;
}

/**
 * Full pipeline for the Executive Pricing Summary table.
 * Page 1: full quotation chrome + thead + rows (+ totals if they fit).
 * Continuation: thead + rows + footer only (no company / client / title).
 *
 * Enable debug with: localStorage / env not wired — pass via buildTablePages options
 * when tuning: { debug: true }.
 */
export function buildCorporateMinimalSummaryPages(args: {
  data: TemplateData;
  rows: ExecutiveSummaryRow[];
  debug?: boolean;
}): CorporateMinimalSummaryPagesResult {
  const { chrome, geometry } = measureCorporateMinimalChrome({ data: args.data });
  const measured = measureExecutiveSummaryRows(args.rows);
  const hasRemark = args.rows.some((r) => Boolean(r.remark));

  const envDebug =
    typeof process !== 'undefined' &&
    process.env &&
    process.env.PDF_PAGINATION_DEBUG === '1';

  const pages = buildTablePages({
    geometry,
    chrome,
    continuationChrome: {
      companyHeader: 0,
      clientDetails: 0,
      sectionHeading: 0,
    },
    rows: measured,
    options: {
      minRowsPerPage: 2,
      repeatCompanyHeaderOnContinuation: false,
      debug: args.debug === true || envDebug,
    },
  });

  return { pages, geometry, chrome, hasRemark };
}
