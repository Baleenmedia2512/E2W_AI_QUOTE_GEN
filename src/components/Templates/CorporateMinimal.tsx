import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading, extractServiceType } from '../../utils/quoteGrouping';
import './CorporateMinimal.css';

export const CorporateMinimal: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
  const { company, client, quote } = data;

  // Ensure website URL has a protocol
  const ensureHttps = (url: string) => url.startsWith('http') ? url : `https://${url}`;

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
      maximumFractionDigits: 3
    }).format(amount);
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Parse GST % from terms text e.g. "GST 18% Extra" → 18
  const parseGSTFromTerms = (terms: string): number => {
    if (terms) {
      const match = terms.match(/GST\s+(\d+(?:\.\d+)?)\s*%/i) ||
                    terms.match(/(\d+(?:\.\d+)?)\s*%\s*GST/i);
      if (match) return parseFloat(match[1]);
    }
    return quote.gstPercentage;
  };

  // GST % sourced from terms & conditions text
  const gstPct = parseGSTFromTerms(quote.termsAndConditions || '');

  // Filter out GST-related terms since GST is already shown in the table columns
  const filterGSTTerms = (terms: string[]) =>
    terms.filter(t => !/gst|tax\s*%|inclusive\s*of\s*(gst|tax)|exclusive\s*of\s*(gst|tax)|\+\s*gst|\d+\s*%\s*(gst|tax)/i.test(t));
  const normalizeTerms = (rawTerms: string) =>
    rawTerms.split('\n').map(t => t.trim().replace(/^[\u2022\u2023\u25aa\u25cf\-\–\*•]\s*/, '').replace(/\s*\|\s*/g, ' ').trim()).filter(Boolean);

  // Reusable items table with per-item GST breakdown columns
  const renderItemsTable = (items: typeof quote.items) => {
    const hasDuration = items.some(i => i.duration && i.duration > 1);
    const hasRemark = items.some(i => i.remark);
    const formatDuration = (item: typeof quote.items[0]) => {
      const dur = item.duration || 1;
      const unit = item.durationUnit === 'days' ? 'Da' : 'Mo';
      return `${dur} ${unit}`;
    };
    const subtotal = items.reduce((sum, i) => sum + i.total, 0);
    const gstAmt = quote.gstEnabled ? subtotal * gstPct / 100 : 0;
    const inclGST = subtotal + gstAmt;
    return (
      <div className="table-scroll-wrap">
      <table className={`items-table${quote.gstEnabled ? ' items-table--gst' : ''}`}>
        <thead>
          <tr>
            <th className="col-description">Description</th>
            <th className="col-quantity">QTY</th>
            <th className="col-rate">UNIT RATE</th>
            {hasDuration && <th className="col-duration">Duration</th>}
            {!quote.gstEnabled && <th className="col-total"><span className="th-main">AMOUNT</span></th>}
            {quote.gstEnabled && <th className="col-gst-pct">GST %</th>}
            {quote.gstEnabled && <th className="col-final"><span className="th-main">AMOUNT</span><span className="th-sub">(incl.GST)</span></th>}
            {hasRemark && <th className="col-remark">Remark</th>}
          </tr>
        </thead>
        <tbody>
          {items.filter(item => item.rate !== 0 || item.total !== 0).map((item) => {
            const itemGST = quote.gstEnabled ? item.total * gstPct / 100 : 0;
            const itemFinal = item.total + itemGST;
            return (
              <tr key={item.id}>
                <td className="item-description">
                  <div className="item-title">{item.description}</div>
                  {item.details && <div className="item-details">{item.details}</div>}
                </td>
                <td className="item-quantity">{item.quantity}</td>
                <td className="item-rate">{formatRate(item.rate)}</td>
                {hasDuration && <td className="item-duration">{formatDuration(item)}</td>}
                {!quote.gstEnabled && <td className="item-total">{formatCurrency(item.total)}</td>}
                {quote.gstEnabled && <td className="item-gst-pct">{gstPct}%</td>}
                {quote.gstEnabled && <td className="item-final">{formatCurrency(itemFinal)}</td>}
                {hasRemark && <td className="item-remark">{item.remark || ''}</td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="tfoot-totals">
            <td className="tfoot-label" colSpan={hasDuration ? 4 : 3}>Total</td>
            {!quote.gstEnabled && <td className="tfoot-excl">{formatCurrency(subtotal)}</td>}
            {quote.gstEnabled && <td className="tfoot-gst-pct"></td>}
            {quote.gstEnabled && <td className="tfoot-incl">{formatCurrency(inclGST)}</td>}
            {hasRemark && <td></td>}
          </tr>
        </tfoot>
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
                <span className="meta-label">Date:</span>
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
  const renderClientDetails = () => (
    <div className="client-section">
      <h3>Quote Prepared For:</h3>
      <div className="client-details">
        <p className="client-name">{(client.company || client.name).toUpperCase()}</p>
        {client.email && <p>Email: <a className="contact-link" href={`mailto:${client.email}`}>{client.email}</a></p>}
        {client.phone && <p>Phone: <a className="contact-link" href={`tel:${client.phone}`}>{client.phone}</a></p>}
        {client.address && <p>Address: {client.address}</p>}
        {client.gst && <p>GST: {client.gst}</p>}
      </div>
    </div>
  );

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
    const hasSpecificTerms = quote.items.some(item => item.termsAndConditions) || !!quote.termsAndConditions;
    const singleTotal = 3;
    const singleTerms = hasSpecificTerms
      ? filterGSTTerms(
          quote.items[0]?.termsAndConditions
            ? normalizeTerms(quote.items[0].termsAndConditions)
            : filterTermsByServiceType(quote.termsAndConditions, extractServiceType(quote.items[0]?.description || ''))
        )
      : [];
    return (
      <>
        <div id="pdf-page-1" className="template-corporate-minimal">
          <div data-pdf-block="atomic">
            {renderHeader()}
            {renderClientDetails()}
          </div>

          <div className="quote-items-section">
            <div data-pdf-block="atomic">
              <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 8px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
                {extractServiceType(quote.items[0]?.description || '').toUpperCase()}
              </h3>
              <h3 className="smart-section-heading" style={{ fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1a1a2e', margin: '16px 0 14px 0', paddingBottom: '8px', borderBottom: '2px solid #2980b9' }}>
                <span className="smart-heading-bar" />
                1. Pricing Summary
              </h3>
            </div>
            <div data-pdf-block="table">
              {renderItemsTable(quote.items)}
            </div>
            {/* Spec + Reference Images in same section — virtual page engine packs them together */}
            <ReferenceImages
              proposalPages={data.proposalPages}
              proposalPageMap={data.proposalPageMap}
              items={quote.items}
              terms={[]}
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
          <div className="terms-section" data-pdf-block="list">
            <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
              General Terms &amp; Conditions
            </h3>
            <ul>
              {DEFAULT_GENERAL_TERMS.map((term, i) => <li key={i}><span className="bullet-dot"></span>{term}</li>)}
            </ul>
          </div>

          {/* Bank Details */}
          <div className="terms-section bank-details-section" data-pdf-block="atomic" style={{ marginTop: '24px' }}>
            <h3 style={{ textAlign: 'center', fontSize: '24px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
              Bank Details
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '16px', color: '#1a1a2e' }}>
              <tbody>
                <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Account Holder</td><td style={{ padding: '4px 0' }}>: BALEEN MEDIA</td></tr>
                <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Account Number</td><td style={{ padding: '4px 0' }}>: 99999566030153</td></tr>
                <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>IFSC</td><td style={{ padding: '4px 0' }}>: HDFC0001866</td></tr>
                <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Branch</td><td style={{ padding: '4px 0' }}>: ADYAR</td></tr>
                <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Account Type</td><td style={{ padding: '4px 0' }}>: Current Account</td></tr>
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
        <div data-pdf-block="atomic">
          {renderHeader()}
          {renderClientDetails()}
        </div>

        <div className="quote-items-section">
          <div data-pdf-block="atomic">
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

      {/* Pages 2+: Individual Service Pages */}
      {serviceGroups.map((group, groupIndex) => {
        const servicePage = ++pageCounter;
        const refPage = ++pageCounter;
        const hasGroupTerms = !!(group.termsAndConditions || quote.termsAndConditions);
        const groupTerms = hasGroupTerms
          ? filterGSTTerms(group.termsAndConditions
              ? normalizeTerms(group.termsAndConditions)
              : filterTermsByServiceType(quote.termsAndConditions, group.serviceType))
          : [];
        return (
          <React.Fragment key={groupIndex}>
            <div style={{ pageBreakBefore: 'always' }} />
            <>
              <div id={`pdf-service-${groupIndex}`} className="template-corporate-minimal">
                <div className="quote-items-section">
                  <div data-pdf-block="atomic">
                    <h3 style={{ marginBottom: '8px', fontSize: '22px', fontWeight: '700', color: '#750926', textAlign: 'center' }}>
                      {getServiceGroupHeading(group)}
                    </h3>
                    <h3 className="smart-section-heading" style={{ fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1a1a2e', margin: '24px 0 14px 0', paddingBottom: '8px', borderBottom: '2px solid #2980b9' }}>
                      <span className="smart-heading-bar" />
                      1. Pricing Summary
                    </h3>
                  </div>
                  <div data-pdf-block="table">
                    {renderItemsTable(group.items)}
                  </div>
                </div>

                {/* Reference images, spec, review and terms merged into the same
                    section so the greedy block packer fills space after the
                    pricing table instead of starting a separate section. */}
                <ReferenceImages proposalPages={data.proposalPages} proposalPageMap={data.proposalPageMap} items={group.items} terms={groupTerms} />

                {/* Company Contact Footer */}
                {renderCompanyFooter(servicePage, multiTotal)}
              </div>
            </>
          </React.Fragment>
        );
      })}

      {/* Last Page: Terms & Conditions */}
      <div id="pdf-page-terms" className="template-corporate-minimal">
        {/* General Terms */}
        <div className="terms-section" data-pdf-block="list">
          <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
            General Terms &amp; Conditions
          </h3>
          <ul>
            {DEFAULT_GENERAL_TERMS.map((term, i) => <li key={i}><span className="bullet-dot"></span>{term}</li>)}
          </ul>
        </div>

        {/* Bank Details */}
        <div className="terms-section bank-details-section" data-pdf-block="atomic" style={{ marginTop: '24px' }}>
          <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>
            Bank Details
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', color: '#1a1a2e' }}>
            <tbody>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Account Holder</td><td style={{ padding: '4px 0' }}>: BALEEN MEDIA</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Account Number</td><td style={{ padding: '4px 0' }}>: 99999566030153</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>IFSC</td><td style={{ padding: '4px 0' }}>: HDFC0001866</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Branch</td><td style={{ padding: '4px 0' }}>: ADYAR</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: '600', whiteSpace: 'nowrap' }}>Account Type</td><td style={{ padding: '4px 0' }}>: Current Account</td></tr>
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


