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
 *
 * A4 geometry:
 *   Page width:     595.28pt
 *   Margins:        33pt each side (44px × 0.75)
 *   Content width:  529.28pt
 */

import { StyleSheet } from '@react-pdf/renderer';

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
    fontSize: 10,
    color: C.bodyText,
    paddingTop: 27,          // 36px × 0.75
    paddingBottom: 64,       // reserve extra safe area above fixed footer to avoid overlap/cut
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
    fontSize: 20,            // 27px × 0.75
    fontWeight: 700,
    color: C.navy,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 4,        // 6px → 4pt
    marginTop: 14,           // 18px × 0.75
    marginBottom: 15,        // 20px × 0.75
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
    fontSize: 10,
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
    marginBottom: 6,         // 8px × 0.75
    gap: 8,                  // 10px × 0.75
  },

  // .meta-label: font-size:18.5px weight:600 color:#636e72 uppercase letter-spacing:0.3px
  metaLabel: {
    fontSize: 10,            // 18.5px × 0.75 → scaled
    fontWeight: 700,
    color: C.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // .meta-value: font-size:20px weight:600 color:#1a3a5c
  metaValue: {
    fontSize: 11,            // 20px × 0.75 = 15pt → scaled
    fontWeight: 700,
    color: C.navy,
  },

  // ── Client Section ────────────────────────────────────────────────────────
  // .client-section: bg:#f7f9fc padding:18px 24px margin-bottom:18px
  // border-left:4px solid #2980b9 border-radius:0 6px 6px 0
  clientSection: {
    backgroundColor: C.clientBg,
    paddingVertical: 14,     // 18px × 0.75
    paddingHorizontal: 18,   // 24px × 0.75
    marginBottom: 14,        // 18px × 0.75
    borderLeftWidth: 4,
    borderLeftColor: C.blue,
    borderTopRightRadius: 5, // 6px × 0.75 — right side only, matches OLD border-radius:0 6px 6px 0
    borderBottomRightRadius: 5,
  },

  // .client-section h3: font-size:20px weight:700 color:#2980b9
  // uppercase letter-spacing:1.5px margin-bottom:10px
  clientHeading: {
    fontSize: 11,            // 20px × 0.75 = 15pt → scaled
    fontWeight: 700,
    color: C.blue,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,         // 10px × 0.75
  },

  // .client-name: font-size:21px weight:700 color:#1a3a5c margin-bottom:5px
  clientName: {
    fontSize: 14,            // 21px × 0.75 = 15.75pt → 14pt
    fontWeight: 700,
    color: C.navy,
    marginBottom: 4,         // 5px × 0.75
  },

  // .client-details: font-size:20.5px line-height:1.5
  // .client-details p: margin:5px 0
  clientDetail: {
    fontSize: 11,            // 20.5px × 0.75 = 15.4pt → scaled
    color: C.bodyText,
    marginBottom: 4,         // 5px × 0.75
    lineHeight: 1.5,
  },

  // ── Section Headings ─────────────────────────────────────────────────────
  // Inline style in CorporateMinimal.tsx:
  // fontSize:20px weight:700 color:#3b0a14 center uppercase
  // letterSpacing:0.08em margin-bottom:18px padding-bottom:10px
  // border-bottom:2px solid #2980b9
  sectionHeading: {
    fontSize: 15,            // 20px × 0.75
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
    fontSize: 15,            // 20px × 0.75
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
    marginTop: 12,
    marginBottom: 11,
  },
  subHeadingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  subHeadingBar: {
    width: 3,
    height: 12,
    borderRadius: 2,
    backgroundColor: C.blue,
    marginRight: 8,
  },
  subHeading: {
    fontSize: 11,
    fontWeight: 700,
    color: C.darkText,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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
    borderWidth: 0.75,
    borderColor: C.tableBorder,
  },

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
    fontSize: 11.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    lineHeight: 1.1,
    paddingVertical: 12,
    paddingHorizontal: 7,
    textAlign: 'right',
    borderRightWidth: 0.6,
    borderRightColor: '#4a7aab',  // subtle blue-grey on navy bg — approximates rgba(255,255,255,0.2)
  },

  // .items-table tbody tr: border-bottom:1.5px solid #b8c8d8 min-height via padding
  tbodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.tableRowBorder,
    minHeight: 34,
  },

  // tr:nth-child(even): bg:#fafbfc
  tbodyRowAlt: {
    backgroundColor: C.tableRowAlt,
  },

  // .items-table--gst td: padding:11px 8px font-size:18px
  // border-right:1px solid #e8ecf1 border-bottom:1.5px solid #b8c8d8
  // Table scale: 18px × 0.55 = 9.9pt
  tbodyCell: {
    fontSize: 12,
    color: C.bodyText,
    lineHeight: 1.2,
    paddingVertical: 12,
    paddingHorizontal: 7,
    textAlign: 'right',
    borderRightWidth: 0.35,
    borderRightColor: C.tableCellBorder,
  },

  // .item-final: background:#e8f0fb color:#1a3a5c font-weight:700
  tbodyCellFinal: {
    fontSize: 12.5,
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
    fontSize: 12,
    fontWeight: 700,
    color: C.navy,
    lineHeight: 1.2,
    marginBottom: 2,
  },

  // .item-details: font-size:17px color:#636e72 line-height:1.5 margin-top:2px
  itemDetails: {
    fontSize: 11,
    color: C.mutedText,
    lineHeight: 1.35,
    marginTop: 1,
  },

  // .item-unit-label: font-size:0.72em font-style:italic color:#636e72
  itemUnitLabel: {
    fontSize: 9,
    color: C.mutedText,
    marginTop: 1,
  },

  // .items-table tfoot: bg linear-gradient(135deg,#1a3a5c,#1e4d78) → flat
  // border-top:2px solid #1a3a5c
  tfoot: {
    flexDirection: 'row',
    backgroundColor: C.navy,
    borderTopWidth: 2,
    borderTopColor: C.navy,
  },

  // .tfoot-label: padding:13px 16px font-size:14.5px weight:700
  // color:rgba(255,255,255,0.85) uppercase letter-spacing:0.4px
  // Table scale: 14.5px × 0.55 = 7.975pt
  tfootLabel: {
    color: C.tfootLabelColor,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.15,
    paddingVertical: 12,
    paddingHorizontal: 12,   // 16px × 0.75
    textAlign: 'left',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // .tfoot-incl: padding:12px 16px font-size:21.5px weight:800
  // color:#ffffff letter-spacing:0.3px
  // Table scale: 21.5px × 0.55 = 11.825pt
  tfootAmount: {
    color: C.white,
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.15,
    paddingVertical: 12,
    paddingHorizontal: 12,
    textAlign: 'right',
    letterSpacing: 0.3,
  },

  // Generic tfoot cell (empty cells)
  tfootCell: {
    color: C.white,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.15,
    paddingVertical: 12,
    paddingHorizontal: 6,
    textAlign: 'right',
  },

  // ── Column Widths ────────────────────────────────────────────────────────
  // .items-table--gst CSS percentages applied to 529pt content width
  // desc:26% qty:9% rate:13% dur:10% gst:7% final:16%
  colDesc:   { flex: 1, textAlign: 'left' },   // ~208pt (remaining)
  colQty:    { width: 46 },
  colRate:   { width: 75 },
  colDur:    { width: 78 },
  colGstPct: { width: 46 },
  colAmount: { width: 92 },

  // ── Reference Images ─────────────────────────────────────────────────────
  refImagesList: {
    width: 529,
    marginBottom: 10,
  },
  refImageCard: {
    width: 529,
    borderWidth: 0.75,
    borderColor: '#d6e0ec',
    borderRadius: 5,
    padding: 10,
    marginBottom: 14,
    backgroundColor: '#ffffff',
  },
  refImageLabel: {
    fontSize: 9,
    color: '#4a5568',
    fontWeight: 700,
    marginBottom: 6,
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
    fontSize: 10,
    fontWeight: 700,
    color: '#4a5568',
    paddingRight: 12,
  },
  specRowLast: {
    borderBottomWidth: 0,
  },
  specValue: {
    flex: 1,
    fontSize: 10,
    color: '#1a202c',
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
    fontSize: 8.5,
    fontWeight: 700,
    color: C.white,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // ── Customer Review ───────────────────────────────────────────────────────
  // Matches .review-card in ReferenceImages.css exactly:
  // bg:#ffffff border:1px solid #e2e8f0 border-radius:8px padding:16px 20px
  reviewBox: {
    backgroundColor: '#ffffff',
    borderRadius: 6,             // 8px × 0.75
    paddingVertical: 12,         // 16px × 0.75
    paddingHorizontal: 15,       // 20px × 0.75
    marginBottom: 8,
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
    fontSize: 12,                // 16px × 0.75
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
    fontSize: 10.5,              // 14px × 0.75
    fontWeight: 700,
    color: '#1a202c',
    marginBottom: 1,
  },
  // .review-stars: font-size:14px color:#f6ad55 letter-spacing:1px
  reviewStars: {
    fontSize: 10.5,
    color: '#f6ad55',
    letterSpacing: 0.75,
  },
  // .review-body: font-size:13px color:#4a5568 line-height:1.6 margin:0 0 12px 0
  reviewText: {
    fontSize: 10,                // 13px × 0.75 = 9.75 → 10pt
    color: '#4a5568',
    lineHeight: 1.6,
    marginBottom: 9,             // 12px × 0.75
  },
  // .review-link: font-size:13px color:#2980b9 underline weight:500
  reviewLink: {
    fontSize: 9,
    color: '#2980b9',
    textDecoration: 'underline',
    fontWeight: 500,
  },

  // ── Terms Section ─────────────────────────────────────────────────────────
  // .terms-section: margin-top:24px margin-bottom:14px padding:16px 20px
  // bg:#f7f9fc border-radius:6px
  termsSection: {
    marginTop: 18,           // 24px × 0.75
    marginBottom: 11,        // 14px × 0.75
    backgroundColor: C.termsBg,
    borderRadius: 5,
    paddingVertical: 12,     // 16px × 0.75
    paddingHorizontal: 15,   // 20px × 0.75
  },

  // .terms-section li: font-size:14.5px color:#555 padding:5px 0
  // line-height:1.45 gap:12px
  termItem: {
    flexDirection: 'row',
    marginBottom: 4,         // 5px × 0.75
    gap: 9,                  // 12px × 0.75
  },

  // .bullet-dot: width:5px height:5px border-radius:50% bg:#2980b9
  termBullet: {
    fontSize: 11,
    color: C.blue,
    fontWeight: 700,
    marginTop: 0.5,
  },

  termText: {
    flex: 1,
    fontSize: 11,            // 14.5px × 0.75 = 10.9pt
    color: C.bodyGrey,
    lineHeight: 1.45,
  },

  // ── Bank Details ──────────────────────────────────────────────────────────
  bankTable: {
    width: '100%',
    marginBottom: 10,
  },
  bankRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  bankLabel: {
    width: '35%',
    fontSize: 11,
    fontWeight: 700,
    color: C.darkText,
  },
  bankValue: {
    flex: 1,
    fontSize: 11,
    color: C.bodyText,
  },

  // ── System Generated Notice ───────────────────────────────────────────────
  // .system-generated-notice: margin-top:32px padding:20px 28px
  // bg:linear-gradient(#f0f7ff,#e8f4f8) → flat
  // border:1px solid #b8d4e8 border-left:4px solid #1a3a5c
  // border-radius:8px text-align:center
  // p: font-size:16px color:#1a3a5c weight:500 letter-spacing:0.3px line-height:1.6
  systemNotice: {
    marginTop: 24,           // 32px × 0.75
    paddingVertical: 15,     // 20px × 0.75
    paddingHorizontal: 21,   // 28px × 0.75
    backgroundColor: C.noticeBg,
    borderWidth: 1,
    borderColor: C.noticeBorder,
    borderLeftWidth: 4,
    borderLeftColor: C.navy,
    borderRadius: 6,
    textAlign: 'center',
  },
  systemNoticeText: {
    fontSize: 12,            // 16px × 0.75
    color: C.navy,
    fontWeight: 500,
    letterSpacing: 0.3,
    lineHeight: 1.6,
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
    fontSize: 7,             // CSS says 7px
    color: C.mutedText,
  },
  footerLink: {
    fontSize: 7,
    color: C.blue,
    textDecoration: 'none',
  },
  footerPageNum: {
    textAlign: 'center',
    fontSize: 7,             // CSS .footer-page-number: font-size:8px
    fontWeight: 700,
    color: C.mutedText,
  },
});
