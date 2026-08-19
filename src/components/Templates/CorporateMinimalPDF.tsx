/**
 * CorporateMinimalPDF.tsx
 *
 * React-PDF renderer for the Corporate Minimal template.
 * Receives the same TemplateData props as CorporateMinimal.tsx (screen preview)
 * plus `pdfData` (images / specs / reviews resolved by ReferenceImages.tsx).
 *
 * Replaces html2canvas + jsPDF pipeline entirely.
 */

import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  Link,
  Font,
  Svg,
  Path,
} from '@react-pdf/renderer';
import { TemplateData } from '../../types/template';
import { formatRecurringRateUnitLabel, formatUnitRateInr } from '../../utils/rateDisplay';
import { hyphenateLongWords } from '../../utils/hyphenateLongWords';
import { getSharedReviewIfAllSame } from '../../utils/reviewGrouping';
import { formatReviewerDisplayName } from '../../utils/reviewDisplay';
import { formatQuoteDate } from '../../utils/dateFormat';
import {
  isMultiServiceQuote,
  groupItemsByServiceType,
  DEFAULT_GENERAL_TERMS,
  getServiceGroupHeading,
  extractServiceType,
  buildExecutiveSummaryRows,
  buildPricingBreakdownLines,
  type ExecutiveSummaryRow,
} from '../../utils/quoteGrouping';
import { formatServiceHeadingDisplay } from '../../utils/serviceHeading';
import { resolveMergedDisplayTermEntries, groupDisplayTermsBySection, type DisplayTerm } from '../../utils/termsMerge';
import { s, C } from './CorporateMinimalPDF.styles';
import type { PdfSpecGroup } from '../../utils/metroSpecParser';
import { segmentBreakdownFormula } from '../../utils/breakdownFormulaDisplay';
import { collectServiceRemarks } from '../../utils/specMaterial';
import { buildCorporateMinimalSummaryPages } from '../../pdf/templates/corporateMinimalSummary';
import type { BuiltTablePage } from '../../pdf/types';

export type { PdfSpecGroup };

// ---------------------------------------------------------------------------
// Font registration â€” Calibri embedded as real vector font
// ---------------------------------------------------------------------------
Font.register({
  family: 'Calibri',
  fonts: [
    { src: '/fonts/Calibri.ttf', fontWeight: 400, fontStyle: 'normal' },
    { src: '/fonts/Calibri-Bold.ttf', fontWeight: 700, fontStyle: 'normal' },
    { src: '/fonts/Calibri-Italic.ttf', fontWeight: 400, fontStyle: 'italic' },
    { src: '/fonts/Calibri-BoldItalic.ttf', fontWeight: 700, fontStyle: 'italic' },
  ],
});

