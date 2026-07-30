import React, { useState, useCallback } from 'react';
import { useToast } from '@chakra-ui/react';
import { TemplateProps } from '../../types';
import { QuoteItem } from '../../types/quote';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading, normalizeTermsList, resolveGeneralTermsList, extractServiceType, buildExecutiveSummaryRows, buildPricingBreakdownLines, ExecutiveSummaryRow, PricingBreakdownLine } from '../../utils/quoteGrouping';
import { segmentBreakdownFormula } from '../../utils/breakdownFormulaDisplay';
import {
  applyExecutiveSummaryFieldEdit,
  getVendorEditFloors,
  recalcQuoteTotals,
  resolveDbServiceForQuoteItem,
  uiEditToStorageValue,
  validateQuoteEdit,
} from '../../utils/quoteEditValidation';
import './CorporateMinimal.css';

type ExecEditField = 'quantity' | 'duration' | 'requiringCharge' | 'oneTimeCharge';

const ExecNumberCell: React.FC<{
  value: number | undefined;
  format?: 'int' | 'rate';
  editable: boolean;
  onCommit: (n: number) => void;
  placeholder?: string;
  compact?: boolean;
}> = ({ value, format = 'int', editable, onCommit, placeholder = '—', compact = false }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const display =
    draft != null
      ? draft
      : value == null || !Number.isFinite(value)
        ? ''
        : format === 'rate'
          ? (Math.round(value * 100) / 100).toFixed(2)
          : String(value);

  if (!editable) {
    if (value == null || !Number.isFinite(value) || value <= 0 && format === 'rate') {
      return <div className="item-cell-number">{placeholder}</div>;
    }
    if (format === 'rate') {
      return (
        <div className="item-cell-number">
          {new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }).format(value)}
        </div>
      );
    }
    return <div className="item-cell-number">{value}</div>;
  }

  return (
    <input
      className={compact ? 'exec-edit-input exec-edit-input--compact' : 'exec-edit-input'}
      type="text"
      inputMode="decimal"
      value={display}
      aria-label="Edit value"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setDraft(
          value == null || !Number.isFinite(value)
            ? ''
            : format === 'rate'
              ? (Math.round(value * 100) / 100).toFixed(2)
              : String(value),
        );
        e.target.select();
      }}
      onBlur={() => {
        const raw = draft;
        setDraft(null);
        if (raw == null || raw.trim() === '') return;
        const n = parseFloat(raw.replace(/,/g, ''));
        if (!Number.isFinite(n)) return;
        if (value != null && Math.abs(n - value) < 1e-9) return;
        onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

/** Editable (or read-only segmented) formula for a pricing-breakdown line. */
const BreakdownFormulaBody: React.FC<{
  line: PricingBreakdownLine;
  canEdit: boolean;
  onCommit: (row: ExecutiveSummaryRow, field: ExecEditField, value: number) => void;
}> = ({ line, canEdit, onCommit }) => {
  const formula = line.descriptionLines.slice(1).join(' ') || '';
  const row = line.editRow;

  if (!canEdit || !row) {
    return (
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
  }

  const qtyUnit = line.formulaQtyUnit || 'unit';

  if (line.kind === 'display') {
    const rateLabel = row.ratePeriod === 'per_month' ? 'per month' : 'per day';
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
          onCommit={(n) => onCommit(row, 'requiringCharge', n)}
        />
        <span className="breakdown-rate-unit"> ({rateLabel}) </span>
        <span>× </span>
        <ExecNumberCell
          value={row.quantity}
          editable
          compact
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
              onCommit={(n) => onCommit(row, 'duration', n)}
            />
            <span className="breakdown-rate-unit"> ({durLabel})</span>
          </>
        )}
      </div>
    );
  }

  // onetime
  return (
    <div className="breakdown-desc-secondary breakdown-desc-secondary--editable">
      <span className="breakdown-edit-rupee">₹</span>
      <ExecNumberCell
        value={row.oneTimeCharge}
        format="rate"
        editable
        compact
        onCommit={(n) => onCommit(row, 'oneTimeCharge', n)}
      />
      <span className="breakdown-rate-unit"> (per qty) </span>
      <span>× </span>
      <ExecNumberCell
        value={row.quantity}
        editable
        compact
        onCommit={(n) => onCommit(row, 'quantity', n)}
      />
      <span className="breakdown-rate-unit"> ({qtyUnit})</span>
    </div>
  );
};

