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
import {
  isMultiServiceQuote,
  groupItemsByServiceType,
  DEFAULT_GENERAL_TERMS,
  getServiceGroupHeading,
  normalizeTermsList,
  resolveGeneralTermsList,
  quoteHasMultipleCities,
  formatQuoteItemDescription,
  extractServiceType,
} from '../../utils/quoteGrouping';
import { formatDurationLabel, quoteHasAnyDuration } from '../../utils/durationUtils';
import { s, C } from './CorporateMinimalPDF.styles';

// ---------------------------------------------------------------------------
// Font registration â€” Calibri embedded as real vector font
// ---------------------------------------------------------------------------
Font.register({
  family: 'Calibri',
  fonts: [
    { src: '/fonts/Calibri.ttf',          fontWeight: 400, fontStyle: 'normal' },
    { src: '/fonts/Calibri-Bold.ttf',     fontWeight: 700, fontStyle: 'normal' },
    { src: '/fonts/Calibri-Italic.ttf',   fontWeight: 400, fontStyle: 'italic' },
    { src: '/fonts/Calibri-BoldItalic.ttf', fontWeight: 700, fontStyle: 'italic' },
  ],
});

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
export interface CorporateMinimalPDFProps {
  data: TemplateData;
  /** Per-service image/spec/review data resolved by ReferenceImages.tsx */
  pdfData: ServicePdfData[];
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

const formatRate = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(amount);

const formatDate = (date: Date | string) => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
};

const ensureHttps = (url: string) => (url.startsWith('http') ? url : `https://${url}`);

