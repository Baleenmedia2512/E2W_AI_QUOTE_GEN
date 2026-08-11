import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useToast } from '@chakra-ui/react';
import { TemplateProps } from '../../types';
import { QuoteItem } from '../../types/quote';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading, extractServiceType, buildExecutiveSummaryRows, buildPricingBreakdownLines, ExecutiveSummaryRow, PricingBreakdownLine } from '../../utils/quoteGrouping';
import { formatServiceHeadingDisplay } from '../../utils/serviceHeading';
import { resolveMergedDisplayTermEntries, groupDisplayTermsBySection, type DisplayTerm } from '../../utils/termsMerge';
import { segmentBreakdownFormula } from '../../utils/breakdownFormulaDisplay';
import {
  applyExecutiveSummaryFieldEdit,
  applyOneTimeComponentEdit,
  getVendorEditFloors,
  mergeFloorsWithQuoteItem,
  recalcQuoteTotals,
  resolveDbServiceForQuoteItem,
  uiEditToStorageValue,
  validateOneTimeComponentEdit,
  validateQuoteEdit,
  type VendorEditFloors,
} from '../../utils/quoteEditValidation';
import { getVendorRatesCache, loadVendorRatesFromCloud } from '../../services/vendorRateService';
import {
  previewSectionIdForExecRow,
  previewServiceSectionId,
  previewServiceSectionIdFromItem,
} from '../../utils/previewNavigation';
import { formatRecurringRateUnitLabel, formatUnitRateDisplay, formatUnitRateInr, parseRateInput } from '../../utils/rateDisplay';
import {
  getSharedReviewIfAllSame,
  type CustomerReview,
} from '../../utils/reviewGrouping';
import { collectServiceRemarks } from '../../utils/specMaterial';
import { formatReviewerDisplayName } from '../../utils/reviewDisplay';
import { formatQuoteDate } from '../../utils/dateFormat';
import { PreparedForClientFields } from '../ClientInfoForm/PreparedForClientFields';
import './CorporateMinimal.css';

type ExecEditField = 'quantity' | 'duration' | 'requiringCharge' | 'oneTimeCharge';

const EMPTY_FLOORS: VendorEditFloors = {
  minQty: null,
  minDuration: null,
  displayPriceFloor: null,
  displayPriceIsDaily: true,
  displayUnitCostPerDay: null,
  hasDisplayPricing: false,
  pfCostFloor: null,
  pfPriceFloor: null,
  pfComponentCostFloors: {},
};

/** Resolve vendor floors; reload cache once if empty so margin toasts still work after refresh. */
async function resolveEditFloors(item: {
  serviceId?: string;
  serviceName?: string;
  description?: string;
  city?: string;
}): Promise<VendorEditFloors> {
  const cacheLenBefore = getVendorRatesCache().length;
  let svc = resolveDbServiceForQuoteItem(item);
  if (!svc && cacheLenBefore === 0) {
    try {
      console.log('[MarginDebug] resolveEditFloors: cache empty → loading vendor rates…');
      await loadVendorRatesFromCloud();
    } catch (e) {
      console.warn('[MarginDebug] resolveEditFloors: load failed', e);
    }
    svc = resolveDbServiceForQuoteItem(item);
  }
  const floors = svc ? getVendorEditFloors(svc) : EMPTY_FLOORS;
  console.log('[MarginDebug] resolveEditFloors', {
    lookup: item,
    cacheLenBefore,
    cacheLenAfter: getVendorRatesCache().length,
    svcFound: !!svc,
    svcId: svc?.service_id ?? null,
    svcName: svc?.service_name ?? null,
    pfCostFloor: floors.pfCostFloor,
    pfPriceFloor: floors.pfPriceFloor,
    hasDisplayPricing: floors.hasDisplayPricing,
  });
  return floors;
}