/** Disable English mid-word hyphenation (prevents brand-ing / chen-nai). */
Font.registerHyphenationCallback((word: string) => [word]);
// ---------------------------------------------------------------------------
// Service image data resolved by ReferenceImages.tsx
// ---------------------------------------------------------------------------
export interface ServicePdfData {
  serviceKey: string;   // matches groupKey used to look up images per service group
  refImages: string[];  // cropped reference image data URLs or Supabase URLs
  /** Natural pixel dimensions for each refImage — populated by prefetchImagesToBase64 */
  refImageDimensions?: Array<{ width: number; height: number }>;
  specImages: string[]; // spec diagram image URLs resolved by ReferenceImages.tsx
  specFields: Array<{ label: string; value: string }>;
  /** Full spec structure from ReferenceImages — includes metro coach tables */
  specGroups?: PdfSpecGroup[];
  review: {
    reviewerName: string;
    starCount: number;
    reviewText: string;
    reviewUrl: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type PdfExportMode = 'full' | 'summary' | 'detailed';

export interface CorporateMinimalPDFProps {
  data: TemplateData;
  /** Per-service image/spec/review data resolved by ReferenceImages.tsx */
  pdfData: ServicePdfData[];
  /**
   * Multi-service export layout:
   * - 'summary'  = executive summary → T&C → bank
   * - 'detailed' / 'full' = executive summary → service details → T&C → bank
   */
  exportMode?: PdfExportMode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

const formatRate = (amount: number) => formatUnitRateInr(amount);

const formatDate = (date: Date | string) => formatQuoteDate(date);

const ensureHttps = (url: string) => (url.startsWith('http') ? url : `https://${url}`);

const filterGSTDisplayTerms = (terms: DisplayTerm[]) =>
  terms.filter(
    (t) =>
      !/gst|tax\s*%|inclusive\s*of\s*(gst|tax)|exclusive\s*of\s*(gst|tax)|\+\s*gst|\d+\s*%\s*(gst|tax)/i.test(
        t.text,
      ),
  );

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const noHyphen = (word: string) => [word];

/**
 * SERVICE ID: wrap after kebab hyphens; also hyphen-break any segment longer than 13 chars
 * (e.g. Periyanayakanpalayam → Periyanayakan- / -palayam) so it never overflows the column.
 */
const ServiceIdText: React.FC<{ id: string }> = ({ id }) => {
  const prepared = hyphenateLongWords(id);
  const lines = prepared.split('\n');

  const renderKebabLine = (line: string, key: string | number) => {
    const rawParts = line.split('-');
    const segments: string[] = [];
    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i];
      if (part === '') continue;
      const prefix = i > 0 ? '-' : '';
      const suffix = i < rawParts.length - 1 ? '-' : '';
      segments.push(`${prefix}${part}${suffix}`);
    }
    if (segments.length === 0) {
      return (
        <Text key={key} style={s.serviceIdText} hyphenationCallback={noHyphen}>
          {line}
        </Text>
      );
    }
    if (segments.length === 1 && !line.includes('-')) {
      return (
        <Text key={key} style={s.serviceIdText} hyphenationCallback={noHyphen}>
          {segments[0]}
        </Text>
      );
    }
    return (
      <View key={key} style={s.serviceIdWrap}>
        {segments.map((seg, i) => (
          <Text key={`${seg}-${i}`} style={s.serviceIdText} hyphenationCallback={noHyphen}>
            {seg}
          </Text>
        ))}
      </View>
    );
  };

  if (lines.length === 1) {
    return renderKebabLine(lines[0], 'sid');
  }

  return (
    <View style={{ width: '100%', flexDirection: 'column', alignItems: 'flex-start' }}>
      {lines.map((line, i) => renderKebabLine(line, i))}
    </View>
  );
};

const isMaterialLabel = (label: string) => /^materials?$/i.test(label.trim());
const normalizeImageSrcs = (images: string[] = []) =>
  images
    .map((img) => (typeof img === 'string' ? img.trim() : ''))
    .filter((img) => img.length > 0 && img.toLowerCase() !== 'null' && img.toLowerCase() !== 'undefined');

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Fixed footer on every page */
const PageFooter: React.FC<{ company: TemplateData['company'] }> = ({ company }) => (
  <View style={s.footer} fixed>
    <View style={s.footerDivider} />
    <View style={s.footerContent}>
      {company.website && (
        <View style={s.footerItem}>
          <Image style={s.footerIcon} src="/icons/globe.png" />
          <Link style={s.footerLink} src={ensureHttps(company.website)}>
            {company.website}
          </Link>
        </View>
      )}
      {company.address && (
        <View style={s.footerItem}>
          <Image style={s.footerIcon} src="/icons/pin.png" />
          <Text style={s.footerText}>{company.address}</Text>
        </View>
      )}
    </View>
    <Text
      style={s.footerPageNum}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
    />
  </View>
);

/** Company logo + QUOTATION title + meta + header divider */
const Header: React.FC<{
  data: TemplateData;
  showMeta?: boolean;
  title?: string;
  /** Continuation pages: skip logo + QUOTATION title to maximize table fill. */
  compact?: boolean;
}> = ({ data, showMeta = true, title = 'QUOTATION', compact = false }) => {
  const { company, quote } = data;
  return (
    <View>
      {!compact && company.logo && (
        <View style={s.headerLogoRow}>
          <Image style={s.logo} src={company.logo} />
        </View>
      )}
      {!compact && showMeta && <Text style={s.quoteTitle}>{title}</Text>}
      <View style={s.headerInfoRow}>
        <View style={s.companyDetails}>
          {company.phone && (
            <Text>
              <Text>PHONE: </Text>
              <Link style={{ color: C.blue, textDecoration: 'none' }} src={`tel:${company.phone}`}>{company.phone}</Link>
            </Text>
          )}
          {company.email && (
            <Text>
              <Text>EMAIL: </Text>
              <Link style={{ color: C.blue, textDecoration: 'none', textTransform: 'none' }} src={`mailto:${company.email}`}>
                <Text style={{ textTransform: 'none' }}>{company.email}</Text>
              </Link>
            </Text>
          )}
          {company.gst && <Text>GST: {company.gst}</Text>}
          {company.abn && <Text>ABN: {company.abn}</Text>}
        </View>
        {showMeta && (
          <View style={s.quoteMeta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Quote Number:</Text>
              <Text style={s.metaValue}>{quote.quoteNumber}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Prepared Date:</Text>
              <Text style={s.metaValue}>{formatDate(quote.date)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Valid Until:</Text>
              <Text style={s.metaValue}>{formatDate(quote.validUntil)}</Text>
            </View>
          </View>
        )}
      </View>
      <View style={s.headerDivider} />
    </View>
  );
};

/** Client details — Name + Phone + Email only (no address / GST here). */
const ClientDetails: React.FC<{ client: TemplateData['client'] }> = ({ client }) => {
  const sep = { color: '#95a5a6' } as const;
  const fields: React.ReactNode[] = [];

  if (client.phone) {
    fields.push(
      <Text key="ph">
        <Text style={sep}> | </Text>
        <Text>PH: </Text>
        <Link style={{ color: C.blue, textDecoration: 'none' }} src={`tel:${client.phone}`}>
          {client.phone}
        </Link>
      </Text>,
    );
  }
  if (client.email) {
    fields.push(
      <Text key="em">
        <Text style={sep}> | </Text>
        <Text>Email: </Text>
        <Link
          style={{ color: C.blue, textDecoration: 'none', textTransform: 'none' }}
          src={`mailto:${client.email}`}
        >
          <Text style={{ textTransform: 'none' }}>{client.email}</Text>
        </Link>
      </Text>,
    );
  }

  return (
    <View style={s.clientSection}>
      <Text style={s.clientInlineRow}>
        <Text style={s.clientHeading}>Quote Prepared For: </Text>
        <Text style={s.clientName}>{(client.company || client.name || '').toUpperCase()}</Text>
        {fields}
      </Text>
    </View>
  );
};

/**
 * Executive summary table for one pre-built page from the pagination engine.
 * Header repeats only because each logical page is its own React-PDF <Page>.
 * One atomic wrap={false} table per page — never split rows onto headerless
 * overflow pages (that caused missing thead + one-row blanks).
 */
const ExecutiveSummaryTablePage: React.FC<{
  page: BuiltTablePage<ExecutiveSummaryRow>;
  hasRemark: boolean;
  subtotal: number;
  gstAmount: number;
  gstPct: number;
  totalInclGst: number;
  globalRowOffset: number;
}> = ({ page, hasRemark, subtotal, gstAmount, gstPct, totalInclGst, globalRowOffset }) => {
  const thead = (
    <>
      <View style={s.thead} wrap={false}>
        <Text style={[s.theadCell, s.colServiceId, { textAlign: 'left' }]} hyphenationCallback={noHyphen}>
          SERVICE & LOCATION
        </Text>
        <Text style={[s.theadCell, s.colQty]} hyphenationCallback={noHyphen}>{'REQ.\nQUANTITY'}</Text>
        <Text style={[s.theadCell, s.colDur, s.colDurHeader]} hyphenationCallback={noHyphen}>{'REQ.\nDURATION'}</Text>
        <Text style={[s.theadCell, s.colRecurring]} hyphenationCallback={noHyphen}>
          {'RECURRING\nCHARGE'}
        </Text>
        <Text style={[s.theadCell, s.colOnetime]} hyphenationCallback={noHyphen}>
          {'ONE TIME\nCHARGE'}
        </Text>
        <Text style={[s.theadCell, s.colAmount]} hyphenationCallback={noHyphen}>AMOUNT</Text>
        {hasRemark && (
          <Text style={[s.theadCell, { width: 40 }]} hyphenationCallback={noHyphen}>Remark</Text>
        )}
      </View>
      <View style={[s.thead, s.theadLettersRow]} wrap={false}>
        <View style={[s.theadLetterCellEmpty, s.colServiceId]} />
        <Text style={[s.theadLetterCell, s.colQty]} hyphenationCallback={noHyphen}>(A)</Text>
        <Text style={[s.theadLetterCell, s.colDur, s.colDurHeader]} hyphenationCallback={noHyphen}>(B)</Text>
        <Text style={[s.theadLetterCell, s.colRecurring]} hyphenationCallback={noHyphen}>(C)</Text>
        <Text style={[s.theadLetterCell, s.colOnetime]} hyphenationCallback={noHyphen}>(D)</Text>
        <Text style={[s.theadFormulaCell, s.colAmount]} hyphenationCallback={noHyphen}>
          (A×B×C)+(A×D)
        </Text>
        {hasRemark && <View style={{ width: 40 }} />}
      </View>
    </>
  );

  const renderRow = (row: ExecutiveSummaryRow, idx: number) => {
    const isAlt = idx % 2 === 1;
    const qtyUnit = row.quantityUnit
      ? `(${String(row.quantityUnit).replace(/^per\s+/i, '')})`
      : null;
    const durUnit =
      row.duration != null
        ? `(${row.durationLabel || (row.durationUnit === 'months' ? 'month' : 'days')})`
        : null;
    const rateUnit =
      row.requiringCharge > 0
        ? row.duration != null
          ? formatRecurringRateUnitLabel(row.ratePeriod, row.quantityUnit)
          : row.quantityUnit
            ? `(per ${String(row.quantityUnit).replace(/^per\s+/i, '')})`
            : null
        : null;
    const oneTimeUnit =
      row.oneTimeCharge > 0 && row.quantityUnit
        ? `(per\u00A0${String(row.quantityUnit).replace(/^per\s+/i, '')})`
        : null;

    return (
      <View key={row.id} style={isAlt ? [s.tbodyRow, s.tbodyRowAlt] : s.tbodyRow} wrap={false}>
        <View style={[s.tbodyCell, s.colServiceId, s.serviceIdCell]}>
          <ServiceIdText id={row.serviceId} />
        </View>
        <View style={[s.tbodyCell, s.colQty, s.cellStackCenter]}>
          <Text style={s.cellValueCenter} hyphenationCallback={noHyphen}>{row.quantity}</Text>
          {qtyUnit && (
            <Text style={[s.itemUnitLabel, { textAlign: 'center' }]} hyphenationCallback={noHyphen}>{qtyUnit}</Text>
          )}
        </View>
        <View style={[s.tbodyCell, s.colDur, s.cellStackCenter]}>
          <Text style={s.cellValueCenter} hyphenationCallback={noHyphen}>{row.duration ?? '\u2014'}</Text>
          {durUnit && (
            <Text style={[s.itemUnitLabel, { textAlign: 'center' }]} hyphenationCallback={noHyphen}>{durUnit}</Text>
          )}
        </View>
        <View style={[s.tbodyCell, s.colRecurring, s.cellStackRight]}>
          {row.requiringCharge > 0 ? (
            <>
              <Text style={s.cellValue} hyphenationCallback={noHyphen}>{formatRate(row.requiringCharge)}</Text>
              {rateUnit && (
                <Text style={[s.itemUnitLabel, { textAlign: 'right' }]} hyphenationCallback={noHyphen}>{rateUnit}</Text>
              )}
            </>
          ) : (
            <Text style={s.cellValue} hyphenationCallback={noHyphen}>{'\u2014'}</Text>
          )}
        </View>
        <View style={[s.tbodyCell, s.colOnetime, s.cellStackRight]}>
          {row.oneTimeCharge > 0 ? (
            <>
              <Text style={s.cellValue} hyphenationCallback={noHyphen}>{formatRate(row.oneTimeCharge)}</Text>
              {oneTimeUnit && (
                <Text style={[s.itemUnitLabel, { textAlign: 'right' }]} hyphenationCallback={noHyphen}>{oneTimeUnit}</Text>
              )}
            </>
          ) : (
            <Text style={s.cellValue} hyphenationCallback={noHyphen}>{'\u2014'}</Text>
          )}
        </View>
        <View style={[s.tbodyCell, s.colAmount, s.cellStackRight]}>
          <Text style={s.cellValue} hyphenationCallback={noHyphen}>
            {formatCurrency(row.amountExclGst)}
          </Text>
        </View>
        {hasRemark && (
          <Text style={[s.tbodyCell, { width: 40 }]} hyphenationCallback={noHyphen}>{row.remark || ''}</Text>
        )}
      </View>
    );
  };

  const renderTotalRow = (
    label: string,
    amount: number,
    opts?: { incl?: boolean; first?: boolean },
  ) => (
    <View
      style={
        opts?.incl
          ? [s.tfoot, s.tfootInclRow]
          : opts?.first
            ? [s.tfoot, s.tfootFirst]
            : [s.tfoot, s.tfootInclRow]
      }
    >
      <View style={s.tfootInner}>
        <Text
          style={opts?.incl ? [s.tfootLabelIncl, s.tfootLabelGap] : [s.tfootLabel, s.tfootLabelGap]}
          hyphenationCallback={noHyphen}
        >
          {label}
        </Text>
        <Text
          style={opts?.incl ? s.tfootAmount : s.tfootAmountExcl}
          hyphenationCallback={noHyphen}
        >
          {formatCurrency(amount)}
        </Text>
      </View>
      {hasRemark && <Text style={[s.tfootCell, { width: 40 }]} />}
    </View>
  );

  return (
    <View style={s.table} wrap={false}>
      {page.showTableHeader ? thead : null}
      {page.rows.map((unit, i) =>
        renderRow(unit.data, globalRowOffset + page.rowStartIndex + i),
      )}
      {page.showTotals ? (
        <>
          {renderTotalRow('Total (excl. GST)', subtotal, { first: true })}
          {renderTotalRow(`GST @ ${gstPct}%`, gstAmount)}
          {renderTotalRow('Total (incl. GST)', totalInclGst, { incl: true })}
        </>
      ) : null}
    </View>
  );
};


/** Per-service Pricing Breakdown — always one atomic block (heading + table).
 *  Prevents next-service title from overlapping previous table (biggest bug).
 */
const PricingBreakdownTable: React.FC<{
  items: TemplateData['quote']['items'];
  gstPercentage?: number;
  heading?: React.ReactNode;
}> = ({ items, gstPercentage = 18, heading }) => {
  const { lines, subtotal } = buildPricingBreakdownLines(items);
  const gstPct = gstPercentage > 0 ? gstPercentage : 18;
  const gstAmount = (subtotal * gstPct) / 100;
  const totalInclGst = subtotal + gstAmount;
  const detailLines = lines.filter((l) => l.kind !== 'subtotal');
  const hasDisplay = detailLines.some((l) => l.kind === 'display');
  const hasPF = detailLines.some((l) => l.kind === 'onetime');

  // Show combined Display + P&F total (excl. GST) only when both lines exist
  const summaryPairs: { label: string; amount: number; emph?: boolean }[] = [
    ...(hasDisplay && hasPF
      ? [{ label: 'Total (excl. GST)', amount: subtotal }]
      : []),
    { label: `GST @ ${gstPct}%`, amount: gstAmount },
    { label: 'Total (incl. GST)', amount: totalInclGst, emph: true },
  ];

  return (
    <View wrap={false} style={{ width: '100%' }}>
      {heading}
      <View style={s.table}>
        <View style={s.thead} wrap={false}>
          <Text style={[s.theadCell, s.breakdownTheadCell, s.colBreakdownDesc, { textAlign: 'left' }]} hyphenationCallback={noHyphen}>
            DESCRIPTION
          </Text>
          <Text style={[s.theadCell, s.breakdownTheadCell, s.colBreakdownAmount]} hyphenationCallback={noHyphen}>
            AMOUNT
          </Text>
        </View>

        {detailLines.map((line, idx) => {
          const isAlt = idx % 2 === 1;
          const title = line.descriptionLines[0] || '';
          const formula = line.descriptionLines.slice(1).join(' ') || null;

          const amountBlock = (
            <View style={s.breakdownAmountStack}>
              <Text style={s.breakdownAmountInline} hyphenationCallback={noHyphen}>
                {formatCurrency(line.amount)}
              </Text>
              <Text style={s.breakdownExclGstLabel} hyphenationCallback={noHyphen}>
                (excl.gst)
              </Text>
            </View>
          );

          return (
            <View
              key={`${line.kind}-${idx}`}
              style={isAlt ? [s.tbodyRow, s.tbodyRowAlt, s.breakdownDetailRow] : [s.tbodyRow, s.breakdownDetailRow]}
              wrap={false}
            >
              <View style={s.breakdownDetailBody}>
                {formula ? (
                  <>
                    <Text style={s.breakdownDescPrimary} hyphenationCallback={noHyphen}>
                      {title}
                    </Text>
                    <View style={s.breakdownFormulaRow}>
                      <Text style={s.breakdownDescSecondary} hyphenationCallback={noHyphen}>
                        {segmentBreakdownFormula(formula).map((seg, i) =>
                          seg.muted ? (
                            <Text key={i} style={s.breakdownRateUnit}>{seg.text}</Text>
                          ) : (
                            <Text key={i}>{seg.text}</Text>
                          ),
                        )}
                      </Text>
                      {amountBlock}
                    </View>
                  </>
                ) : (
                  <View style={s.breakdownFormulaRow}>
                    <Text style={[s.breakdownDescPrimary, { flex: 1, marginBottom: 0 }]} hyphenationCallback={noHyphen}>
                      {title}
                    </Text>
                    {amountBlock}
                  </View>
                )}
              </View>
            </View>
          );
        })}

        <View style={[s.tbodyRow, s.breakdownSummaryBlock]} wrap={false}>
          <View style={[s.colBreakdownDesc, s.breakdownSummaryLabels]}>
            {summaryPairs.map((p) => (
              <Text
                key={p.label}
                style={p.emph ? [s.breakdownSummaryLabelEmph, { fontSize: 21 }] : s.breakdownSummaryLabel}
                hyphenationCallback={noHyphen}
              >
                {p.label}
              </Text>
            ))}
          </View>
          <View style={[s.colBreakdownAmount, s.breakdownSummaryAmounts]}>
            {summaryPairs.map((p) => (
              <Text
                key={p.label}
                style={p.emph ? s.breakdownSummaryAmountEmph : s.breakdownSummaryAmount}
                hyphenationCallback={noHyphen}
              >
                {formatCurrency(p.amount)}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
};

/** Reference images — one image per row, full width stacked vertically.
 *  When imageDimensions are supplied (from prefetchImagesToBase64) we set an
 *  explicit height so React-PDF knows the block size at layout time, which
 *  allows wrap={false} to correctly move heading+first-image to the next page
 *  instead of clipping them.
 */
const FULL_IMG_W = 360;   // −3% from 371
const MAX_IMG_H = 285;   // −3% from 294

/** Compute rendered {width, height} capped to MAX_IMG_H with aspect ratio preserved */
const computeImgDims = (
  dims: { width: number; height: number } | undefined
): { width: number; height: number } | undefined => {
  if (!dims || dims.width === 0 || dims.height === 0) return undefined;
  let renderH = (dims.height / dims.width) * FULL_IMG_W;
  let renderW = FULL_IMG_W;
  if (renderH > MAX_IMG_H) {
    // Scale down proportionally so height fits within MAX_IMG_H
    renderH = MAX_IMG_H;
    renderW = (dims.width / dims.height) * MAX_IMG_H;
  }
  return { width: renderW, height: renderH };
};

const RefImages: React.FC<{
  images: string[];
  heading?: string;
  imageDimensions?: Array<{ width: number; height: number }>;
}> = ({ images, heading, imageDimensions }) => {
  const validImages = normalizeImageSrcs(images);
  if (validImages.length === 0) return null;
  const title = heading || undefined;

  const imgStyle = (idx: number): { width: number; height: number } => {
    const d = computeImgDims(imageDimensions?.[idx]);
    // If exact dimensions are missing, you MUST provide a fallback height
    // otherwise React-PDF thinks the image is 0px tall and only renders the label.
    return d ? { width: d.width, height: d.height } : { width: FULL_IMG_W, height: 333 };
  };

  // Compute minHeight for the heading+first-card group so Yoga evaluates
  // the full block size and wrap={false} correctly moves it to the next page.
  const HEADING_H = 32;  // approximate SubHeading height (margins + row + divider)
  const CARD_CHROME = 10;  // card padding(20) + label(14) + labelMarginBottom(6)
  const firstDims = computeImgDims(imageDimensions?.[0]);
  const groupMinH = firstDims ? (HEADING_H + CARD_CHROME + firstDims.height) : undefined;

  return (
    <View style={s.refImagesList} wrap={true}>
      {/* Invisible layout anchor — React-PDF needs a Text node so Image height / minHeight measure correctly */}
      <Text style={{ fontSize: 1, color: 'transparent', height: 1 }}> </Text>

      {/* Heading + first card grouped with minHeight so Yoga knows the total
          block size — wrap={false} can then correctly move both to next page */}
      <View wrap={false} style={groupMinH ? { minHeight: groupMinH } : {}}>
        {title && <SubHeading>{title}</SubHeading>}
        <View style={s.refImageCard}>
          <View style={s.imageCenter}>
            <Image style={imgStyle(0)} src={validImages[0]} />
          </View>
        </View>
      </View>
      {/* Remaining images — each card protected individually */}
      {validImages.slice(1).map((src, idx) => (
        <View key={idx + 1} style={s.refImageCard} wrap={false}>
          <View style={s.imageCenter}>
            <Image style={imgStyle(idx + 1)} src={src} />
          </View>
        </View>
      ))}
    </View>
  );
};

/** Specification fields — Material subgroup only when label is Material */
const SpecSection: React.FC<{
  fields: Array<{ label: string; value: string }>;
  remark?: string;
}> = ({ fields, remark }) => {
  const trimmedRemark = remark?.trim() || '';
  if ((!fields || fields.length === 0) && !trimmedRemark) return null;

  const materialStartIndex = fields.findIndex((f) => isMaterialLabel(f.label));
  const hasMaterialGroup = materialStartIndex >= 0;
  const topFields = hasMaterialGroup ? fields.slice(0, materialStartIndex) : fields;
  const materialFields = hasMaterialGroup ? fields.slice(materialStartIndex) : [];
  const totalRows = topFields.length + materialFields.length + (trimmedRemark ? 1 : 0);
  let rowIndex = 0;

  const rowStyle = () => {
    rowIndex += 1;
    return rowIndex === totalRows ? [s.specRow, s.specRowLast] : s.specRow;
  };

  const remarkRowStyle = () => {
    rowIndex += 1;
    const base = rowIndex === totalRows ? [s.specRemarkRow, s.specRowLast] : s.specRemarkRow;
    return base;
  };

  return (
    <View style={s.specTable}>
      {trimmedRemark ? (
        <View style={remarkRowStyle()}>
          <Text style={s.specLabel}>Remark</Text>
          <Text style={s.specRemarkValue}>
            {hyphenateLongWords(trimmedRemark, 36)}
          </Text>
        </View>
      ) : null}

      {topFields.map((f, i) => (
        <View key={`top-${i}`} style={rowStyle()}>
          <Text style={s.specLabel}>{f.label}</Text>
          <Text style={s.specValue}>{f.value}</Text>
        </View>
      ))}

      {hasMaterialGroup && (
        <View style={s.specSectionHeader}>
          <Text style={s.specSectionHeaderText}>MATERIAL</Text>
        </View>
      )}

      {materialFields.map((f, i) => (
        <View key={`material-${i}`} style={rowStyle()}>
          <Text style={s.specLabel}>{f.label}</Text>
          <Text style={s.specValue}>{f.value}</Text>
        </View>
      ))}
    </View>
  );
};

const hasSpecGroupContent = (groups?: PdfSpecGroup[]): boolean =>
  (groups?.some(
    (g) => (g.tableRows?.length ?? 0) > 0 || g.fields.length > 0,
  ) ?? false);

/** Render one spec group (metro table or field list) */
const SpecGroupBlock: React.FC<{ group: PdfSpecGroup }> = ({ group }) => {
  if (group.tableRows && group.tableRows.length > 0) {
    const colCount = Math.max(
      group.tableHeaders?.length ?? 0,
      ...group.tableRows.map((r) => r.length),
    );
    return (
      <View style={s.specCoachGroup} wrap={false}>
        {group.heading ? (
          <View style={s.specCoachHeading}>
            <Text style={s.specCoachHeadingText}>{group.heading.toUpperCase()}</Text>
          </View>
        ) : null}
        {group.tableHeaders && group.tableHeaders.length > 0 ? (
          <View style={s.specDataTableHeader}>
            {group.tableHeaders.map((h, hi) => (
              <Text
                key={`h-${hi}`}
                style={[
                  s.specDataTableHeaderCell,
                  hi === group.tableHeaders!.length - 1 ? s.specDataTableHeaderCellLast : {},
                ]}
              >
                {h.toUpperCase()}
              </Text>
            ))}
          </View>
        ) : null}
        {group.tableRows.map((row, ri) => {
          const cells = [...row];
          while (cells.length < colCount) cells.push('');
          return (
            <View
              key={`r-${ri}`}
              style={[
                s.specDataTableRow,
                ri % 2 === 1 ? s.specDataTableRowEven : {},
                ri === group.tableRows!.length - 1 ? s.specDataTableRowLast : {},
              ]}
            >
              {cells.slice(0, colCount).map((cell, ci) => (
                <Text
                  key={`c-${ci}`}
                  style={[
                    s.specDataTableCell,
                    ci === colCount - 1 ? s.specDataTableCellLast : {},
                  ]}
                >
                  {cell}
                </Text>
              ))}
            </View>
          );
        })}
      </View>
    );
  }

  const heading = group.heading?.trim() || '';
  const isMaterialGroup = /^materials?$/i.test(heading);
  const isContextHeading = /^(monthly\s+average\s+passenger\s+footfall|viewership\s+data|reach\s+data|passenger\s+data)$/i.test(
    heading,
  );
  const isSectionHeader = isMaterialGroup || isContextHeading;

  return (
    <View style={s.specTable} wrap={false}>
      {heading ? (
        isSectionHeader ? (
          <View style={s.specSectionHeader}>
            <Text style={s.specSectionHeaderText}>{heading.toUpperCase()}</Text>
          </View>
        ) : (
          <View style={s.specRow}>
            <Text style={s.specLabel}>{heading}</Text>
            <Text style={s.specValue} />
          </View>
        )
      ) : null}
      {group.fields.map((f, fi) => (
        <View
          key={`f-${fi}`}
          style={fi === group.fields.length - 1 ? [s.specRow, s.specRowLast] : s.specRow}
        >
          <Text style={s.specLabel}>{f.label}</Text>
          <Text style={s.specValue}>{f.value}</Text>
        </View>
      ))}
    </View>
  );
};

/** Metro coach tables + context field groups — each group flows independently */
const SpecGroupsSection: React.FC<{ groups: PdfSpecGroup[] }> = ({ groups }) => {
  if (!groups.length) return null;

  return (
    <View style={{ width: '100%', marginBottom: 10 }} wrap={true}>
      {groups.map((group, gi) => (
        <View key={`grp-${gi}`} style={{ marginBottom: 8 }}>
          <SpecGroupBlock group={group} />
        </View>
      ))}
    </View>
  );
};

/** Display specification diagrams */
const SPEC_COL_W = 259;  // (529 - 11 gap) / 2
const SPEC_IMG_W = 251;  // SPEC_COL_W - 4 padding left - 4 padding right
const SPEC_IMG_H = 138;  // proportional: 251 * (280/509) ≈ 138
const SPEC_COL_GAP = 11;   // gap between the two column cards

const SpecImages: React.FC<{ images: string[] }> = ({ images }) => {
  const validImages = normalizeImageSrcs(images);
  if (validImages.length === 0) return null;

  // Single image — full width
  if (validImages.length === 1) {
    return (
      <View style={s.specImagesList}>
        <View style={s.specImageCard} wrap={false}>
          <View style={s.specImageWrapper}>
            <Image style={s.specImageSingle} src={validImages[0]} />
          </View>
        </View>
      </View>
    );
  }

  // 2+ images — 2-column grid
  const pairs: string[][] = [];
  for (let i = 0; i < validImages.length; i += 2) {
    pairs.push(validImages.slice(i, i + 2));
  }

  return (
    <View style={s.specImagesList}>
      {pairs.map((pair, pairIdx) => (
        <View
          key={pairIdx}
          style={{ flexDirection: 'row', width: 529, marginBottom: 8 }}
          wrap={false}
        >
          {pair.map((url, colIdx) => (
            <View
              key={colIdx}
              style={[
                s.specImageCard,
                {
                  width: SPEC_COL_W,
                  marginBottom: 0,
                  marginRight: colIdx === 0 && pair.length === 2 ? SPEC_COL_GAP : 0,
                },
              ]}
            >
              <View style={{ width: SPEC_IMG_W }}>
                <Image
                  style={{ width: SPEC_IMG_W, height: SPEC_IMG_H, borderRadius: 3, objectFit: 'fill' }}
                  src={url}
                />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
};

/** Specification block: heading + table + images.
 *  Each coach table is an independent wrap={false} unit so tables flow onto
 *  leftover space after reference images instead of jumping as one giant block.
 */
const DisplaySpecificationBlock: React.FC<{
  heading: string;
  fields: Array<{ label: string; value: string }>;
  specGroups?: PdfSpecGroup[];
  images: string[];
  remark?: string;
}> = ({ heading, fields, specGroups, images, remark }) => {
  const validImages = normalizeImageSrcs(images);
  const hasGroups = hasSpecGroupContent(specGroups);
  const hasFields = !hasGroups && fields.length > 0;
  const trimmedRemark = remark?.trim() || '';
  if (!hasGroups && !hasFields && validImages.length === 0 && !trimmedRemark) return null;

  const groups = specGroups ?? [];
  const leadGroup = hasGroups && groups.length > 0 ? groups[0] : null;
  const tailGroups = hasGroups && groups.length > 1 ? groups.slice(1) : [];

  const firstBatch =
    validImages.length <= 1 ? validImages : validImages.slice(0, 2);
  const restImages =
    validImages.length <= 1 ? [] : validImages.slice(2);
  const specImagesAfterTables = (leadGroup || hasFields || trimmedRemark) && firstBatch.length > 0;

  const remarkRow = trimmedRemark ? (
    <View style={s.specTable}>
      <View style={[s.specRemarkRow, !(leadGroup || hasFields) ? s.specRowLast : {}]}>
        <Text style={s.specLabel}>Remark</Text>
        <Text style={s.specRemarkValue}>
          {hyphenateLongWords(trimmedRemark, 36)}
        </Text>
      </View>
    </View>
  ) : null;

  return (
    <View wrap={true}>
      {/* Heading stays with remark + first table/field block */}
      <View wrap={false}>
        <SubHeading>{heading}</SubHeading>
        {/* Remark first, then Width / Height / Length / other specs */}
        {hasGroups && trimmedRemark ? remarkRow : null}
        {leadGroup ? (
          <SpecGroupBlock group={leadGroup} />
        ) : hasFields ? (
          <SpecSection fields={fields} remark={trimmedRemark} />
        ) : trimmedRemark && !hasGroups ? (
          remarkRow
        ) : firstBatch.length > 0 ? (
          <SpecImages images={firstBatch} />
        ) : null}
      </View>

      {/* Remaining coach tables fill leftover page space one-by-one */}
      {tailGroups.length > 0 ? <SpecGroupsSection groups={tailGroups} /> : null}

      {specImagesAfterTables ? <SpecImages images={firstBatch} /> : null}
      {restImages.length > 0 ? <SpecImages images={restImages} /> : null}
    </View>
  );
};

const SubHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={s.subHeadingWrap}>
    <View style={s.subHeadingTopRow}>
      <View style={s.subHeadingBar} />
      <Text style={s.subHeading}>{children}</Text>
    </View>
    <View style={s.subHeadingDivider} />
  </View>
);

/** SVG star — filled or outline */
const StarIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <Svg width={10} height={10} viewBox="0 0 10 10">
    <Path
      d="M5 0.5L6.06 3.54L9.28 3.61L6.71 5.56L7.64 8.64L5 6.8L2.36 8.64L3.29 5.56L0.72 3.61L3.94 3.54Z"
      fill={filled ? '#f6ad55' : 'none'}
      stroke="#f6ad55"
      strokeWidth={0.6}
    />
  </Svg>
);

/** Star rating row */
const StarRating: React.FC<{ count: number }> = ({ count }) => (
  <View style={{ flexDirection: 'row', gap: 2 }}>
    {Array.from({ length: 5 }, (_, i) => (
      <StarIcon key={i} filled={i < count} />
    ))}
  </View>
);

/** Customer review box — matches .review-card in ReferenceImages.css */
const ReviewBox: React.FC<{ review: ServicePdfData['review'] }> = ({ review }) => {
  if (!review) return null;
  const displayName = formatReviewerDisplayName(review.reviewerName);
  const initial = displayName.charAt(0);
  return (
    <View style={s.reviewBox} wrap={false}>
      {/* Header: avatar + name + stars */}
      <View style={s.reviewHeader}>
        <View style={s.reviewAvatar}>
          <Text style={s.reviewAvatarText}>{initial}</Text>
        </View>
        <View style={s.reviewMeta}>
          <Text style={s.reviewName}>{displayName}</Text>
          <StarRating count={review.starCount} />
        </View>
      </View>
      {/* Body */}
      {review.reviewText && (
        <Text style={s.reviewText}>{review.reviewText}</Text>
      )}
      {review.reviewUrl && (
        <Link style={s.reviewLink} src={review.reviewUrl}>
          Click here to see the review
        </Link>
      )}
    </View>
  );
};

/** One T&C bullet — body only (section heading rendered separately). */
const TermRow: React.FC<{ term: DisplayTerm }> = ({ term }) => (
  <View style={s.termItem} wrap={false} minPresenceAhead={14}>
    <Text style={s.termBullet}>{'•'}</Text>
    <Text style={s.termText}>
      <Text style={s.termBody}>{term.text}</Text>
    </Text>
  </View>
);

/**
 * Terms & Conditions — main heading, then per-section headings
 * (General T&C / service name) with body-only bullets.
 * wrap={false} keeps each section heading + first bullet together.
 */
const TermsBlock: React.FC<{
  terms: DisplayTerm[];
  hideGeneralHeading?: boolean;
}> = ({ terms, hideGeneralHeading = false }) => {
  if (!terms || terms.length === 0) return null;
  const sections = groupDisplayTermsBySection(terms);
  if (sections.length === 0) return null;

  const [firstSection, ...restSections] = sections;
  const [firstTerm, ...firstRest] = firstSection.terms;
  const hasContinuation =
    firstRest.length > 0 || restSections.some((sec) => sec.terms.length > 0);

  const renderSectionBody = (
    section: { title: string; terms: DisplayTerm[] },
    opts: { includeHeading: boolean; terms: DisplayTerm[] },
  ) => (
    <>
      {opts.includeHeading ? (
        <Text style={s.termSectionHeading}>{section.title}</Text>
      ) : null}
      {opts.terms.map((term, i) => (
        <TermRow key={`${section.title}-${i}`} term={term} />
      ))}
    </>
  );

  return (
    <View>
      <View wrap={false}>
        <Text style={s.sectionHeading}>Terms & Conditions</Text>
        <View style={hasContinuation ? s.termsSectionStart : s.termsSection}>
          {firstTerm
            ? renderSectionBody(firstSection, {
                includeHeading: !(hideGeneralHeading && firstSection.title === 'General'),
                terms: [firstTerm],
              })
            : null}
        </View>
      </View>
      {hasContinuation ? (
        <View style={s.termsSectionContinued}>
          {firstRest.map((term, i) => (
            <TermRow key={`${firstSection.title}-rest-${i}`} term={term} />
          ))}
          {restSections.map((section) => {
            const [secFirst, ...secRest] = section.terms;
            return (
              <View key={section.title}>
                {secFirst ? (
                  <View wrap={false}>
                    {renderSectionBody(section, {
                      includeHeading: true,
                      terms: [secFirst],
                    })}
                  </View>
                ) : null}
                {secRest.map((term, i) => (
                  <TermRow key={`${section.title}-rest-${i}`} term={term} />
                ))}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
};

/** Bank details card — matches screen UI (title + rows in light card).
 *  wrap controlled by parent so Bank + system notice stay one atomic block.
 */
const BankDetails: React.FC = () => {
  const rows: { label: string; value: string }[] = [
    { label: 'HDFC Account Name', value: 'BALEEN MEDIA' },
    { label: 'Current Account Number', value: '99999566030153' },
    { label: 'IFSC', value: 'HDFC0001866' },
  ];

  return (
    <View style={s.bankCard}>
      <Text style={s.bankCardTitle}>Our Bank Details</Text>
      <View style={s.bankCardDivider} />
      {rows.map((row) => (
        <View key={row.label} style={s.bankRow} wrap={false}>
          <View style={s.bankLabelCol}>
            <Text style={s.bankLabel} wrap={false}>
              {row.label}
            </Text>
          </View>
          <Text style={s.bankColon} wrap={false}>
            :
          </Text>
          <Text style={s.bankValue} wrap={false}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Main document component
// ---------------------------------------------------------------------------
const CorporateMinimalPDF: React.FC<CorporateMinimalPDFProps> = ({ data, pdfData, exportMode = 'full' }) => {
  const { company, client, quote } = data;

  const isMultiService = quote.items.length > 0 && isMultiServiceQuote(quote.items);
  const serviceGroups = isMultiService ? groupItemsByServiceType(quote.items) : [];
  const mergedTermsList = filterGSTDisplayTerms(
    resolveMergedDisplayTermEntries(quote.termsAndConditions, quote.items, DEFAULT_GENERAL_TERMS),
  );

  /**
   * Resolve pdfData for a quote service. Keys may be city|name, service_id, or
   * kebab service ids — match flexibly so Display Spec is not lost.
   */
  const getPdfData = (
    serviceKey: string,
    opts?: { serviceId?: string; serviceName?: string; city?: string },
  ): ServicePdfData | null => {
    if (!pdfData.length) return null;
    const key = (serviceKey || '').toLowerCase().trim();
    const sid = (opts?.serviceId || '').toLowerCase().trim();
    const name = (opts?.serviceName || '').toLowerCase().trim();
    const city = (opts?.city || '').toLowerCase().trim();

    const exact = pdfData.find((d) => d.serviceKey.toLowerCase() === key);
    if (exact) return exact;
    if (sid) {
      const byId = pdfData.find((d) => d.serviceKey.toLowerCase() === sid);
      if (byId) return byId;
    }
    if (city && name) {
      const combo = `${city}|${name}`;
      const byCombo = pdfData.find((d) => d.serviceKey.toLowerCase() === combo);
      if (byCombo) return byCombo;
    }
    if (name) {
      const nameKebab = name.replace(/\s+/g, '-');
      const byName = pdfData.find((d) => {
        const k = d.serviceKey.toLowerCase();
        if (k.endsWith(`|${name}`)) return true;
        if (k.includes(nameKebab)) return true;
        return false;
      });
      if (byName) return byName;
    }
    // Only fall back to first entry for a one-entry catalog
    if (pdfData.length === 1) return pdfData[0];
    return null;
  };

  // ― SINGLE SERVICE ―
  if (!isMultiService) {
    const item0 = quote.items[0];
    const serviceType = formatServiceHeadingDisplay(
      item0?.serviceName || extractServiceType(item0?.description || ''),
    );
    const city0 = (item0?.city || '').trim().toLowerCase();
    const singleKey =
      city0 && city0 !== '\u2014'
        ? `${city0}|${serviceType.toLowerCase()}`
        : serviceType.toLowerCase();
    const singlePdf = getPdfData(singleKey, {
      serviceId: item0?.serviceId,
      serviceName: serviceType,
      city: city0,
    });

    return (
      <Document
        title={`Quote ${quote.quoteNumber}`}
        author="Baleen Media"
        creator="Quote Buddy"
      >
        <Page size="A4" style={s.page}>
          <View style={s.accentBar} fixed />
          <PageFooter company={company} />

          <Header
            data={data}
            title={exportMode === 'summary' ? 'Summarized quotation' : 'Detailed quotation'}
          />
          <ClientDetails client={client} />

          {/* Service name + Pricing Breakdown (no orphan heading) */}
          <PricingBreakdownTable
            items={quote.items}
            gstPercentage={quote.gstPercentage}
            heading={
              <View style={{ width: '100%' }}>
                <Text style={s.sectionHeading}>{serviceType}</Text>
                <SubHeading>1. Pricing Breakdown</SubHeading>
              </View>
            }
          />

          {/* Reference images + display spec share one flow so tables fill space below images */}
          {singlePdf && (
            <View wrap={true}>
              {normalizeImageSrcs(singlePdf.refImages).length > 0 && (
                <RefImages
                  images={singlePdf.refImages}
                  heading="2. Reference Image(s)"
                />
              )}
              <DisplaySpecificationBlock
                heading="3. Specification"
                fields={singlePdf.specFields}
                specGroups={singlePdf.specGroups}
                images={singlePdf.specImages || []}
                remark={collectServiceRemarks(quote.items)}
              />
            </View>
          )}

          {/* Customer review */}
          {singlePdf?.review && (
            <View wrap={false}>
              <SubHeading>4. Customer Review</SubHeading>
              <ReviewBox review={singlePdf.review} />
            </View>
          )}

          {/* One merged T&C — heading stays with at least the first bullet */}
          {mergedTermsList.length > 0 && <TermsBlock terms={mergedTermsList} />}

          {/* Bank + notice stay together (no orphan notice page) */}
          <View wrap={false}>
            <BankDetails />
            <View style={s.systemNotice}>
              <Text style={s.systemNoticeText}>
                This is a system-generated quotation and does not require a signature.
              </Text>
            </View>
          </View>
        </Page>
      </Document>
    );
  }

  // ── MULTI SERVICE ────────────────────────────────────────────────────────
  // Executive summary is pre-paginated (measure → pack → one <Page> per slice).
  // Detail sections / G.T&C follow on a separate wrapping page stream.
  const summaryRows = buildExecutiveSummaryRows(quote.items);
  const summarySubtotal = summaryRows.reduce((sum, r) => sum + r.amountExclGst, 0);
  const summaryGstPct = quote.gstPercentage > 0 ? quote.gstPercentage : 18;
  const summaryGstAmount = (summarySubtotal * summaryGstPct) / 100;
  const summaryTotalIncl = summarySubtotal + summaryGstAmount;
  const { pages: summaryPages, hasRemark: summaryHasRemark } =
    buildCorporateMinimalSummaryPages({ data, rows: summaryRows });

  // Resolve per-group reviews once — all identical → one block above bank details.
  const multiServiceReviews = serviceGroups.map((group) => {
    const city = group.city?.trim().toLowerCase();
    const serviceKey =
      city && city !== '\u2014'
        ? `${city}|${group.serviceType.toLowerCase()}`
        : group.serviceType.toLowerCase();
    const spd = getPdfData(serviceKey, {
      serviceId: group.items[0]?.serviceId,
      serviceName: group.serviceType,
      city,
    });
    return spd?.review ?? null;
  });
  const sharedReview = getSharedReviewIfAllSame(multiServiceReviews);

  const detailSections =
    exportMode !== 'summary'
      ? serviceGroups.map((group, idx) => {
          const heading = getServiceGroupHeading(group);
          const city = group.city?.trim().toLowerCase();
          const serviceKey = city && city !== '\u2014'
            ? `${city}|${group.serviceType.toLowerCase()}`
            : group.serviceType.toLowerCase();
          const spd = getPdfData(serviceKey, {
            serviceId: group.items[0]?.serviceId,
            serviceName: group.serviceType,
            city,
          });

          let sectionNum = 1;

          return (
            <View key={idx} style={{ width: '100%' }} wrap={true}>
              <PricingBreakdownTable
                items={group.items}
                gstPercentage={quote.gstPercentage}
                heading={
                  <View style={{ width: '100%' }}>
                    <Text style={s.sectionHeadingGroup}>{heading}</Text>
                    <SubHeading>{sectionNum++}. Pricing Breakdown</SubHeading>
                  </View>
                }
              />

              {spd && (
                normalizeImageSrcs(spd.refImages).length > 0 ||
                hasSpecGroupContent(spd.specGroups) ||
                spd.specFields.length > 0 ||
                normalizeImageSrcs(spd.specImages || []).length > 0 ||
                !!collectServiceRemarks(group.items)
              ) && (
                <View wrap={true}>
                  {normalizeImageSrcs(spd.refImages).length > 0 && (
                    <RefImages
                      images={spd.refImages}
                      heading={`${sectionNum++}. Reference Image(s)`}
                      imageDimensions={spd.refImageDimensions}
                    />
                  )}
                  {(hasSpecGroupContent(spd.specGroups) ||
                    spd.specFields.length > 0 ||
                    normalizeImageSrcs(spd.specImages || []).length > 0 ||
                    !!collectServiceRemarks(group.items)) && (
                    <DisplaySpecificationBlock
                      heading={`${sectionNum++}. Specification`}
                      fields={spd.specFields}
                      specGroups={spd.specGroups}
                      images={spd.specImages || []}
                      remark={collectServiceRemarks(group.items)}
                    />
                  )}
                </View>
              )}

              {/* Per-service review only when reviews are NOT all identical */}
              {!sharedReview && spd?.review && (
                <View wrap={false}>
                  <SubHeading>{sectionNum++}. Customer Review</SubHeading>
                  <ReviewBox review={spd.review} />
                </View>
              )}
            </View>
          );
        })
      : null;

  // Terms: heading + first bullet stay together; rest flow. Bank + notice atomic.
  const termsBlock =
    mergedTermsList.length > 0 ? <TermsBlock terms={mergedTermsList} /> : null;
  const generalTermsBlock = (() => {
    const generalTerms = filterGSTDisplayTerms(
      DEFAULT_GENERAL_TERMS.map((text) => ({ text, labels: [] })),
    );
    return generalTerms.length > 0 ? (
      <TermsBlock terms={generalTerms} hideGeneralHeading={exportMode === 'summary'} />
    ) : null;
  })();

  // When every service shares one review, show it once above bank details.
  const sharedReviewBlock = sharedReview ? (
    <View wrap={false}>
      <SubHeading>Customer Review</SubHeading>
      <ReviewBox review={sharedReview} />
    </View>
  ) : null;

  // Bank + notice stay one block; no minPresenceAhead (that left half-empty pages).
  const bankAndNotice = (
    <View wrap={false}>
      <BankDetails />
      <View style={s.systemNotice}>
        <Text style={s.systemNoticeText}>
          This is a system-generated quotation and does not require a signature.
        </Text>
      </View>
    </View>
  );

  return (
    <Document
      title={`Quote ${quote.quoteNumber}`}
      author="Baleen Media"
      creator="Quote Buddy"
    >
      {/* Executive summary pages stay pre-measured.
          Totals page packing:
          - Summary download: T&C → bank
          - Detailed/full: service details → shared review → T&C → bank */}
      {summaryPages.map((page) => (
        // Non-totals summary pages: wrap={false} so React-PDF cannot spawn
        // headerless overflow pages. Totals page must wrap (terms / details).
        <Page
          key={`summary-${page.pageNumber}`}
          size="A4"
          style={s.page}
          wrap={page.showTotals === true}
        >
          <View style={s.accentBar} fixed />
          <PageFooter company={company} />

          {page.showCompanyHeader && (
            <Header
              data={data}
              title={exportMode === 'summary' ? 'Summarized quotation' : 'Detailed quotation'}
            />
          )}
          {page.showClientDetails && <ClientDetails client={client} />}
          {page.showSectionHeading && (
            <Text style={s.sectionHeading}>Executive Pricing Summary</Text>
          )}
          <ExecutiveSummaryTablePage
            page={page}
            hasRemark={summaryHasRemark}
            subtotal={summarySubtotal}
            gstAmount={summaryGstAmount}
            gstPct={summaryGstPct}
            totalInclGst={summaryTotalIncl}
            globalRowOffset={0}
          />

          {page.showTotals && (
            <>
              {exportMode === 'summary' ? (
                <>
                  {generalTermsBlock}
                  {bankAndNotice}
                </>
              ) : (
                <>
                  {detailSections}
                  {sharedReviewBlock}
                  {termsBlock}
                  {bankAndNotice}
                </>
              )}
            </>
          )}
        </Page>
      ))}
    </Document>
  );
};

export default CorporateMinimalPDF;