const filterGSTTerms = (terms: string[]) =>
  terms.filter(
    (t) =>
      !/gst|tax\s*%|inclusive\s*of\s*(gst|tax)|exclusive\s*of\s*(gst|tax)|\+\s*gst|\d+\s*%\s*(gst|tax)/i.test(t),
  );

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const noHyphen = (word: string) => [word];

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
const Header: React.FC<{ data: TemplateData; showMeta?: boolean }> = ({
  data,
  showMeta = true,
}) => {
  const { company, quote } = data;
  return (
    <View>
      {company.logo && (
        <View style={s.headerLogoRow}>
          <Image style={s.logo} src={company.logo} />
        </View>
      )}
      {showMeta && <Text style={s.quoteTitle}>QUOTATION</Text>}
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
              <Text style={s.metaLabel}>Date:</Text>
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

/** Client details block */
const ClientDetails: React.FC<{ client: TemplateData['client'] }> = ({ client }) => (
  <View style={s.clientSection}>
    <Text style={s.clientHeading}>Quote Prepared For:</Text>
    <Text style={s.clientName}>{(client.company || client.name).toUpperCase()}</Text>
    {client.email && (
      <Text style={s.clientDetail}>
        <Text>Email: </Text>
        <Link style={{ color: C.blue, textDecoration: 'none' }} src={`mailto:${client.email}`}>{client.email}</Link>
      </Text>
    )}
    {client.phone && (
      <Text style={s.clientDetail}>
        <Text>Phone: </Text>
        <Link style={{ color: C.blue, textDecoration: 'none' }} src={`tel:${client.phone}`}>{client.phone}</Link>
      </Text>
    )}
    {client.address && <Text style={s.clientDetail}>Address: {client.address}</Text>}
    {client.gst && <Text style={s.clientDetail}>GST: {client.gst}</Text>}
  </View>
);

/** Pricing table â€” thead repeats on page break automatically */
const PricingTable: React.FC<{
  items: TemplateData['quote']['items'];
  gstEnabled: boolean;
  gstPct: number;
  prefixCity?: boolean;
}> = ({ items, gstEnabled, gstPct, prefixCity = false }) => {
  const hasDuration = quoteHasAnyDuration(items);
  const hasRemark = items.some((i) => i.remark);
  const visibleItems = items.filter((i) => i.rate !== 0 || i.total !== 0);
  const subtotal = visibleItems.reduce((sum, i) => sum + i.total, 0);
  const gstAmt = gstEnabled ? subtotal * gstPct / 100 : 0;
  const inclGST = subtotal + gstAmt;

  const thead = (
    <View style={s.thead}>
      <Text style={[s.theadCell, s.colDesc]} hyphenationCallback={noHyphen}>DESCRIPTION</Text>
      <Text style={[s.theadCell, s.colQty]} hyphenationCallback={noHyphen}>QTY</Text>
      <Text style={[s.theadCell, s.colRate]} hyphenationCallback={noHyphen}>{'UNIT\u00A0RATE'}</Text>
      {hasDuration && <Text style={[s.theadCell, s.colDur]} hyphenationCallback={noHyphen}>DURATION</Text>}
      {gstEnabled && <Text style={[s.theadCell, s.colGstPct]} hyphenationCallback={noHyphen}>{'GST\u00A0%'}</Text>}
      <View style={[s.theadCell, s.colAmount]}>
        <Text style={{ fontWeight: 700, fontSize: 11 }} hyphenationCallback={noHyphen}>AMOUNT</Text>
        <Text style={{ fontSize: 8.5, opacity: 0.85, fontWeight: 400, textTransform: 'none' }} hyphenationCallback={noHyphen}>(incl.GST)</Text>
      </View>
      {hasRemark && <Text style={[s.theadCell, { width: 50 }]} hyphenationCallback={noHyphen}>Remark</Text>}
    </View>
  );

  return (
    <View style={s.table}>
      {thead}
      {visibleItems.slice(0, -1).map((item, idx) => {
        const itemGST = gstEnabled ? item.total * gstPct / 100 : 0;
        const itemFinal = item.total + itemGST;
        const isAlt = idx % 2 === 1;
        const descText = formatQuoteItemDescription(item, prefixCity)
          .replace(/\s*\([^)]*\)/g, '')
          .trim();
        return (
          <View key={item.id} style={isAlt ? [s.tbodyRow, s.tbodyRowAlt] : s.tbodyRow} wrap={false}>
            <View style={[s.tbodyCell, s.colDesc, { textAlign: 'left' }]}>
              <Text style={s.itemTitle}>{descText}</Text>
              {item.details && (
                <Text style={s.itemDetails}>{item.details}</Text>
              )}
            </View>
            <View style={[s.tbodyCell, s.colQty]}>
              <Text>{item.quantity}</Text>
              {item.quantityUnit && (
                <Text style={s.itemUnitLabel}>
                  ({cap(item.quantityUnit)})
                </Text>
              )}
            </View>
            <Text style={[s.tbodyCell, s.colRate]}>{formatRate(item.rate)}</Text>
            {hasDuration && (
              <View style={[s.tbodyCell, s.colDur]}>
                <Text>{item.duration ?? '\u2014'}</Text>
                {item.duration && (
                  <Text style={s.itemUnitLabel}>
                    ({item.durationUnit === 'days' ? 'Day' : 'Mon'})
                  </Text>
                )}
              </View>
            )}
            {gstEnabled && <Text style={[s.tbodyCell, s.colGstPct]}>{gstPct}%</Text>}
            <Text style={[gstEnabled ? s.tbodyCellFinal : s.tbodyCell, s.colAmount]}>
              {gstEnabled ? formatCurrency(itemFinal) : formatCurrency(item.total)}
            </Text>
            {hasRemark && (
              <Text style={[s.tbodyCell, { width: 50 }]}>{item.remark || ''}</Text>
            )}
          </View>
        );
      })}
      {/* Keep last line item + TOTAL together to avoid awkward page splits */}
      <View wrap={false}>
        {visibleItems.length > 0 && (() => {
          const item = visibleItems[visibleItems.length - 1];
          const idx = visibleItems.length - 1;
          const itemGST = gstEnabled ? item.total * gstPct / 100 : 0;
          const itemFinal = item.total + itemGST;
          const isAlt = idx % 2 === 1;
          const descText = formatQuoteItemDescription(item, prefixCity)
            .replace(/\s*\([^)]*\)/g, '')
            .trim();
          return (
            <View style={isAlt ? [s.tbodyRow, s.tbodyRowAlt] : s.tbodyRow}>
              <View style={[s.tbodyCell, s.colDesc, { textAlign: 'left' }]}>
                <Text style={s.itemTitle}>{descText}</Text>
                {item.details && (
                  <Text style={s.itemDetails}>{item.details}</Text>
                )}
              </View>
              <View style={[s.tbodyCell, s.colQty]}>
                <Text>{item.quantity}</Text>
                {item.quantityUnit && (
                  <Text style={s.itemUnitLabel}>
                    ({cap(item.quantityUnit)})
                  </Text>
                )}
              </View>
              <Text style={[s.tbodyCell, s.colRate]}>{formatRate(item.rate)}</Text>
              {hasDuration && (
                <View style={[s.tbodyCell, s.colDur]}>
                  <Text>{item.duration ?? '\u2014'}</Text>
                  {item.duration && (
                    <Text style={s.itemUnitLabel}>
                      ({item.durationUnit === 'days' ? 'Day' : 'Mon'})
                    </Text>
                  )}
                </View>
              )}
              {gstEnabled && <Text style={[s.tbodyCell, s.colGstPct]}>{gstPct}%</Text>}
              <Text style={[gstEnabled ? s.tbodyCellFinal : s.tbodyCell, s.colAmount]}>
                {gstEnabled ? formatCurrency(itemFinal) : formatCurrency(item.total)}
              </Text>
              {hasRemark && (
                <Text style={[s.tbodyCell, { width: 50 }]}>{item.remark || ''}</Text>
              )}
            </View>
          );
        })()}
        <View style={s.tfoot}>
          <Text style={[s.tfootLabel, s.colDesc, { flex: hasDuration ? 4 : 3 }]}>
            TOTAL
          </Text>
          {hasDuration && <View style={{ width: 0 }} />}
          {gstEnabled && <Text style={[s.tfootCell, s.colGstPct]} />}
          <Text style={[s.tfootAmount, s.colAmount]}>
            {gstEnabled ? formatCurrency(inclGST) : formatCurrency(subtotal)}
          </Text>
          {hasRemark && <Text style={[s.tfootCell, { width: 50 }]} />}
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
const FULL_IMG_W  = 509;   // 529 - 10 - 10 (single-image card)
const MAX_IMG_H   = 500;   // cap for portrait images — prevents overflow past page height

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
  const title = heading ? `${heading} (${validImages.length})` : undefined;

  const imgStyle = (idx: number): { width: number; height?: number } => {
    const d = computeImgDims(imageDimensions?.[idx]);
    return d ? { width: d.width, height: d.height } : { width: FULL_IMG_W };
  };

  // Compute minHeight for the heading+first-card group so Yoga evaluates
  // the full block size and wrap={false} correctly moves it to the next page.
  const HEADING_H   = 46;  // approximate SubHeading height (margins + row + divider)
  const CARD_CHROME = 40;  // card padding(20) + label(14) + labelMarginBottom(6)
  const firstDims   = computeImgDims(imageDimensions?.[0]);
  const groupMinH   = firstDims ? (HEADING_H + CARD_CHROME + firstDims.height) : undefined;

  return (
    <View style={s.refImagesList}>
      {/* Heading + first card grouped with minHeight so Yoga knows the total
          block size — wrap={false} can then correctly move both to next page */}
      <View wrap={false} style={groupMinH ? { minHeight: groupMinH } : {}}>
        {title && <SubHeading>{title}</SubHeading>}
        <View style={s.refImageCard}>
          <Text style={s.refImageLabel}>Image 1</Text>
          <Image style={imgStyle(0)} src={validImages[0]} />
        </View>
      </View>
      {/* Remaining images — each card protected individually */}
      {validImages.slice(1).map((src, idx) => (
        <View key={idx + 1} style={s.refImageCard} wrap={false}>
          <Text style={s.refImageLabel}>{`Image ${idx + 2}`}</Text>
          <Image style={imgStyle(idx + 1)} src={src} />
        </View>
      ))}
    </View>
  );
};

/** Display specification fields */
const SpecSection: React.FC<{ fields: Array<{ label: string; value: string }> }> = ({ fields }) => {
  if (!fields || fields.length === 0) return null;

  const materialStartIndex = fields.findIndex((f) => isMaterialLabel(f.label));
  const hasMaterialGroup = materialStartIndex >= 0;
  const topFields = hasMaterialGroup ? fields.slice(0, materialStartIndex) : fields;
  const materialFields = hasMaterialGroup ? fields.slice(materialStartIndex) : [];
  const totalRows = topFields.length + materialFields.length;
  let rowIndex = 0;

  const rowStyle = () => {
    rowIndex += 1;
    return rowIndex === totalRows ? [s.specRow, s.specRowLast] : s.specRow;
  };

  return (
    <View style={s.specTable}>
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

/** Display specification diagrams */
const SPEC_COL_W   = 259;  // (529 - 11 gap) / 2
const SPEC_IMG_W   = 251;  // SPEC_COL_W - 4 padding left - 4 padding right
const SPEC_IMG_H   = 138;  // proportional: 251 * (280/509) ≈ 138
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

/** Display specification block: heading + table + images */
const DisplaySpecificationBlock: React.FC<{
  heading: string;
  fields: Array<{ label: string; value: string }>;
  images: string[];
}> = ({ heading, fields, images }) => {
  const validImages = normalizeImageSrcs(images);
  const hasFields = fields.length > 0;
  if (!hasFields && validImages.length === 0) return null;

  return (
    <View>
      <View wrap={false}>
        <SubHeading>{heading}</SubHeading>
        {hasFields && <SpecSection fields={fields} />}
      </View>
      {/* All spec images go through SpecImages for consistent 2×2 grid */}
      {validImages.length > 0 && <SpecImages images={validImages} />}
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
  const initial = review.reviewerName.charAt(0).toUpperCase();
  return (
    <View style={s.reviewBox} wrap={false}>
      {/* Header: avatar + name + stars */}
      <View style={s.reviewHeader}>
        <View style={s.reviewAvatar}>
          <Text style={s.reviewAvatarText}>{initial}</Text>
        </View>
        <View style={s.reviewMeta}>
          <Text style={s.reviewName}>{review.reviewerName}</Text>
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

/** Terms & conditions bullet list */
const TermsList: React.FC<{ terms: string[] }> = ({ terms }) => {
  if (!terms || terms.length === 0) return null;
  return (
    <View style={s.termsSection}>
      {terms.map((term, i) => (
        <View key={i} style={s.termItem} wrap={false}>
          <Text style={s.termBullet}>{'•'}</Text>
          <Text style={s.termText}>{term}</Text>
        </View>
      ))}
    </View>
  );
};

/** Bank details table */
const BankDetails: React.FC = () => (
  <View style={s.bankTable}>
    <View style={s.bankRow}>
      <Text style={s.bankLabel}>Account Holder</Text>
      <Text style={s.bankValue}>: BALEEN MEDIA</Text>
    </View>
    <View style={s.bankRow}>
      <Text style={s.bankLabel}>Account Number</Text>
      <Text style={s.bankValue}>: 99999566030153</Text>
    </View>
    <View style={s.bankRow}>
      <Text style={s.bankLabel}>IFSC</Text>
      <Text style={s.bankValue}>: HDFC0001866</Text>
    </View>
    <View style={s.bankRow}>
      <Text style={s.bankLabel}>Branch</Text>
      <Text style={s.bankValue}>: ADYAR</Text>
    </View>
    <View style={s.bankRow}>
      <Text style={s.bankLabel}>Account Type</Text>
      <Text style={s.bankValue}>: Current Account</Text>
    </View>
  </View>
);

// ---------------------------------------------------------------------------
// Main document component
// ---------------------------------------------------------------------------
const CorporateMinimalPDF: React.FC<CorporateMinimalPDFProps> = ({ data, pdfData }) => {
  const { company, client, quote } = data;

  const parseGSTFromTerms = (terms: string): number => {
    if (terms) {
      const match =
        terms.match(/GST\s+(\d+(?:\.\d+)?)\s*%/i) ||
        terms.match(/(\d+(?:\.\d+)?)\s*%\s*GST/i);
      if (match) return parseFloat(match[1]);
    }
    return quote.gstPercentage;
  };

  const gstPct = parseGSTFromTerms(quote.termsAndConditions || '');
  const isMultiService = quote.items.length > 0 && isMultiServiceQuote(quote.items);
  const serviceGroups = isMultiService ? groupItemsByServiceType(quote.items) : [];
  const showCityInSummary = quoteHasMultipleCities(quote.items);
  const generalTermsList = filterGSTTerms(DEFAULT_GENERAL_TERMS);

  /** Look up pdfData for a group by matching serviceKey */
  const getPdfData = (serviceKey: string): ServicePdfData | null =>
    pdfData.find((d) => d.serviceKey === serviceKey) ?? null;

  // â”€â”€ SINGLE SERVICE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!isMultiService) {
    const allServiceTermsRaw = quote.items[0]?.termsAndConditions || quote.termsAndConditions || '';
    const rawTerms = allServiceTermsRaw.trim()
      ? filterGSTTerms(normalizeTermsList(allServiceTermsRaw))
      : [];
    const defaultFiltered = filterGSTTerms(DEFAULT_GENERAL_TERMS);
    const isDefault =
      rawTerms.length > 0 &&
      rawTerms.length === defaultFiltered.length &&
      rawTerms.every((t, i) => t === defaultFiltered[i]);
    const serviceTerms = isDefault ? [] : rawTerms;

    const serviceType = extractServiceType(quote.items[0]?.description || '');
    const singlePdf = pdfData[0] ?? null;

    return (
      <Document
        title={`Quote ${quote.quoteNumber}`}
        author="Baleen Media"
        creator="Quote Buddy"
      >
        <Page size="A4" style={s.page}>
          <View style={s.accentBar} fixed />
          <PageFooter company={company} />

          <Header data={data} />
          <ClientDetails client={client} />

          {/* Service name heading */}
          <View wrap={false}>
            <Text style={s.sectionHeading}>{serviceType.toUpperCase()}</Text>
            <SubHeading>1. Pricing Summary</SubHeading>
          </View>
          <PricingTable
            items={quote.items}
            gstEnabled={quote.gstEnabled}
            gstPct={gstPct}
          />

          {/* Reference images */}
          {singlePdf && normalizeImageSrcs(singlePdf.refImages).length > 0 && (
            <View>
              <RefImages
                images={singlePdf.refImages}
                heading="2. Reference Image(s)"
                imageDimensions={singlePdf.refImageDimensions}
              />
            </View>
          )}

          {/* Display specification */}
          {singlePdf && (
            <DisplaySpecificationBlock
              heading="3. Display Specification"
              fields={singlePdf.specFields}
              images={singlePdf.specImages || []}
            />
          )}

          {/* Customer review */}
          {singlePdf?.review && (
            <View wrap={false}>
              <SubHeading>4. Customer Review</SubHeading>
              <ReviewBox review={singlePdf.review} />
            </View>
          )}

          {/* Service terms */}
          {serviceTerms.length > 0 && (
            <View wrap={false}>
              <Text style={s.sectionHeading}>Service Terms & Conditions</Text>
              <TermsList terms={serviceTerms} />
            </View>
          )}

          {/* General terms */}
          {generalTermsList.length > 0 && (
            <View wrap={false}>
              <Text style={s.sectionHeading}>General Terms & Conditions</Text>
              <TermsList terms={generalTermsList} />
            </View>
          )}

          {/* Bank details */}
          <View wrap={false}>
            <Text style={s.sectionHeading}>Bank Details</Text>
            <BankDetails />
          </View>

          <View style={s.systemNotice}>
            <Text style={s.systemNoticeText}>
              This is a system-generated quotation and does not require a signature.
            </Text>
          </View>
        </Page>
      </Document>
    );
  }

  // â”€â”€ MULTI SERVICE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <Document
      title={`Quote ${quote.quoteNumber}`}
      author="Baleen Media"
      creator="Quote Buddy"
    >
      {/* Page 1 â€” Executive Pricing Summary */}
      <Page size="A4" style={s.page}>
        <View style={s.accentBar} fixed />
        <PageFooter company={company} />

        <Header data={data} />
        <ClientDetails client={client} />

        <Text style={s.sectionHeading}>Executive Pricing Summary</Text>
        <PricingTable
          items={quote.items}
          gstEnabled={quote.gstEnabled}
          gstPct={gstPct}
          prefixCity={showCityInSummary}
        />
      </Page>

      {/* Service groups flow continuously (no forced new page per service) */}
      <Page size="A4" style={s.page}>
        <View style={s.accentBar} fixed />
        <PageFooter company={company} />

        {serviceGroups.map((group, idx) => {
          const groupTermsRaw = group.termsAndConditions || quote.termsAndConditions || '';
          const groupTerms = groupTermsRaw.trim()
            ? filterGSTTerms(normalizeTermsList(groupTermsRaw))
            : [];
          const heading = getServiceGroupHeading(group);
          // Build a serviceKey consistent with what ReferenceImages uses
          const city = group.city?.trim().toLowerCase();
          const serviceKey = city && city !== 'â€”'
            ? `${city}|${group.serviceType.toLowerCase()}`
            : group.serviceType.toLowerCase();
          const spd = getPdfData(serviceKey);

          let sectionNum = 1;

          const visibleGroupItems = group.items.filter((i) => i.rate !== 0 || i.total !== 0);
          const keepPricingTogether = visibleGroupItems.length <= 2;

          return (
            <View key={idx} style={{ width: '100%' }}>
              {keepPricingTogether ? (
                <View wrap={false} style={{ width: '100%' }}>
                  <Text style={s.sectionHeadingGroup}>{heading}</Text>
                  <SubHeading>{sectionNum++}. Pricing Summary</SubHeading>
                  <PricingTable
                    items={group.items}
                    gstEnabled={quote.gstEnabled}
                    gstPct={gstPct}
                  />
                </View>
              ) : (
                <>
                  <View wrap={false}>
                    <Text style={s.sectionHeadingGroup}>{heading}</Text>
                    <SubHeading>{sectionNum++}. Pricing Summary</SubHeading>
                  </View>
                  <PricingTable
                    items={group.items}
                    gstEnabled={quote.gstEnabled}
                    gstPct={gstPct}
                  />
                </>
              )}

              {spd && normalizeImageSrcs(spd.refImages).length > 0 && (
                <View>
                  <RefImages
                    images={spd.refImages}
                    heading={`${sectionNum++}. Reference Image(s)`}
                    imageDimensions={spd.refImageDimensions}
                  />
                </View>
              )}

              {spd && (spd.specFields.length > 0 || normalizeImageSrcs(spd.specImages || []).length > 0) && (
                <DisplaySpecificationBlock
                  heading={`${sectionNum++}. Display Specification`}
                  fields={spd.specFields}
                  images={spd.specImages || []}
                />
              )}

              {spd?.review && (
                <View wrap={false}>
                  <SubHeading>{sectionNum++}. Customer Review</SubHeading>
                  <ReviewBox review={spd.review} />
                </View>
              )}

              {groupTerms.length > 0 && (
                <View wrap={false}>
                  <SubHeading>{sectionNum++}. Terms & Conditions</SubHeading>
                  <TermsList terms={groupTerms} />
                </View>
              )}
            </View>
          );
        })}
      </Page>

      {/* Final page â€” General Terms + Bank Details */}
      <Page size="A4" style={s.page}>
        <View style={s.accentBar} fixed />
        <PageFooter company={company} />

        <View wrap={false}>
          <Text style={s.sectionHeading}>General Terms & Conditions</Text>
          <TermsList terms={generalTermsList} />
        </View>

        <View wrap={false}>
          <Text style={s.sectionHeading}>Bank Details</Text>
          <BankDetails />
        </View>

        <View style={s.systemNotice}>
          <Text style={s.systemNoticeText}>
            This is a system-generated quotation and does not require a signature.
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default CorporateMinimalPDF;