const ExecNumberCell: React.FC<{
  value: number | undefined;
  format?: 'int' | 'rate';
  editable: boolean;
  onCommit: (n: number) => void;
  placeholder?: string;
  compact?: boolean;
  /** Always show a visible border (breakdown pencil-edit mode). */
  bordered?: boolean;
  /** When false, rate cells omit ₹ (parent already shows a ₹ prefix). Default true. */
  currency?: boolean;
  autoFocus?: boolean;
}> = ({
  value,
  format = 'int',
  editable,
  onCommit,
  placeholder = '—',
  compact = false,
  bordered = false,
  currency = true,
  autoFocus = false,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<string | null>(null);
  const valueRef = useRef(value);
  const commitDraftRef = useRef<() => void>(() => undefined);
  const formatRateView = (n: number) =>
    currency ? formatUnitRateInr(n) : formatUnitRateDisplay(n);
  valueRef.current = value;
  draftRef.current = draft;

  const commitDraft = () => {
    const raw = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (raw == null || raw.trim() === '') return;
    const n = format === 'rate' ? parseRateInput(raw) : parseFloat(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) return;
    if (valueRef.current != null && Math.abs(n - valueRef.current) < 1e-9) return;
    onCommit(n);
  };
  commitDraftRef.current = commitDraft;
  const display =
    draft != null
      ? draft
      : value == null || !Number.isFinite(value)
        ? ''
        : format === 'rate'
          ? formatRateView(value)
          : String(value);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const input = inputRef.current;
      if (input && event.target instanceof Node && !input.contains(event.target)) {
        commitDraftRef.current();
        input.blur();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);

  if (!editable) {
    if (value == null || !Number.isFinite(value) || value <= 0 && format === 'rate') {
      return <div className="item-cell-number">{placeholder}</div>;
    }
    if (format === 'rate') {
      return <div className="item-cell-number">{formatRateView(value)}</div>;
    }
    return <div className="item-cell-number">{value}</div>;
  }

  const className = [
    'exec-edit-input',
    compact ? 'exec-edit-input--compact' : '',
    format === 'rate' ? 'exec-edit-input--rate' : 'exec-edit-input--int',
    bordered ? 'exec-edit-input--bordered' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const sizeChars = Math.min(
    12,
    Math.max(format === 'rate' ? 6 : 5, (display || '').length + 1),
  );

  return (
    <input
      ref={inputRef}
      className={className}
      type="text"
      inputMode="decimal"
      value={display}
      aria-label="Edit value"
      autoFocus={autoFocus}
      size={sizeChars}
      style={compact ? { width: `${sizeChars}ch` } : undefined}
      onChange={(e) => {
        draftRef.current = e.target.value;
        setDraft(e.target.value);
      }}
      onFocus={(e) => {
        const nextDraft =
          value == null || !Number.isFinite(value)
            ? ''
            : format === 'rate'
              ? formatUnitRateDisplay(value)
              : String(value);
        draftRef.current = nextDraft;
        setDraft(nextDraft);
        e.target.select();
      }}
      onBlur={commitDraft}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitDraft();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          draftRef.current = null;
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

function titleCaseWords(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/** Editable (or read-only segmented) formula for a pricing-breakdown line. */
const BreakdownFormulaBody: React.FC<{
  line: PricingBreakdownLine;
  canEdit: boolean;
  isEditing: boolean;
  onCommit: (row: ExecutiveSummaryRow, field: ExecEditField, value: number) => void;
  onCommitOneTimeComponent?: (
    row: ExecutiveSummaryRow,
    components: { label: string; amount: number }[],
    label: string,
    value: number,
  ) => void;
}> = ({ line, canEdit, isEditing, onCommit, onCommitOneTimeComponent }) => {
  const formula = line.descriptionLines.slice(1).join(' ') || '';
  const row = line.editRow;

  const readOnlyFormula = (
    <div className="breakdown-desc-secondary">
      {segmentBreakdownFormula(formula).map((seg, i) =>
        seg.muted ? (
          <span key={i} className="breakdown-rate-unit">{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </div>
  );

  if (!canEdit || !row || !isEditing) {
    return readOnlyFormula;
  }

  const qtyUnit = titleCaseWords(line.formulaQtyUnit || 'unit');

  if (line.kind === 'display') {
    const rateLabel = formatRecurringRateUnitLabel(
      row.ratePeriod,
      row.quantityUnit || qtyUnit,
      { wrapUnit: false },
    ).replace(/^\(|\)$/g, '');
    const durLabel =
      row.durationLabel || (row.durationUnit === 'months' ? 'month' : 'days');
    return (
      <div className="breakdown-desc-secondary breakdown-desc-secondary--editable">
        <span className="breakdown-edit-rupee">₹</span>
        <ExecNumberCell
          value={row.requiringCharge}
          format="rate"
          editable
          compact
          bordered
          currency={false}
          autoFocus
          onCommit={(n) => onCommit(row, 'requiringCharge', n)}
        />
        <span className="breakdown-rate-unit"> ({rateLabel}) </span>
        <span>× </span>
        <ExecNumberCell
          value={row.quantity}
          editable
          compact
          bordered
          onCommit={(n) => onCommit(row, 'quantity', n)}
        />
        <span className="breakdown-rate-unit"> ({qtyUnit}) </span>
        {row.duration != null && (
          <>
            <span>× </span>
            <ExecNumberCell
              value={row.duration}
              editable
              compact
              bordered
              onCommit={(n) => onCommit(row, 'duration', n)}
            />
            <span className="breakdown-rate-unit"> ({durLabel})</span>
          </>
        )}
      </div>
    );
  }

  // onetime — separate fields per component when available
  const components = line.oneTimeComponents;
  if (components && components.length > 0 && onCommitOneTimeComponent) {
    return (
      <div className="breakdown-desc-secondary breakdown-desc-secondary--editable breakdown-desc-secondary--components">
        {components.map((comp, idx) => (
          <div key={comp.label} className="breakdown-edit-component">
            {idx > 0 ? <span className="breakdown-edit-plus" aria-hidden>+</span> : null}
            <span className="breakdown-edit-rupee">₹</span>
            <ExecNumberCell
              value={comp.amount}
              format="rate"
              editable
              compact
              bordered
              currency={false}
              autoFocus={idx === 0}
              onCommit={(n) => onCommitOneTimeComponent(row, components, comp.label, n)}
            />
            <span className="breakdown-rate-unit"> ({comp.label})</span>
          </div>
        ))}
        <div className="breakdown-edit-qty-row">
          <span className="breakdown-edit-times" aria-hidden>×</span>
          <ExecNumberCell
            value={row.quantity}
            editable
            compact
            bordered
            onCommit={(n) => onCommit(row, 'quantity', n)}
          />
          <span className="breakdown-rate-unit"> ({qtyUnit})</span>
        </div>
      </div>
    );
  }

  return (
    <div className="breakdown-desc-secondary breakdown-desc-secondary--editable">
      <span className="breakdown-edit-rupee">₹</span>
      <ExecNumberCell
        value={row.oneTimeCharge}
        format="rate"
        editable
        compact
        bordered
        currency={false}
        autoFocus
        onCommit={(n) => onCommit(row, 'oneTimeCharge', n)}
      />
      <span className="breakdown-rate-unit"> (per qty) </span>
      <span>× </span>
      <ExecNumberCell
        value={row.quantity}
        editable
        compact
        bordered
        onCommit={(n) => onCommit(row, 'quantity', n)}
      />
      <span className="breakdown-rate-unit"> ({qtyUnit})</span>
    </div>
  );
};

/** One pricing-breakdown row: pencil on the left of DESCRIPTION, then title + formula. */
const BreakdownDescCell: React.FC<{
  line: PricingBreakdownLine;
  canEdit: boolean;
  amountBlock: React.ReactNode;
  onCommit: (row: ExecutiveSummaryRow, field: ExecEditField, value: number) => void;
  onCommitOneTimeComponent?: (
    row: ExecutiveSummaryRow,
    components: { label: string; amount: number }[],
    label: string,
    value: number,
  ) => void;
}> = ({ line, canEdit, amountBlock, onCommit, onCommitOneTimeComponent }) => {
  const [isEditing, setIsEditing] = useState(false);
  const title = line.descriptionLines[0] || '';
  const formula = line.descriptionLines.slice(1).join(' ') || null;
  const showEdit = Boolean(canEdit && line.editRow);

  const editBtn = showEdit ? (
    <button
      type="button"
      className={isEditing ? 'breakdown-formula-done-btn' : 'breakdown-formula-edit-btn'}
      aria-label={isEditing ? 'Done editing' : 'Edit formula values'}
      title={isEditing ? 'Done' : 'Edit'}
      onClick={() => setIsEditing((v) => !v)}
    >
      {isEditing ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
          <path d="M20 6L9 17l-5-5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
          <path
            d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  ) : null;

  return (
    <div className={`breakdown-desc-cell${showEdit ? ' breakdown-desc-cell--editable' : ''}${isEditing ? ' breakdown-desc-cell--editing' : ''}`}>
      {editBtn}
      <div className="breakdown-desc-cell-body">
        {formula ? (
          <>
            <div className="breakdown-title-row">
              <div className="breakdown-desc-primary">{title}</div>
              {amountBlock}
            </div>
            <BreakdownFormulaBody
              line={line}
              canEdit={canEdit}
              isEditing={isEditing}
              onCommit={onCommit}
              onCommitOneTimeComponent={onCommitOneTimeComponent}
            />
          </>
        ) : (
          <div className="breakdown-title-row">
            <div className="breakdown-desc-primary" style={{ marginBottom: 0 }}>{title}</div>
            {amountBlock}
          </div>
        )}
      </div>
    </div>
  );
};

export const CorporateMinimal: React.FC<TemplateProps> = ({
  data,
  editable = false,
  onDataChange,
  onClientChange,
  onNavigateToSection,
}) => {
  const { company, client, quote } = data;
  const toast = useToast();

  /** Per-service reviews from ReferenceImages — used to group identical reviews. */
  const [reviewsByKey, setReviewsByKey] = useState<
    Record<string, CustomerReview | null>
  >({});

  const handleServiceDataReady = useCallback(
    (
      serviceKey: string,
      ready: {
        refImages: string[];
        specImages: string[];
        specFields: Array<{ label: string; value: string }>;
        specGroups?: unknown[];
        review: CustomerReview | null;
      },
    ) => {
      setReviewsByKey((prev) => {
        const existing = prev[serviceKey];
        if (existing === ready.review) return prev;
        if (
          existing &&
          ready.review &&
          existing.reviewerName === ready.review.reviewerName &&
          existing.starCount === ready.review.starCount &&
          existing.reviewText === ready.review.reviewText &&
          existing.reviewUrl === ready.review.reviewUrl
        ) {
          return prev;
        }
        return { ...prev, [serviceKey]: ready.review };
      });
      data.onServiceDataReady?.(serviceKey, ready as never);
    },
    [data.onServiceDataReady],
  );

  // Ensure website URL has a protocol
  const ensureHttps = (url: string) => url.startsWith('http') ? url : `https://${url}`;

  const showFloorToast = useCallback(
    (message: string) => {
      toast({
        title: message.includes('margin') ? 'Below margin' : 'Below minimum',
        description: message,
        status: 'warning',
        duration: 4000,
        isClosable: true,
        position: 'top',
      });
    },
    [toast],
  );

  const commitExecEdit = useCallback(
    async (row: ExecutiveSummaryRow, field: ExecEditField, value: number) => {
      if (!onDataChange) return;

      const primary =
        quote.items.find((i) => i.id === row.id) ||
        quote.items.find(
          (i) =>
            (i.serviceId || '').trim().toLowerCase() ===
            (row.catalogServiceId || '').trim().toLowerCase(),
        );
      if (!primary) return;

      const floors = mergeFloorsWithQuoteItem(
        await resolveEditFloors({
          serviceId: row.catalogServiceId || primary.serviceId,
          serviceName: primary.serviceName,
          description: primary.description,
          city: primary.city,
        }),
        primary,
        quote.items,
      );
      let storeValue = value;
      if (field === 'duration') {
        storeValue = uiEditToStorageValue('duration', value, row);
      } else if (field === 'requiringCharge') {
        storeValue = uiEditToStorageValue('requiringCharge', value, row);
      }

      let validationField: 'quantity' | 'duration' | 'displayRate' | 'pfRate';
      if (field === 'quantity') validationField = 'quantity';
      else if (field === 'duration') validationField = 'duration';
      else if (field === 'requiringCharge') validationField = 'displayRate';
      else validationField = 'pfRate';

      const durationDays = row.durationDays ?? 0;
      const displayDaily =
        row.dailyRate != null && row.dailyRate > 0
          ? row.dailyRate
          : row.ratePeriod === 'per_month'
            ? (row.requiringCharge || 0) / 30
            : row.requiringCharge || 0;
      const packageContext = {
        quantity: row.quantity,
        durationDays,
        displayDailyRate: displayDaily,
        pfUnitRate: row.oneTimeCharge || 0,
      };

      const result = validateQuoteEdit({
        field: validationField,
        value:
          field === 'requiringCharge'
            ? value // validate against UI unit via rateUiMode
            : field === 'duration'
              ? storeValue // duration floor is always in days
              : value,
        floors,
        rateUiMode: row.ratePeriod === 'per_month' ? 'per_month' : 'per_day',
        packageContext,
      });
      if (!result.ok) {
        showFloorToast(result.message || 'Invalid value');
        return;
      }

      const nextItems = applyExecutiveSummaryFieldEdit(
        quote.items,
        primary.id,
        field,
        field === 'duration' || field === 'requiringCharge' ? storeValue : value,
        floors,
      );
      const nextQuote = recalcQuoteTotals({ ...quote, items: nextItems });
      onDataChange({ ...data, quote: nextQuote });
    },
    [data, onDataChange, quote, showFloorToast],
  );

  const commitOneTimeComponentEdit = useCallback(
    async (
      row: ExecutiveSummaryRow,
      components: { label: string; amount: number }[],
      label: string,
      value: number,
    ) => {
      if (!onDataChange) return;

      const primary =
        quote.items.find((i) => i.id === row.id) ||
        quote.items.find(
          (i) =>
            (i.serviceId || '').trim().toLowerCase() ===
            (row.catalogServiceId || '').trim().toLowerCase(),
        );
      if (!primary) return;

      console.log('[MarginDebug] commitOneTimeComponentEdit: primary item', {
        id: primary.id,
        serviceId: primary.serviceId,
        serviceName: primary.serviceName,
        description: primary.description,
        city: primary.city,
        rate: primary.rate,
        vendorPfUnitCost: primary.vendorPfUnitCost ?? null,
        vendorDisplayUnitCostPerDay: primary.vendorDisplayUnitCostPerDay ?? null,
        rowCatalogServiceId: row.catalogServiceId,
        rowId: row.id,
        editLabel: label,
        editValue: value,
        components,
      });

      const floors = mergeFloorsWithQuoteItem(
        await resolveEditFloors({
          serviceId: row.catalogServiceId || primary.serviceId,
          serviceName: primary.serviceName,
          description: primary.description,
          city: primary.city,
        }),
        primary,
        quote.items,
      );
      const nextComponents = components.map((c) =>
        c.label === label ? { ...c, amount: value } : c,
      );
      const durationDays = row.durationDays ?? 0;
      const displayDaily =
        row.dailyRate != null && row.dailyRate > 0
          ? row.dailyRate
          : row.ratePeriod === 'per_month'
            ? (row.requiringCharge || 0) / 30
            : row.requiringCharge || 0;
      const result = validateOneTimeComponentEdit({
        floors,
        label,
        value,
        nextComponents,
        packageContext: {
          quantity: row.quantity,
          durationDays,
          displayDailyRate: displayDaily,
        },
      });
      console.log('[MarginDebug] commitOneTimeComponentEdit: validation result', {
        ok: result.ok,
        message: result.message ?? null,
        mergedPfCostFloor: floors.pfCostFloor,
        pfPriceFloor: floors.pfPriceFloor,
        nextComponents,
      });
      if (!result.ok) {
        showFloorToast(result.message || 'Invalid value');
        return;
      }

      const nextItems = applyOneTimeComponentEdit(
        quote.items,
        primary.id,
        components,
        label,
        value,
      );
      const nextQuote = recalcQuoteTotals({ ...quote, items: nextItems });
      onDataChange({ ...data, quote: nextQuote });
    },
    [data, onDataChange, quote, showFloorToast],
  );

  /** Persist specification remark onto matching quote items / line items. */
  const commitSpecRemark = useCallback(
    (targetItems: QuoteItem[], remark: string) => {
      if (!onDataChange) return;
      const ids = new Set(targetItems.map((i) => i.id));
      const nextItems = quote.items.map((item) => {
        if (!ids.has(item.id)) return item;
        const next = { ...item, remark };
        if (next.lineItems?.length) {
          next.lineItems = next.lineItems.map((li) => ({ ...li, remark }));
        }
        return next;
      });
      onDataChange({ ...data, quote: { ...quote, items: nextItems } });
    },
    [data, onDataChange, quote],
  );

  // Render a term string with any embedded URLs as clickable links
  const renderTermWithLinks = (term: string): React.ReactNode => {
    const urlPattern = /https?:\/\/[^\s]+/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    urlPattern.lastIndex = 0;
    while ((match = urlPattern.exec(term)) !== null) {
      if (match.index > lastIndex) parts.push(term.slice(lastIndex, match.index));
      parts.push(<a key={match.index} href={match[0]} style={{ color: 'inherit', textDecoration: 'none' }}>{match[0]}</a>);
      lastIndex = urlPattern.lastIndex;
    }
    if (lastIndex < term.length) parts.push(term.slice(lastIndex));
    return parts.length > 1 ? parts : term;
  };

  // Check if this is a multi-service quote
  const isMultiService = quote.items.length > 0 && isMultiServiceQuote(quote.items);
  const serviceGroups = isMultiService ? groupItemsByServiceType(quote.items) : [];

  const serviceGroupKey = (group: (typeof serviceGroups)[number]) => {
    const city = group.city?.trim().toLowerCase();
    return city && city !== '\u2014'
      ? `${city}|${group.serviceType.toLowerCase()}`
      : group.serviceType.toLowerCase();
  };

  const multiServiceKeys = serviceGroups.map(serviceGroupKey);
  const allReviewsReady =
    isMultiService &&
    multiServiceKeys.length > 0 &&
    multiServiceKeys.every((k) => Object.prototype.hasOwnProperty.call(reviewsByKey, k));
  const sharedReview =
    allReviewsReady
      ? getSharedReviewIfAllSame(multiServiceKeys.map((k) => reviewsByKey[k]))
      : null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (date: Date | string) => formatQuoteDate(date);

  // Filter GST lines from T&C (GST amount shown separately in a later phase)
  const filterGSTDisplayTerms = (terms: DisplayTerm[]) =>
    terms.filter(t => !/gst|tax\s*%|inclusive\s*of\s*(gst|tax)|exclusive\s*of\s*(gst|tax)|\+\s*gst|\d+\s*%\s*(gst|tax)/i.test(t.text));

  const renderTermsList = (terms: DisplayTerm[]) => {
    const sections = groupDisplayTermsBySection(terms);
    return (
      <div className="terms-sections">
        {sections.map((section) => (
          <div key={section.title} className="terms-subsection">
            <h4 className="term-section-heading">{section.title}</h4>
            <ul>
              {section.terms.map((term, i) => (
                <li key={`${section.title}-${i}`}>
                  <span className="bullet-dot"></span>
                  <span className="term-line">
                    <span className="term-body">{term.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  };

  // Executive summary: one row per service_id (Display + P&F collapsed), amounts excl. GST
  const renderItemsTable = (items: QuoteItem[]) => {
    const rows = buildExecutiveSummaryRows(items);
    const hasRemark = rows.some((r) => r.remark);
    const subtotal = rows.reduce((sum, r) => sum + r.amountExclGst, 0);
    const gstPct = quote.gstPercentage > 0 ? quote.gstPercentage : 18;
    const totalInclGst = subtotal + (subtotal * gstPct) / 100;
    const labelColSpan = 5;
    // Executive summary is navigation-only — edit qty/rates in Pricing Breakdown
    const canEdit = false;
    return (
      <div className="table-scroll-wrap">
      <table className={`items-table items-table--exec${hasRemark ? ' items-table--has-remark' : ''}`}>
        <thead>
          <tr className="exec-thead-titles">
            <th className="col-service-id">SERVICE &amp; LOCATION</th>
            <th className="col-quantity">REQ. QUANTITY</th>
            <th className="col-duration" title="Campaign duration">REQ. DURATION</th>
            <th className="col-requiring">RECURRING CHARGE</th>
            <th className="col-onetime">ONE TIME CHARGE</th>
            <th className="col-amount-excl">AMOUNT</th>
            {hasRemark && <th className="col-remark">Remark</th>}
          </tr>
          <tr className="exec-thead-letters">
            <th className="col-service-id exec-th-empty" aria-hidden="true">&nbsp;</th>
            <th className="col-quantity exec-th-letter">(A)</th>
            <th className="col-duration exec-th-letter">(B)</th>
            <th className="col-requiring exec-th-letter">(C)</th>
            <th className="col-onetime exec-th-letter">(D)</th>
            <th className="col-amount-excl exec-th-formula">(A×B×C)+(A×D)</th>
            {hasRemark && <th className="col-remark exec-th-empty" aria-hidden="true">&nbsp;</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const jumpId = onNavigateToSection
              ? previewSectionIdForExecRow(row, items)
              : null;
            return (
            <tr key={row.id}>
              <td className="item-service-id">
                {jumpId ? (
                  <button
                    type="button"
                    className="item-title item-title--nav"
                    onClick={() => onNavigateToSection?.(jumpId)}
                  >
                    {row.serviceId}
                  </button>
                ) : (
                  <div className="item-title">{row.serviceId}</div>
                )}
              </td>
              <td className="item-quantity">
                <ExecNumberCell
                  value={row.quantity}
                  editable={canEdit}
                  onCommit={(n) => commitExecEdit(row, 'quantity', n)}
                />
                {row.quantityUnit && (
                  <div className="item-unit-label">
                    ({String(row.quantityUnit).replace(/^per\s+/i, '')})
                  </div>
                )}
              </td>
              <td className="item-duration">
                {row.duration != null || canEdit ? (
                  <>
                    <ExecNumberCell
                      value={row.duration}
                      editable={canEdit && row.duration != null}
                      onCommit={(n) => commitExecEdit(row, 'duration', n)}
                      placeholder="—"
                    />
                    {row.duration != null && (
                      <div className="item-unit-label">
                        ({row.durationLabel || (row.durationUnit === 'months' ? 'month' : 'days')})
                      </div>
                    )}
                  </>
                ) : (
                  <div className="item-cell-number">—</div>
                )}
              </td>
              <td className="item-requiring">
                {row.requiringCharge > 0 ? (
                  <>
                    <ExecNumberCell
                      value={row.requiringCharge}
                      format="rate"
                      editable={canEdit}
                      onCommit={(n) => commitExecEdit(row, 'requiringCharge', n)}
                    />
                    {row.duration != null ? (
                      <div className="item-unit-label item-unit-label--rate-period">
                        {formatRecurringRateUnitLabel(row.ratePeriod, row.quantityUnit)}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="item-cell-number">—</div>
                )}
              </td>
              <td className="item-onetime">
                {row.oneTimeCharge > 0 ? (
                  <>
                    <ExecNumberCell
                      value={row.oneTimeCharge}
                      format="rate"
                      editable={canEdit}
                      onCommit={(n) => commitExecEdit(row, 'oneTimeCharge', n)}
                    />
                    {row.quantityUnit && (
                      <div className="item-unit-label">
                        (per {String(row.quantityUnit).replace(/^per\s+/i, '')})
                      </div>
                    )}
                  </>
                ) : (
                  <div className="item-cell-number">—</div>
                )}
              </td>
              <td className="item-amount-excl">{formatCurrency(row.amountExclGst)}</td>
              {hasRemark && <td className="item-remark">{row.remark || ''}</td>}
            </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="tfoot-totals">
            <td className="tfoot-label" colSpan={labelColSpan}>Total (excl. GST)</td>
            <td className="tfoot-excl">{formatCurrency(subtotal)}</td>
            {hasRemark && <td></td>}
          </tr>
          <tr className="tfoot-totals tfoot-totals--gst">
            <td className="tfoot-label" colSpan={labelColSpan}>GST @ {gstPct}%</td>
            <td className="tfoot-excl">{formatCurrency(totalInclGst - subtotal)}</td>
            {hasRemark && <td></td>}
          </tr>
          <tr className="tfoot-totals tfoot-totals--incl">
            <td className="tfoot-label tfoot-label--incl" colSpan={labelColSpan}>Total (incl. GST)</td>
            <td className="tfoot-incl">{formatCurrency(totalInclGst)}</td>
            {hasRemark && <td></td>}
          </tr>
        </tfoot>
      </table>
      </div>
    );
  };

  /** Per-service Pricing Breakdown — DESCRIPTION / AMOUNT (not Executive Summary). */
  const renderPricingBreakdownTable = (items: typeof quote.items) => {
    const { lines, subtotal } = buildPricingBreakdownLines(items);
    const gstPct = quote.gstPercentage > 0 ? quote.gstPercentage : 18;
    const gstAmount = (subtotal * gstPct) / 100;
    const totalInclGst = subtotal + gstAmount;
    const detailLines = lines.filter((l) => l.kind !== 'subtotal');
    const hasDisplay = detailLines.some((l) => l.kind === 'display');
    const hasPF = detailLines.some((l) => l.kind === 'onetime');
    const canEdit = Boolean(editable && onDataChange);

    // Show combined Display + P&F total (excl. GST) only when both lines exist
    const summaryPairs: { label: string; amount: number; emph?: boolean }[] = [
      ...(hasDisplay && hasPF
        ? [{ label: 'Total (excl. GST)', amount: subtotal }]
        : []),
      { label: `GST @ ${gstPct}%`, amount: gstAmount },
      { label: 'Total (incl. GST)', amount: totalInclGst, emph: true },
    ];

    return (
      <div className="table-scroll-wrap">
        <table className={`items-table items-table--breakdown${canEdit ? ' items-table--editable' : ''}`}>
          <thead>
            <tr>
              <th className="col-description">DESCRIPTION</th>
              <th className="col-amount-excl">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {detailLines.map((line, idx) => {
              const amountBlock = (
                <div className="breakdown-amount-stack">
                  <div className="breakdown-amount-inline">{formatCurrency(line.amount)}</div>
                  <div className="breakdown-excl-gst">(excl.gst)</div>
                </div>
              );
              return (
                <tr key={`${line.kind}-${idx}`}>
                  <td className="item-description breakdown-desc" colSpan={2}>
                    <BreakdownDescCell
                      line={line}
                      canEdit={canEdit}
                      amountBlock={amountBlock}
                      onCommit={commitExecEdit}
                      onCommitOneTimeComponent={commitOneTimeComponentEdit}
                    />
                  </td>
                </tr>
              );
            })}
            <tr className="breakdown-summary-block">
              <td className="breakdown-summary-labels">
                {summaryPairs.map((p) => (
                  <div
                    key={p.label}
                    className={p.emph ? 'breakdown-summary-label breakdown-summary-label--emph' : 'breakdown-summary-label'}
                  >
                    {p.label}
                  </div>
                ))}
              </td>
              <td className="breakdown-summary-amounts">
                {summaryPairs.map((p) => (
                  <div
                    key={p.label}
                    className={p.emph ? 'breakdown-summary-amount breakdown-summary-amount--emph' : 'breakdown-summary-amount'}
                  >
                    {formatCurrency(p.amount)}
                  </div>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // Render header component (reusable)
  const renderHeader = (showMetaInfo = true) => (
    <div className="template-header">
      {company.logo && (
        <div className="header-logo-row">
          <img src={company.logo} alt={company.name} className="company-logo" />
        </div>
      )}
      {showMetaInfo && <h2 className="quote-title">QUOTATION</h2>}
      <div className="header-info-row">
        <div className="company-details">
          {company.phone && <p>Phone: <a className="contact-link" href={`tel:${company.phone}`}>{company.phone}</a></p>}
          {company.email && <p>Email: <a className="contact-link" href={`mailto:${company.email}`}>{company.email}</a></p>}
          {company.gst && <p>GST: {company.gst}</p>}
          {company.abn && <p>ABN: {company.abn}</p>}
        </div>
        {showMetaInfo && (
          <div className="quote-meta">
            <div className="meta-details">
              <div className="meta-row">
                <span className="meta-label">Quote Number:</span>
                <span className="meta-value">{quote.quoteNumber}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Prepared Date:</span>
                <span className="meta-value">{formatDate(quote.date)}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Valid Until:</span>
                <span className="meta-value">{formatDate(quote.validUntil)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Render client details — editable Name / Phone / Email on preview; PDF still static via CorporateMinimalPDF
  const renderClientDetails = () => {
    if (editable && onClientChange) {
      return (
        <PreparedForClientFields
          client={client}
          onChange={onClientChange}
        />
      );
    }

    const bits: React.ReactNode[] = [];
    if (client.phone) {
      bits.push(
        <span key="ph">
          PH:{' '}
          <a className="contact-link" href={`tel:${client.phone}`}>
            {client.phone}
          </a>
        </span>,
      );
    }
    if (client.email) {
      bits.push(
        <span key="em">
          Email:{' '}
          <a className="contact-link" href={`mailto:${client.email}`}>
            {client.email}
          </a>
        </span>,
      );
    }

    return (
      <div className="client-section">
        <div className="client-inline-row">
          <span className="client-inline-label">Quote Prepared For: </span>
          <span className="client-inline-name">
            {(client.company || client.name || '').toUpperCase()}
          </span>
          {bits.map((f, i) => (
            <span key={i}>
              <span className="client-inline-sep"> | </span>
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  };

  // Render company contact footer (appears on every page)
  const renderCompanyFooter = (pageNum: number, totalPages: number) => (
    <div className="company-contact-footer" style={{ marginTop: 'auto', paddingTop: '12px', paddingBottom: '16px', width: '100%' }}>
      <div className="footer-divider" style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #b8d4e8, transparent)', marginBottom: '10px' }}></div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: '8px 20px', fontSize: '14px', color: '#636e72', width: '100%', justifyContent: 'center' }}>
        {company.website && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            🌐 <a style={{ color: '#2980b9' }} href={ensureHttps(company.website)} target="_blank" rel="noopener noreferrer">{company.website}</a>
          </span>
        )}
        {company.address && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            📍 {company.address}
          </span>
        )}
      </div>
      <div className="footer-page-number" style={{ display: 'block', width: '100%', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#636e72', marginTop: '4px' }}>
        {pageNum} / {totalPages}
      </div>
    </div>
  );

  // Single service quote (original behavior)
  if (!isMultiService) {
    const singleTotal = 3;
    // One merged T&C: general first, then per-service extras (ordered) with bold service names
    const singleTerms = filterGSTDisplayTerms(
      resolveMergedDisplayTermEntries(quote.termsAndConditions, quote.items, DEFAULT_GENERAL_TERMS),
    );
    return (
      <>
        <div id="pdf-page-1" className="template-corporate-minimal">
          <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
            {renderHeader()}
            {renderClientDetails()}
          </div>

          <div
            className="quote-items-section"
            id={quote.items[0] ? previewServiceSectionIdFromItem(quote.items[0]) : undefined}
          >
            <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
              <h3 style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 8px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
                {formatServiceHeadingDisplay(
                  quote.items[0]?.serviceName
                    || extractServiceType(quote.items[0]?.description || ''),
                )}
              </h3>
              <h3 className="smart-section-heading" style={{ fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1a1a2e', margin: '16px 0 14px 0', paddingBottom: '8px', borderBottom: '2px solid #2980b9' }}>
                <span className="smart-heading-bar" />
                1. Pricing Breakdown
              </h3>
            </div>
            <div data-pdf-block="table">
              {renderPricingBreakdownTable(quote.items)}
            </div>
            {/* Spec + Reference Images in same section — virtual page engine packs them together */}
            <ReferenceImages
              proposalPages={data.proposalPages}
              proposalPageMap={data.proposalPageMap}
              items={quote.items}
              terms={[]}
              remark={collectServiceRemarks(quote.items)}
              remarkEditable={Boolean(editable && onDataChange)}
              onRemarkChange={(r) => commitSpecRemark(quote.items, r)}
              serviceKey={(() => {
                const city = (quote.items[0]?.city || '').trim().toLowerCase();
                const st = extractServiceType(quote.items[0]?.description || '').toLowerCase();
                if (city && city !== '\u2014' && st) return `${city}|${st}`;
                return quote.items[0]?.serviceId || st || 'single';
              })()}
              onDataReady={data.onServiceDataReady}
            />
          </div>

          {/* Terms flow within pdf-page-1 — virtual page engine packs them after reference images,
              eliminating the blank half-page that occurred when they lived in a separate pdf-page-terms */}
          <div id="preview-terms-single">
          {singleTerms.length > 0 && (
            <div className="terms-section" data-pdf-block="list">
              <h3 style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
                Terms &amp; Conditions
              </h3>
              {renderTermsList(singleTerms)}
            </div>
          )}
          </div>

          {/* Bank Details */}
          <div id="preview-bank-details" className="bank-details-card" data-pdf-block="atomic">
            <h3 className="bank-details-card-title">Our Bank Details</h3>
            <table className="bank-details-table">
              <tbody>
                <tr><td className="bank-label">HDFC Account Name</td><td className="bank-colon">:</td><td className="bank-value">BALEEN MEDIA</td></tr>
                <tr><td className="bank-label">Current Account Number</td><td className="bank-colon">:</td><td className="bank-value">99999566030153</td></tr>
                <tr><td className="bank-label">IFSC</td><td className="bank-colon">:</td><td className="bank-value">HDFC0001866</td></tr>
              </tbody>
            </table>
          </div>

          {/* System Generated Notice */}
          <div className="system-generated-notice" data-pdf-block="atomic">
            <p>This is a system-generated quotation and does not require a signature.</p>
          </div>

          {/* Company Contact Footer */}
          {renderCompanyFooter(1, singleTotal)}
        </div>
      </>
    );
  }

  // Multi-service quote - render summary + individual service pages
  // Count actual pages: 1 summary + per group (service + ref + optional terms) + 1 final terms
  const multiTotal = 1 + serviceGroups.length * 2 + 1;

  // Running page counter — incremented as each page is rendered
  let pageCounter = 0;

  return (
    <>
      {/* Page 1: Summary Page */}
      <div id="pdf-page-summary" className="template-corporate-minimal">
        <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
          {renderHeader()}
          {renderClientDetails()}
        </div>

        <div className="quote-items-section">
          <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
            <h3 style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
              Executive Pricing Summary
            </h3>
          </div>
            <div data-pdf-block="table">
              {renderItemsTable(quote.items)}
            </div>
        </div>

        {/* Company Contact Footer */}
        {renderCompanyFooter(++pageCounter, multiTotal)}
      </div>

      {/* Pages 2+: Service detail sections */}
      <div id="pdf-page-services" className="template-corporate-minimal">
        {serviceGroups.map((group, groupIndex) => {
          return (
            <div
              key={groupIndex}
              id={previewServiceSectionId(group)}
              className="preview-service-section"
              data-toc-section="service"
            >
              <div className="quote-items-section">
                <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
                  <h3 style={{ marginBottom: '8px', fontSize: '18px', fontWeight: '700', color: '#750926', textAlign: 'center' }}>
                    {getServiceGroupHeading(group)}
                  </h3>
                  <h3 className="smart-section-heading" style={{ fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1a1a2e', margin: '24px 0 14px 0', paddingBottom: '8px', borderBottom: '2px solid #2980b9' }}>
                    <span className="smart-heading-bar" />
                    1. Pricing Breakdown
                  </h3>
                </div>
                <div data-pdf-block="table">
                  {renderPricingBreakdownTable(group.items)}
                </div>
              </div>

              {/* Reference images / spec / review — T&C is after all details, before bank */}
              <ReferenceImages
                proposalPages={data.proposalPages}
                proposalPageMap={data.proposalPageMap}
                items={group.items}
                terms={[]}
                remark={collectServiceRemarks(group.items)}
                remarkEditable={Boolean(editable && onDataChange)}
                onRemarkChange={(r) => commitSpecRemark(group.items, r)}
                serviceKey={(() => {
                  const city = group.city?.trim().toLowerCase();
                  return city && city !== '\u2014' ? `${city}|${group.serviceType.toLowerCase()}` : group.serviceType.toLowerCase();
                })()}
                hideReview={!!sharedReview}
                onDataReady={handleServiceDataReady}
              />
            </div>
          );
        })}

        {/* Identical reviews across all services → one card before T&C / bank */}
        {sharedReview && (
          <div className="smart-section" data-pdf-block="atomic" id="preview-shared-review">
            <h3 className="smart-section-heading">
              <span className="smart-heading-bar" />
              Customer Review
            </h3>
            <div className="review-card">
              <div className="review-header">
                <span className="review-avatar">
                  {formatReviewerDisplayName(sharedReview.reviewerName).charAt(0)}
                </span>
                <div className="review-meta">
                  <span className="review-name">
                    {formatReviewerDisplayName(sharedReview.reviewerName)}
                  </span>
                  <span className="review-stars">
                    {'★'.repeat(sharedReview.starCount)}
                    {'☆'.repeat(Math.max(0, 5 - sharedReview.starCount))}
                  </span>
                </div>
              </div>
              {sharedReview.reviewText && (
                <p className="review-body">{sharedReview.reviewText}</p>
              )}
              {sharedReview.reviewUrl && (
                <a
                  href={sharedReview.reviewUrl}
                  className="review-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Click here to see the review
                </a>
              )}
            </div>
          </div>
        )}

        {/* T&C after all service details — immediately before bank details */}
        <div id="pdf-page-terms" className="terms-section" data-pdf-block="list">
          {(() => {
            const multiTerms = filterGSTDisplayTerms(
              resolveMergedDisplayTermEntries(quote.termsAndConditions, quote.items, DEFAULT_GENERAL_TERMS),
            );
            if (multiTerms.length === 0) return null;
            return (
              <>
                <h3 style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
                  Terms &amp; Conditions
                </h3>
                {renderTermsList(multiTerms)}
              </>
            );
          })()}
        </div>

        {/* Bank + notice last — after T&C */}
        <div id="preview-bank-details" className="bank-details-card" data-pdf-block="atomic">
          <h3 className="bank-details-card-title">Our Bank Details</h3>
          <table className="bank-details-table">
            <tbody>
              <tr><td className="bank-label">HDFC Account Name</td><td className="bank-colon">:</td><td className="bank-value">BALEEN MEDIA</td></tr>
              <tr><td className="bank-label">Current Account Number</td><td className="bank-colon">:</td><td className="bank-value">99999566030153</td></tr>
              <tr><td className="bank-label">IFSC</td><td className="bank-colon">:</td><td className="bank-value">HDFC0001866</td></tr>
            </tbody>
          </table>
        </div>

        <div className="system-generated-notice" data-pdf-block="atomic">
          <p>This is a system-generated quotation and does not require a signature.</p>
        </div>

        {/* Single shared footer for the entire services section —
            compositeWithPageFooter pins it to the bottom of every virtual page.
            Page numbers are overwritten by jsPDF's injection loop after all pages are captured. */}
        {renderCompanyFooter(0, 0)}
      </div>
    </>
  );
};


