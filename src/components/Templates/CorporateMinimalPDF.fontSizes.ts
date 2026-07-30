/**
 * CorporateMinimalPDF.fontSizes.ts
 *
 * PDF typography sizes ONLY (pt). Tune readability here without touching
 * layout / colors in CorporateMinimalPDF.styles.ts.
 *
 * Usage:
 *   import { PDF_FONT } from './CorporateMinimalPDF.fontSizes';
 *   fontSize: PDF_FONT.theadCell
 *
 * Current scale: base × 1.5 × 1.03 (+3%)
 */

export const PDF_FONT = {
  // Page default
  page: 15.45,

  // Header
  quoteTitle: 27.2,
  companyDetails: 13.39,
  metaLabel: 13.91,
  metaValue: 13.91,

  // Client block
  clientHeading: 17,
  clientName: 18.54,
  clientDetail: 15.97,

  // Section headings
  sectionHeading: 23.18,
  sectionHeadingGroup: 23.18,
  subHeading: 13.15, // was 14.94 (+8%) — e.g. "1. Pricing Breakdown"

  // Executive pricing table / breakdown headers
  theadCell: 13.35, // was 12.36 (+8%) — DESCRIPTION | AMOUNT
  tbodyCell: 17,
  tbodyCellFinal: 19.31,
  itemTitle: 18.54,
  itemDetails: 17,
  itemUnitLabel: 10.3,
  serviceIdText: 16.74,
  cellValue: 15.02, // was 13.91 (+8%)
  /** Pricing breakdown formula (e.g. ₹899 × 50) — ~1% under cellValue */
  breakdownFormula: 14.87, // was 13.77 (+8%)

  // Totals footer
  tfootLabel: 17,
  tfootLabelIncl: 24,
  tfootAmountExcl: 20.09,
  tfootAmount: 24,
  tfootCell: 18.54,

  // Reference images
  refImageLabel: 13.91,

  // Spec table
  specLabel: 15.45,
  specValue: 15.45,
  specSectionHeaderText: 13.13,

  // Metro multi-table spec
  specCoachHeading: 11.25,
  specDataTableHeader: 10.31,
  specDataTableCell: 11.25,

  // Customer review
  reviewAvatarText: 18.54,
  reviewName: 14.25,
  reviewStars: 16.22,
  reviewText: 12.4,
  reviewLink: 13.91,

  // Terms & bank
  termBullet: 13.91,
  termText: 13.91,
  bankLabel: 15.5,
  bankValue: 15.5,

  // Notices / page footer
  systemNoticeText: 11.33,
  footerText: 10.82,
  footerLink: 10.82,
  footerPageNum: 10.82,

  /** Inline badge / misc (CorporateMinimalPDF.tsx) */
  imageIndexBadge: 10.82,
} as const;

export type PdfFontKey = keyof typeof PDF_FONT;
