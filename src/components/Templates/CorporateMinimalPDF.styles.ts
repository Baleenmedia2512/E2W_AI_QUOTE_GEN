/**
 * CorporateMinimalPDF.styles.ts
 *
 * All styles converted from CorporateMinimal.css → React-PDF StyleSheet.
 *
 * Conversion rules:
 *   Outside table:  px × 0.75 = pt  (proportionally exact)
 *   Inside table:   px × 0.55 = pt  (scaled down to fit 529pt PDF content width)
 *   Gradients:      → flat backgroundColor (#1a3a5c)
 *   box-shadow:     → omitted (React-PDF unsupported)
 *   @media:         → omitted (PDF has no viewport)
 *   fontSize:       → PDF_FONT.* from CorporateMinimalPDF.fontSizes.ts
 *
 * A4 geometry:
 *   Page width:     595.28pt
 *   Margins:        33pt each side (44px × 0.75)
 *   Content width:  529.28pt
 */

import { StyleSheet } from '@react-pdf/renderer';
import { PDF_FONT } from './CorporateMinimalPDF.fontSizes';

// ── Colour tokens (exact from CorporateMinimal.css) ──────────────────────
export const C = {
  navy:            '#1a3a5c',
  navyDark:        '#1e4d78',
  blue:            '#2980b9',
  burgundy:        '#750926',
  darkHeading:     '#3b0a14',
  darkText:        '#1a1a2e',
  bodyText:        '#2d3436',
  mutedText:       '#636e72',
  bodyGrey:        '#555555',
  lightBg:         '#f0f4f8',
  clientBg:        '#f7f9fc',
  tableRowAlt:     '#fafbfc',
  tableBorder:     '#d0dce8',
  tableRowBorder:  '#b8c8d8',
  tableCellBorder: '#e8ecf1',
  tfootLabelColor: 'rgba(255,255,255,0.85)',
  white:           '#ffffff',
  divider:         '#b8d4e8',
  starColor:       '#f39c12',
  termsBg:         '#f7f9fc',
  noticeBg:        '#f0f7ff',
  noticeBorder:    '#b8d4e8',
};