export const CorporateMinimal: React.FC<TemplateProps> = ({ data, editable = false, onDataChange }) => {
  const { company, client, quote } = data;
  const toast = useToast();

  // Ensure website URL has a protocol
  const ensureHttps = (url: string) => url.startsWith('http') ? url : `https://${url}`;

  const showFloorToast = useCallback(
    (message: string) => {
      toast({
        title: 'Below minimum',
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
    (row: ExecutiveSummaryRow, field: ExecEditField, value: number) => {
      if (!onDataChange) return;

      const primary =
        quote.items.find((i) => i.id === row.id) ||
        quote.items.find(
          (i) =>
            (i.serviceId || '').trim().toLowerCase() ===
            (row.catalogServiceId || '').trim().toLowerCase(),
        );
      if (!primary) return;

      const svc = resolveDbServiceForQuoteItem({
        serviceId: row.catalogServiceId || primary.serviceId,
        serviceName: primary.serviceName,
        description: primary.description,
        city: primary.city,
      });
      const floors = svc
        ? getVendorEditFloors(svc)
        : {
            minQty: null,
            minDuration: null,
            displayPriceFloor: null,
            displayPriceIsDaily: true,
            pfPriceFloor: null,
          };

      // Convert month UI → days / daily before validate + store
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatRate = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Filter GST lines from T&C (GST amount shown separately in a later phase)
  const filterGSTTerms = (terms: string[]) =>
    terms.filter(t => !/gst|tax\s*%|inclusive\s*of\s*(gst|tax)|exclusive\s*of\s*(gst|tax)|\+\s*gst|\d+\s*%\s*(gst|tax)/i.test(t));
  const normalizeTerms = normalizeTermsList;

  // Executive summary: one row per service_id (Display + P&F collapsed), amounts excl. GST
  const renderItemsTable = (items: QuoteItem[]) => {
    const rows = buildExecutiveSummaryRows(items);
    const hasRemark = rows.some((r) => r.remark);
    const subtotal = rows.reduce((sum, r) => sum + r.amountExclGst, 0);
    const gstPct = quote.gstPercentage > 0 ? quote.gstPercentage : 18;
    const totalInclGst = subtotal + (subtotal * gstPct) / 100;
    const labelColSpan = 5;
    const canEdit = Boolean(editable && onDataChange);
    return (
      <div className="table-scroll-wrap">
      <table className={`items-table items-table--exec${hasRemark ? ' items-table--has-remark' : ''}${canEdit ? ' items-table--editable' : ''}`}>
        <thead>
          <tr className="exec-thead-titles">
            <th className="col-service-id">SERVICE &amp; LOCATION</th>
            <th className="col-quantity">REQ QUANTITY</th>
            <th className="col-duration" title="Campaign duration">REQ DURATION</th>
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
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="item-service-id">
                <div className="item-title">{row.serviceId}</div>
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
                      <div className="item-unit-label">
                        ({row.ratePeriod === 'per_month' ? 'per month' : 'per day'})
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
          ))}
        </tbody>
        <tfoot>
          <tr className="tfoot-totals">
            <td className="tfoot-label" colSpan={labelColSpan}>Total (excl. GST)</td>
            <td className="tfoot-excl">{formatCurrency(subtotal)}</td>
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
              const title = line.descriptionLines[0] || '';
              const formula = line.descriptionLines.slice(1).join(' ') || null;
              const amountBlock = (
                <div className="breakdown-amount-stack">
                  <div className="breakdown-amount-inline">{formatCurrency(line.amount)}</div>
                  <div className="breakdown-excl-gst">(excl.gst)</div>
                </div>
              );
              return (
                <tr key={`${line.kind}-${idx}`}>
                  <td className="item-description breakdown-desc" colSpan={2}>
                    {formula ? (
                      <>
                        <div className="breakdown-desc-primary">{title}</div>
                        <div className="breakdown-formula-row">
                          <BreakdownFormulaBody
                            line={line}
                            canEdit={canEdit}
                            onCommit={commitExecEdit}
                          />
                          {amountBlock}
                        </div>
                      </>
                    ) : (
                      <div className="breakdown-formula-row">
                        <div className="breakdown-desc-primary" style={{ marginBottom: 0, flex: 1 }}>{title}</div>
                        {amountBlock}
                      </div>
                    )}
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

  // Render client details component (reusable)
  const renderClientDetails = () => {
    const primaryFields: React.ReactNode[] = [];
    const overflowFields: React.ReactNode[] = [];
    if (client.phone) primaryFields.push(<span key="ph">PH: <a className="contact-link" href={`tel:${client.phone}`}>{client.phone}</a></span>);
    if (client.email) overflowFields.push(<span key="em">Email: <a className="contact-link" href={`mailto:${client.email}`}>{client.email}</a></span>);
    if (client.address) overflowFields.push(<span key="ad">Address: {client.address}</span>);
    if (client.gst) overflowFields.push(<span key="gst">GST: {client.gst}</span>);

    return (
      <div className="client-section">
        <div className="client-inline-row">
          <span className="client-inline-label">Quote Prepared For: </span>
          <span className="client-inline-name">{(client.company || client.name).toUpperCase()}</span>
          {primaryFields.map((f, i) => (
            <span key={i}><span className="client-inline-sep"> | </span>{f}</span>
          ))}
        </div>
        {overflowFields.length > 0 && (
          <div className="client-overflow-row">
            {overflowFields.map((f, i) => (
              <span key={i}>{i > 0 && <span className="client-inline-sep"> | </span>}{f}</span>
            ))}
          </div>
        )}
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
    const hasItemTerms = quote.items.some(item => item.termsAndConditions?.trim());
    const allServiceTerms = quote.items[0]?.termsAndConditions || quote.termsAndConditions || '';
    const hasSpecificTerms = !!(hasItemTerms || quote.termsAndConditions?.trim());
    const singleTotal = 3;
    // Service-specific terms: show what's in the DB proposal (filtered for GST which is in table)
    const rawSingleTerms = hasSpecificTerms && allServiceTerms
      ? filterGSTTerms(normalizeTerms(allServiceTerms))
      : [];
    // Only show Service Terms if we have non-default content (avoids duplicating General Terms)
    const defaultFiltered = filterGSTTerms(DEFAULT_GENERAL_TERMS);
    const isDefaultContent = rawSingleTerms.length > 0
      && rawSingleTerms.length === defaultFiltered.length
      && rawSingleTerms.every((t, i) => t === defaultFiltered[i]);
    const singleTerms = isDefaultContent ? [] : rawSingleTerms;
    // General section always uses DEFAULT_GENERAL_TERMS — quote.termsAndConditions IS the service terms
    const generalTermsList = filterGSTTerms(DEFAULT_GENERAL_TERMS);
    const showGeneralSection = generalTermsList.length > 0;
    return (
      <>
        <div id="pdf-page-1" className="template-corporate-minimal">
          <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
            {renderHeader()}
            {renderClientDetails()}
          </div>

          <div className="quote-items-section">
            <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
              <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 8px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
                {extractServiceType(quote.items[0]?.description || '').toUpperCase()}
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
          {singleTerms.length > 0 && (
            <div className="terms-section" data-pdf-block="list" style={{ marginBottom: '24px' }}>
              <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
                Service Terms &amp; Conditions
              </h3>
              <ul>
                {singleTerms.map((term, i) => <li key={i}><span className="bullet-dot"></span>{term}</li>)}
              </ul>
            </div>
          )}
          {showGeneralSection && (
            <div className="terms-section" data-pdf-block="list">
              <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
                General Terms &amp; Conditions
              </h3>
              <ul>
                {generalTermsList.map((term, i) => <li key={i}><span className="bullet-dot"></span>{term}</li>)}
              </ul>
            </div>
          )}

          {/* Bank Details */}
          <div className="bank-details-card" data-pdf-block="atomic">
            <h3 className="bank-details-card-title">Bank Details</h3>
            <table className="bank-details-table">
              <tbody>
                <tr><td className="bank-label">Account Holder</td><td className="bank-colon">:</td><td className="bank-value">BALEEN MEDIA</td></tr>
                <tr><td className="bank-label">Account Number</td><td className="bank-colon">:</td><td className="bank-value">99999566030153</td></tr>
                <tr><td className="bank-label">IFSC</td><td className="bank-colon">:</td><td className="bank-value">HDFC0001866</td></tr>
                <tr><td className="bank-label">Branch</td><td className="bank-colon">:</td><td className="bank-value">ADYAR</td></tr>
                <tr><td className="bank-label">Account Type</td><td className="bank-colon">:</td><td className="bank-value">Current Account</td></tr>
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
            <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
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

      {/* Pages 2+: All service pages wrapped in one section so the smart block
          packer can flow services continuously without forced page breaks.
          The export service captures this as a single 'pdf-page-services' section
          and splits it into virtual pages only where content genuinely overflows. */}
      <div id="pdf-page-services" className="template-corporate-minimal">
        {serviceGroups.map((group, groupIndex) => {
          // Fallback to quote top-level terms when item-level is empty (same-service multi-city case
          // where hydration used the single-service path and put terms on quote.termsAndConditions)
          const groupTermsRaw = group.termsAndConditions || quote.termsAndConditions || '';
          const groupTerms = groupTermsRaw.trim()
            ? filterGSTTerms(normalizeTerms(groupTermsRaw))
            : [];
          return (
            <React.Fragment key={groupIndex}>
              <div className="quote-items-section">
                <div data-pdf-block="atomic" style={{ paddingBottom: '1px' }}>
                  <h3 style={{ marginBottom: '8px', fontSize: '22px', fontWeight: '700', color: '#750926', textAlign: 'center' }}>
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

              {/* Reference images, spec, review and terms merged into the same
                  section so the greedy block packer fills space after the
                  pricing table instead of starting a separate section. */}
              <ReferenceImages
                proposalPages={data.proposalPages}
                proposalPageMap={data.proposalPageMap}
                items={group.items}
                terms={groupTerms}
                serviceKey={(() => {
                  const city = group.city?.trim().toLowerCase();
                  return city && city !== '\u2014' ? `${city}|${group.serviceType.toLowerCase()}` : group.serviceType.toLowerCase();
                })()}
                onDataReady={data.onServiceDataReady}
              />
            </React.Fragment>
          );
        })}

        {/* Single shared footer for the entire services section —
            compositeWithPageFooter pins it to the bottom of every virtual page.
            Page numbers are overwritten by jsPDF's injection loop after all pages are captured. */}
        {renderCompanyFooter(0, 0)}
      </div>

      {/* Last Page: Terms & Conditions */}
      <div id="pdf-page-terms" className="template-corporate-minimal">
        {/* General Terms */}
        {(() => {
          // Always use DEFAULT_GENERAL_TERMS for the general section — same fix as single-service.
          // quote.termsAndConditions IS the service-specific DB terms so feeding it into
          // resolveGeneralTermsList caused service terms to appear as "general" terms.
          const multiGeneralTerms = filterGSTTerms(DEFAULT_GENERAL_TERMS);
          if (multiGeneralTerms.length === 0) return null;
          return (
        <div className="terms-section" data-pdf-block="list">
          <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
            General Terms &amp; Conditions
          </h3>
          <ul>
            {multiGeneralTerms.map((term, i) => <li key={i}><span className="bullet-dot"></span>{term}</li>)}
          </ul>
        </div>
          );
        })()}

        {/* Bank Details */}
        <div className="bank-details-card" data-pdf-block="atomic">
          <h3 className="bank-details-card-title">Bank Details</h3>
          <table className="bank-details-table">
            <tbody>
              <tr><td className="bank-label">Account Holder</td><td className="bank-colon">:</td><td className="bank-value">BALEEN MEDIA</td></tr>
              <tr><td className="bank-label">Account Number</td><td className="bank-colon">:</td><td className="bank-value">99999566030153</td></tr>
              <tr><td className="bank-label">IFSC</td><td className="bank-colon">:</td><td className="bank-value">HDFC0001866</td></tr>
              <tr><td className="bank-label">Branch</td><td className="bank-colon">:</td><td className="bank-value">ADYAR</td></tr>
              <tr><td className="bank-label">Account Type</td><td className="bank-colon">:</td><td className="bank-value">Current Account</td></tr>
            </tbody>
          </table>
        </div>

        {/* System Generated Notice */}
        <div className="system-generated-notice" data-pdf-block="atomic">
          <p>This is a system-generated quotation and does not require a signature.</p>
        </div>

        {/* Company Contact Footer */}
        {renderCompanyFooter(multiTotal, multiTotal)}
      </div>
    </>
  );
};