export const s = StyleSheet.create({

  // ── Page ─────────────────────────────────────────────────────────────────
  // .template-corporate-minimal: padding 36px 44px 20px 44px
  page: {
    fontFamily: 'Calibri',
    fontSize: PDF_FONT.page,
    color: C.bodyText,
    paddingTop: 27,          // 36px × 0.75
    // Must clear fixed PageFooter (divider + contact row + page # ≈ 50–56pt).
    // 32pt was too tight — last body lines overlapped the footer.
    paddingBottom: 58,
    paddingLeft: 33,         // 44px × 0.75
    paddingRight: 33,
    backgroundColor: C.white,
  },

  // ::before height:5px — flat navy (gradient not supported)
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,               // 5px × 0.75
    backgroundColor: C.navy,
  },

  // ── Header ───────────────────────────────────────────────────────────────
  // .template-header: border-bottom:2px solid #1a3a5c margin-bottom:18px padding-bottom:16px
  header: {
    marginBottom: 14,        // 18px × 0.75
    paddingBottom: 12,       // 16px × 0.75
    borderBottomWidth: 2,
    borderBottomColor: C.navy,
  },

  // Divider line below header info row (2px solid #1a3a5c)
  headerDivider: {
    height: 2,
    backgroundColor: C.navy,
    marginBottom: 14,
  },

  // .header-logo-row: text-align:center margin-bottom:12px
  headerLogoRow: {
    alignItems: 'center',
    marginBottom: 9,         // 12px × 0.75
  },

  // .company-logo: max-width:420px max-height:190px
  logo: {
    maxWidth: 315,           // 420px × 0.75
    maxHeight: 143,          // 190px × 0.75
    objectFit: 'contain',
  },

  // .quote-title: font-size:27px weight:800 color:#1a3a5c letter-spacing:6px
  // margin: 18px 0 20px 0 text-align:center uppercase
  quoteTitle: {
    fontSize: PDF_FONT.quoteTitle,            // 27px × 0.75
    fontWeight: 700,
    color: C.navy,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 3,
    marginTop: 10,
    marginBottom: 11,
  },

  // .header-info-row: bg:#f0f4f8 border-radius:6px padding:14px 18px
  // display:flex justify:space-between align:center gap:24px
  headerInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.lightBg,
    borderRadius: 5,
    paddingVertical: 11,     // 14px × 0.75
    paddingHorizontal: 14,   // 18px × 0.75
  },

  // .company-details: font-size:18.5px color:#636e72 weight:600
  // line-height:1.7 uppercase letter-spacing:0.3px
  // Note: textTransform removed — email must stay lowercase, labels uppercased manually
  companyDetails: {
    flex: 1,
    fontSize: PDF_FONT.companyDetails,
    color: C.mutedText,
    fontWeight: 700,
    lineHeight: 1.7,
    letterSpacing: 0.3,
  },

  // .quote-meta: text-align:right border-left:2px solid #c0d0e0 padding-left:24px
  quoteMeta: {
    flex: 1,
    alignItems: 'flex-end',
    borderLeftWidth: 2,      // 2px — matches OLD exactly
    borderLeftColor: '#c0d0e0',
    paddingLeft: 18,         // 24px × 0.75
  },

  // .meta-details: font-size:20px line-height:1.7
  // .meta-row: margin-bottom:8px gap:10px
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 3,
    gap: 5,
  },

  // .meta-label: font-size:18.5px weight:600 color:#636e72 uppercase letter-spacing:0.3px
  metaLabel: {
    fontSize: PDF_FONT.metaLabel,
    fontWeight: 700,
    color: C.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },

  // .meta-value: font-size:20px weight:600 color:#1a3a5c
  metaValue: {
    fontSize: PDF_FONT.metaValue,
    fontWeight: 700,
    color: C.navy,
  },

  // ── Client Section ────────────────────────────────────────────────────────
  // .client-section: bg:#f7f9fc padding:18px 24px margin-bottom:18px
  // border-left:4px solid #2980b9 border-radius:0 6px 6px 0
  clientSection: {
    backgroundColor: C.clientBg,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: C.blue,
    borderTopRightRadius: 5, // 6px × 0.75 — right side only, matches OLD border-radius:0 6px 6px 0
    borderBottomRightRadius: 5,
  },

  clientInlineRow: {
    fontSize: PDF_FONT.clientDetail,
    color: C.bodyText,
    lineHeight: 1.6,
    textAlign: 'left',
  } as any,

  clientOverflowRow: {
    fontSize: PDF_FONT.clientDetail,
    color: C.bodyText,
    lineHeight: 1.6,
    textAlign: 'center',
    marginTop: 2,
  } as any,

  clientHeading: {
    fontSize: PDF_FONT.clientHeading,
    fontWeight: 700,
    color: C.blue,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  clientName: {
    fontSize: PDF_FONT.clientName,
    fontWeight: 700,
    color: C.navy,
  },

  clientDetail: {
    fontSize: PDF_FONT.clientDetail,
    color: C.bodyText,
    marginBottom: 4,
    lineHeight: 1.5,
  },

  // ── Section Headings ─────────────────────────────────────────────────────
  // Inline style in CorporateMinimal.tsx:
  // fontSize:20px weight:700 color:#3b0a14 center uppercase
  // letterSpacing:0.08em margin-bottom:18px padding-bottom:10px
  // border-bottom:2px solid #2980b9
  sectionHeading: {
    fontSize: PDF_FONT.sectionHeading,            // 20px × 0.75
    fontWeight: 700,
    color: C.darkHeading,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 14,        // 18px × 0.75
    marginTop: 6,
    paddingBottom: 8,        // 10px × 0.75
    borderBottomWidth: 2,
    borderBottomColor: C.blue,
  },

  // sectionHeadingGroup: identical to sectionHeading but uses C.burgundy (#750926)
  // for multi-service group headings (e.g. "Bus Full Branding", "Auto Semi Branding").
  // Applied in CorporateMinimalPDF.tsx — step 3.1 of the migration plan.
  sectionHeadingGroup: {
    fontSize: PDF_FONT.sectionHeadingGroup,            // 20px × 0.75
    fontWeight: 700,
    color: C.burgundy,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 14,        // 18px × 0.75
    marginTop: 6,
    paddingBottom: 8,        // 10px × 0.75
    borderBottomWidth: 2,
    borderBottomColor: C.blue,
  },

  // .smart-section-heading + .smart-heading-bar in ReferenceImages.css
  subHeadingWrap: {
    marginTop: 4,
    marginBottom: 6,
  },
  subHeadingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  subHeadingBar: {
    width: 3,
    // Match heading text height so the accent bar looks even
    height: PDF_FONT.subHeading + 2,
    borderRadius: 2,
    backgroundColor: C.blue,
    marginRight: 8,
    alignSelf: 'center',
  },
  subHeading: {
    fontSize: PDF_FONT.subHeading,
    fontWeight: 700,
    color: C.darkText,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    lineHeight: 1.2,
  },
  subHeadingDivider: {
    height: 1.5,
    backgroundColor: C.blue,
  },

  // ── Pricing Table ─────────────────────────────────────────────────────────
  // .items-table: border:1px solid #d0dce8 font-size:17.5px
  table: {
    width: '100%',
    marginBottom: 8,
    // Keep only vertical outer rails; horizontal row lines come from rows themselves.
    // This avoids full-width "cut" lines when table content flows across pages.
    borderLeftWidth: 0.85,
    borderRightWidth: 0.85,
    borderLeftColor: '#b8cbe0',
    borderRightColor: '#b8cbe0',
  },

  /** Split-table segments removed — single `table` only (avoids heading overlap) */

  // .items-table thead: bg linear-gradient(135deg,#1a3a5c,#1e4d78) → flat
  thead: {
    flexDirection: 'row',
    backgroundColor: C.navy,
  },

  // .items-table--gst th: padding:12px 8px font-size:19px uppercase letter-spacing:0.3px
  // border-right:1px solid rgba(255,255,255,0.2) → solid white for PDF
  // Table scale: 19px × 0.55 = 10.45pt
  theadCell: {
    color: C.white,
    fontSize: PDF_FONT.theadCell,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.1,
    lineHeight: 1.2,
    paddingVertical: 12,
    paddingHorizontal: 4,
    textAlign: 'right',
    borderRightWidth: 0.75,
    borderRightColor: '#6f92b3',
  },

  /** Second header row: A | B | C | D | (A×B×C)+(A×D) */
  theadLettersRow: {
    borderTopWidth: 0.75,
    borderTopColor: '#6f92b3',
  },
  theadLetterCell: {
    color: C.white,
    fontSize: 12,
    fontWeight: 700,
    paddingVertical: 7,
    paddingHorizontal: 4,
    textAlign: 'center',
    borderRightWidth: 0.75,
    borderRightColor: '#6f92b3',
    textTransform: 'none',
  },
  theadLetterCellEmpty: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRightWidth: 0.75,
    borderRightColor: '#6f92b3',
  },
  theadFormulaCell: {
    color: C.white,
    fontSize: PDF_FONT.theadFormula,
    fontWeight: 700,
    paddingVertical: 7,
    paddingHorizontal: 4,
    textAlign: 'right',
    borderRightWidth: 0.75,
    borderRightColor: '#6f92b3',
    textTransform: 'none',
    lineHeight: 1.25,
  },

  // .items-table tbody tr: border-bottom:1.5px solid #b8c8d8 min-height via padding
  tbodyRow: {
    flexDirection: 'row',
    // Row-owned top separator ensures the first row on a new page still has
    // a visible horizontal line (clean continuation after page breaks).
    borderTopWidth: 1,
    borderTopColor: C.tableRowBorder,
    // Closing edge so the last visible row before footer is clearly ended.
    borderBottomWidth: 1,
    borderBottomColor: C.tableRowBorder,
    minHeight: 38,
  },

  // tr:nth-child(even): bg:#fafbfc
  tbodyRowAlt: {
    backgroundColor: C.tableRowAlt,
  },

  // .items-table--gst td: padding:11px 8px font-size:18px
  // border-right:1px solid #e8ecf1 border-bottom:1.5px solid #b8c8d8
  // Table scale: 18px × 0.55 = 9.9pt
  tbodyCell: {
    fontSize: PDF_FONT.tbodyCell,
    color: C.bodyText,
    lineHeight: 1.2,
    paddingVertical: 8,
    paddingHorizontal: 4,
    textAlign: 'right',
    borderRightWidth: 0.6,
    borderRightColor: '#c1d2e3',
    justifyContent: 'center',
  },

  // .item-final: background:#e8f0fb color:#1a3a5c font-weight:700
  tbodyCellFinal: {
    fontSize: PDF_FONT.tbodyCellFinal,
    color: C.navy,
    fontWeight: 700,
    lineHeight: 1.2,
    paddingVertical: 12,
    paddingHorizontal: 7,
    textAlign: 'right',
    borderRightWidth: 0.35,
    borderRightColor: C.tableCellBorder,
    backgroundColor: '#e8f0fb',
  },

  // .item-title: font-size:18px → .items-table--gst .item-title: 18px
  // weight:600 color:#1a3a5c margin-bottom:3px
  itemTitle: {
    fontSize: PDF_FONT.itemTitle,
    fontWeight: 700,
    color: C.navy,
    lineHeight: 1.2,
    marginBottom: 2,
  },

  // .item-details: font-size:17px color:#636e72 line-height:1.5 margin-top:2px
  itemDetails: {
    fontSize: PDF_FONT.itemDetails,
    color: C.mutedText,
    lineHeight: 1.35,
    marginTop: 1,
  },

  // .item-unit-label: font-size:0.72em color:#636e72
  itemUnitLabel: {
    fontSize: PDF_FONT.itemUnitLabel,
    color: C.mutedText,
    marginTop: 1,
    lineHeight: 1.05,
    textAlign: 'right',
  },

  // .items-table tfoot: bg linear-gradient(135deg,#1a3a5c,#1e4d78) → flat
  // border-top:2px solid #1a3a5c
  tfoot: {
    flexDirection: 'row',
    backgroundColor: C.navy,
    borderTopWidth: 0,
    width: '100%',
  },

  /** Top edge only on first total row (separates from table body) */
  tfootFirst: {
    borderTopWidth: 2,
    borderTopColor: C.navy,
  },

  /** No bar line between excl / incl rows */
  tfootInclRow: {
    borderTopWidth: 0,
  },

  /** Label + amount on one row, right-aligned — avoids fixed-width clip of large INR totals */
  tfootInner: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 10,
  },

  tfootLabelWrap: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 4,
    paddingRight: 8,
  },

  tfootLabelGap: {
    marginRight: 16,
  },

  tfootLabel: {
    color: C.tfootLabelColor,
    fontSize: PDF_FONT.tfootLabel,
    fontWeight: 700,
    lineHeight: 1.15,
    paddingVertical: 8,
    paddingHorizontal: 0,
    textAlign: 'right',
    textTransform: 'none',
    letterSpacing: 0.2,
  },

  tfootLabelIncl: {
    color: C.white,
    fontSize: PDF_FONT.tfootLabelIncl,
    fontWeight: 800,
    lineHeight: 1.15,
    paddingVertical: 9,
    paddingHorizontal: 0,
    textAlign: 'right',
    textTransform: 'none',
    letterSpacing: 0.2,
  },

  tfootAmountExcl: {
    color: C.white,
    fontSize: PDF_FONT.tfootAmountExcl,
    fontWeight: 700,
    lineHeight: 1.15,
    paddingVertical: 8,
    paddingHorizontal: 0,
    textAlign: 'right',
    letterSpacing: 0.15,
  },

  tfootAmount: {
    color: C.white,
    fontSize: PDF_FONT.tfootAmount,
    fontWeight: 800,
    lineHeight: 1.15,
    paddingVertical: 9,
    paddingHorizontal: 0,
    textAlign: 'right',
    letterSpacing: 0.1,
  },

  /** @deprecated Prefer tfootInner — kept for any leftover refs */
  tfootAmountCol: {
    flexShrink: 0,
    paddingRight: 10,
    paddingLeft: 2,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  // Generic tfoot cell (empty cells)
  tfootCell: {
    color: C.white,
    fontSize: PDF_FONT.tfootCell,
    fontWeight: 700,
    lineHeight: 1.15,
    paddingVertical: 8,
    paddingHorizontal: 4,
    textAlign: 'right',
  },

  // ── Column Widths — give A–D room; service/amount share remaining (total ~529pt)
  colServiceId: { width: 100, textAlign: 'left' },
  colQty:       { width: 70, textAlign: 'center' },
  colDur:       { width: 74, textAlign: 'center' },
  /** Header-only: slight padding on DURATION label (values unchanged) */
  colDurHeader: { paddingRight: 2 },
  colRecurring: { width: 86, textAlign: 'right' },
  colOnetime:   { width: 80, textAlign: 'right' },
  colAmount:    { width: 119, textAlign: 'right', paddingRight: 10 },
  // Pricing Breakdown (per-service) — DESCRIPTION | AMOUNT
  colBreakdownDesc: { flex: 1, textAlign: 'left' },
  colBreakdownAmount: { width: 175, textAlign: 'right', paddingRight: 8 },
  /** Tighter header padding for breakdown only (does not affect Executive Summary) */
  breakdownTheadCell: {
    paddingVertical: 7.9, // −1.5% from 8
  },
  breakdownDescPrimary: {
    fontSize: PDF_FONT.cellValue,
    color: C.bodyText,
    fontWeight: 700,
    lineHeight: 1.28,
    marginBottom: 2,
  },
  breakdownDescSecondary: {
    flex: 1,
    fontSize: PDF_FONT.breakdownFormula, // ~1% smaller than cellValue
    color: C.bodyText,
    fontWeight: 700,
    lineHeight: 1.28,
    textAlign: 'left',
    paddingRight: 8,
  },
  breakdownDetailRow: {
    paddingVertical: 4.9, // −1.5% from 5
    paddingHorizontal: 4,
    minHeight: 0, // override tbodyRow minHeight: 34
  },
  breakdownDetailBody: {
    width: '100%',
    flexDirection: 'column',
  },
  /** Formula line + amount on one row so they align straight */
  breakdownFormulaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  breakdownAmountInline: {
    fontSize: PDF_FONT.cellValue,
    color: C.bodyText,
    fontWeight: 700,
    textAlign: 'right',
  },
  breakdownRateUnit: {
    fontSize: PDF_FONT.itemUnitLabel,
    fontWeight: 400,
    color: C.mutedText,
  },
  breakdownAmountStack: {
    width: 120,
    alignItems: 'flex-end',
  },
  breakdownExclGstLabel: {
    fontSize: PDF_FONT.itemUnitLabel,
    color: C.mutedText,
    textAlign: 'right',
    marginTop: 1,
  },
  /** Totals block inside Pricing Breakdown — match Executive Summary navy footer */
  breakdownSummaryBlock: {
    alignItems: 'flex-start',
    paddingVertical: 8,
    minHeight: 0,
    backgroundColor: C.navy,
  },
  breakdownSummaryLabels: {
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  breakdownSummaryAmounts: {
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  breakdownSummaryLabel: {
    fontSize: 15.5,
    color: C.tfootLabelColor,
    fontWeight: 700,
    textAlign: 'right',
    lineHeight: 1.35,
    marginBottom: 1,
  },
  breakdownSummaryAmount: {
    fontSize: 17.5,
    color: C.white,
    fontWeight: 700,
    textAlign: 'right',
    lineHeight: 1.35,
    marginBottom: 1,
  },
  breakdownSummaryLabelEmph: {
    fontSize: 24,
    color: C.white,
    fontWeight: 800,
    textAlign: 'right',
    lineHeight: 1.35,
    marginBottom: 0,
    marginTop: 6,
  },
  breakdownSummaryAmountEmph: {
    fontSize: PDF_FONT.tfootAmount,
    color: C.white,
    fontWeight: 800,
    textAlign: 'right',
    lineHeight: 1.35,
    marginBottom: 0,
    marginTop: 2,
  },
  // Legacy aliases kept for any remaining references
  colDesc:   { flex: 1, textAlign: 'left' },
  colRate:   { width: 75 },
  colGstPct: { width: 46 },

  /** Service ID cell — multi-line wrap, vertically centered in row */
  serviceIdCell: {
    textAlign: 'left',
    alignItems: 'flex-start',
    justifyContent: 'center',
    flexShrink: 1,
  },

  /** Row of kebab segments that wrap inside the column */
  serviceIdWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    alignItems: 'flex-start',
  },

  /** One kebab segment (e.g. "bus-", "branding-") — never mid-word split */
  serviceIdText: {
    fontSize: PDF_FONT.serviceIdText,
    fontWeight: 700,
    color: C.navy,
    lineHeight: 1.05,
  },

  /** Numeric cell stack (value + unit) — horizontally right, vertically centered */
  cellStackRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  /** Numeric cell stack — horizontally + vertically centered */
  cellStackCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  cellValue: {
    fontSize: PDF_FONT.cellValue,
    fontWeight: 700,
    color: C.bodyText,
    textAlign: 'right',
    lineHeight: 1.2,
  },
  cellValueCenter: {
    fontSize: PDF_FONT.cellValue,
    fontWeight: 700,
    color: C.bodyText,
    textAlign: 'center',
    lineHeight: 1.2,
  },

  // ── Reference Images ─────────────────────────────────────────────────────
  imageCenter: {
  width: '100%',
  alignItems: 'center',
},
  
  refImagesList: {
    width: 529,
    marginBottom: 4,
  },
  refImageCard: {
    width: 529,
    borderWidth: 0.75,
    borderColor: '#d6e0ec',
    borderRadius: 5,
    padding: 5,
    marginBottom: 4,
    backgroundColor: '#ffffff',
  },
  refImageLabel: {
    fontSize: PDF_FONT.refImageLabel,
    color: '#4a5568',
    fontWeight: 700,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  // Centering wrapper: explicit width so yoga never collapses it.
  // alignItems:'center' here only affects the Image child, not the label.
  refImageCenterWrapper: {
    width: 509,
  },
  refImageSingle: {
    width: 400,
    height: 400,
    objectFit: 'cover',
  },
  refImageSingleHero: {
    width: 400,
    height: 400,
    objectFit: 'cover',
  },
  refImageWrapper: {
    width: 509,
  },
  refImageWrapperHero: {
    width: 509,
  },

  specImagesList: {
    width: '100%',
    marginBottom: 10,
  },
  specImageCard: {
    width: 529,
    borderWidth: 0.75,
    borderColor: '#dce8f5',
    borderRadius: 4,
    padding: 4,
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  specImageSingle: {
    width: 509,
    height: 280,
    borderRadius: 3,
    objectFit: 'fill',
  },
  specImageWrapper: {
    width: 509,
  },

  // ── Spec Table ────────────────────────────────────────────────────────────
  specTable: {
    width: '100%',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#dce8f5',
    borderRadius: 4.5,
    backgroundColor: '#f7f9fc',
    overflow: 'hidden',
    paddingBottom: 6,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderBottomWidth: 0.75,
    borderBottomColor: '#e4ecf5',
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  specLabel: {
    width: 140,
    fontSize: PDF_FONT.specLabel,
    fontWeight: 700,
    color: '#4a5568',
    paddingRight: 12,
  },
  specRowLast: {
    borderBottomWidth: 0,
  },
  specValue: {
    flex: 1,
    fontSize: PDF_FONT.specValue,
    color: '#1a202c',
  },
  /** Multi-line remark value — wraps long / unbroken text */
  specRemarkValue: {
    flex: 1,
    fontSize: PDF_FONT.specValue,
    color: '#1a202c',
    lineHeight: 1.4,
  },
  specRemarkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 0.75,
    borderBottomColor: '#e4ecf5',
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  specSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.navy,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 0.75,
    borderBottomColor: '#dce8f5',
  },
  specSectionHeaderText: {
    fontSize: PDF_FONT.specSectionHeaderText,
    fontWeight: 700,
    color: C.white,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // ── Metro coach tables (matches ReferenceImages.css spec-data-table) ────────
  specCoachGroup: {
    width: '100%',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#d0e4f5',
    borderRadius: 3,
    overflow: 'hidden',
  },
  specCoachHeading: {
    backgroundColor: '#eef5fb',
    borderBottomWidth: 1,
    borderBottomColor: '#d0e4f5',
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  specCoachHeadingText: {
    fontSize: PDF_FONT.specCoachHeading,
    fontWeight: 700,
    color: '#1a3a5c',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  specDataTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a3a5c',
    borderBottomWidth: 1,
    borderBottomColor: '#1e4d78',
  },
  specDataTableHeaderCell: {
    flex: 1,
    fontSize: PDF_FONT.specDataTableHeader,
    fontWeight: 600,
    color: C.white,
    paddingVertical: 5,
    paddingHorizontal: 9,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.2)',
  },
  specDataTableHeaderCellLast: {
    borderRightWidth: 0,
    textAlign: 'center',
  },
  specDataTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.75,
    borderBottomColor: '#e4ecf5',
    backgroundColor: C.white,
  },
  specDataTableRowEven: {
    backgroundColor: '#f7f9fc',
  },
  specDataTableRowLast: {
    borderBottomWidth: 0,
  },
  specDataTableCell: {
    flex: 1,
    fontSize: PDF_FONT.specDataTableCell,
    color: '#1a202c',
    paddingVertical: 4.5,
    paddingHorizontal: 9,
    borderRightWidth: 0.75,
    borderRightColor: '#e4ecf5',
  },
  specDataTableCellLast: {
    borderRightWidth: 0,
    textAlign: 'center',
    fontWeight: 600,
  },

  // ── Customer Review ───────────────────────────────────────────────────────
  // Matches .review-card in ReferenceImages.css exactly:
  // bg:#ffffff border:1px solid #e2e8f0 border-radius:8px padding:16px 20px
  reviewBox: {
    backgroundColor: '#ffffff',
    borderRadius: 6,             // 8px × 0.75
    paddingVertical: 8,         // 16px × 0.75
    paddingHorizontal: 12,       // 20px × 0.75
    marginBottom: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  // .review-header: flex row align:center gap:12px margin-bottom:10px
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,                      // 12px × 0.75
    marginBottom: 7,             // 10px × 0.75
  },
  // .review-avatar: 36×36px border-radius:50% bg:#2980b9 white initial
  reviewAvatar: {
    width: 27,                   // 36px × 0.75
    height: 27,
    borderRadius: 13.5,          // 50%
    backgroundColor: '#2980b9',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  reviewAvatarText: {
    fontSize: PDF_FONT.reviewAvatarText,                // 16px × 0.75
    fontWeight: 700,
    color: '#ffffff',
    textAlign: 'center',
  },
  // .review-meta: flex column gap:2px
  reviewMeta: {
    flexDirection: 'column',
    gap: 2,
  },
  // .review-name: font-size:14px weight:600 color:#1a202c
  reviewName: {
    fontSize: PDF_FONT.reviewName,              // 14px × 0.75
    fontWeight: 700,
    color: '#1a202c',
    marginBottom: 1,
  },
  // .review-stars: font-size:14px color:#f6ad55 letter-spacing:1px
  reviewStars: {
    fontSize: PDF_FONT.reviewStars,
    color: '#f6ad55',
    letterSpacing: 0.75,
  },
  // .review-body: font-size:13px color:#4a5568 line-height:1.6 margin:0 0 12px 0
  reviewText: {
    fontSize: PDF_FONT.reviewText,                // 13px × 0.75 = 9.75 → 10pt
    color: '#4a5568',
    lineHeight: 1.6,
    marginBottom: 3,             // 12px × 0.75
  },
  // .review-link: font-size:13px color:#2980b9 underline weight:500
  reviewLink: {
    fontSize: PDF_FONT.reviewLink,
    color: '#2980b9',
    textDecoration: 'underline',
    fontWeight: 500,
  },

  // ── Terms Section ─────────────────────────────────────────────────────────
  // .terms-section: margin-top:24px margin-bottom:14px padding:16px 20px
  // bg:#f7f9fc border-radius:6px
  termsSection: {
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: C.termsBg,
    borderRadius: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  /** First chunk (with heading) — flat bottom so it joins the continuation box. */
  termsSectionStart: {
    marginTop: 4,
    marginBottom: 0,
    backgroundColor: C.termsBg,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 8,
    paddingBottom: 2,
    paddingHorizontal: 12,
  },

  /** Remaining bullets — flat top, same fill (reads as one container). */
  termsSectionContinued: {
    marginTop: 0,
    marginBottom: 4,
    backgroundColor: C.termsBg,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    paddingTop: 2,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },

  // Pack like table rows — tight vertical rhythm
  termItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 1,
    paddingVertical: 1,
  },

  termBullet: {
    width: 10,
    fontSize: PDF_FONT.termBullet,
    color: C.blue,
    fontWeight: 700,
    marginTop: 1,
  },

  termText: {
    flex: 1,
    fontSize: PDF_FONT.termText,
    color: C.bodyGrey,
    lineHeight: 1.25,
  },

  termServiceLabel: {
    fontSize: PDF_FONT.termText,
    color: C.burgundy,
    fontWeight: 700,
    lineHeight: 1.25,
  },

  /** Section title once per group (General T&C / Mobile Van Chennai). */
  termSectionHeading: {
    fontSize: PDF_FONT.termText,
    color: C.burgundy,
    fontWeight: 700,
    lineHeight: 1.25,
    marginTop: 4,
    marginBottom: 2,
  },

  termBody: {
    fontSize: PDF_FONT.termText,
    color: C.bodyGrey,
    fontWeight: 500,
    lineHeight: 1.25,
  },

  // ── Bank Details card ─────────────────────────────────────────────────────
  bankCard: {
    width: '100%',
    marginTop: 8,
    marginBottom: 10,
    paddingVertical: 10,
    // Match the preview card's breathing room and keep the aligned
    // three-column bank table away from the card edge.
    paddingHorizontal: 40,
    backgroundColor: '#f4f7fb',
    borderWidth: 1,
    borderColor: '#d6e0ec',
    borderRadius: 8,
  },
  bankCardTitle: {
    fontSize: PDF_FONT.sectionHeading,
    fontWeight: 700,
    color: C.darkHeading,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  bankCardDivider: {
    height: 2,
    backgroundColor: C.blue,
    marginBottom: 8,
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
    width: '100%',
  },
  /** Fixed label column — keeps colon/value vertically aligned (single line). */
  bankLabelCol: {
    width: 190,
    flexGrow: 0,
    flexShrink: 0,
  },
  bankLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    color: C.darkText,
    textAlign: 'right',
  },
  bankColon: {
    width: 24,
    fontSize: 11.5,
    fontWeight: 700,
    color: C.darkText,
    textAlign: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
  bankValue: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 11.5,
    color: C.bodyText,
    textAlign: 'left',
    paddingLeft: 12,
  },
  bankLine: {
    fontSize: 11.5,
    marginBottom: 5,
    color: C.darkText,
    lineHeight: 1.4,
  },
  bankLineLabel: {
    fontWeight: 700,
    color: C.darkText,
  },
  bankLineValue: {
    fontWeight: 400,
    color: C.bodyText,
  },

  // ── System Generated Notice ───────────────────────────────────────────────
  systemNotice: {
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: C.noticeBg,
    borderWidth: 1,
    borderColor: C.noticeBorder,
    borderLeftWidth: 3,
    borderLeftColor: C.navy,
    borderRadius: 4,
  },
  systemNoticeText: {
    fontSize: PDF_FONT.systemNoticeText,
    color: C.navy,
    fontWeight: 500,
    letterSpacing: 0.2,
    lineHeight: 1.2,
    textAlign: 'center',
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  // .company-contact-footer: padding-top:12px
  // footer-divider: height:1px bg:linear-gradient(transparent,#b8d4e8,transparent)
  // footer-content: flex justify:center gap:16px font-size:7px
  // footer-item: inline-flex align:center gap:6px
  footer: {
    position: 'absolute',
    bottom: 8,
    left: 33,
    right: 33,
  },
  footerDivider: {
    height: 1,
    backgroundColor: C.divider,
    marginBottom: 8,         // 10px × 0.75
    width: '70%',
    alignSelf: 'center',
  },
  footerContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    gap: 12,                 // 16px × 0.75
    marginBottom: 3,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,                  // 6px × 0.75
  },
  footerIcon: {
    width: 9,
    height: 9,
  },
  footerText: {
    fontSize: PDF_FONT.footerText,             // CSS says 7px
    color: C.mutedText,
  },
  footerLink: {
    fontSize: PDF_FONT.footerLink,
    color: C.blue,
    textDecoration: 'none',
  },
  footerPageNum: {
    textAlign: 'center',
    fontSize: PDF_FONT.footerPageNum,             // CSS .footer-page-number: font-size:8px
    fontWeight: 700,
    color: C.mutedText,
  },
});
