import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading } from '../../utils/quoteGrouping';
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
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
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

  // Reusable items table with per-item GST breakdown columns
  const renderItemsTable = (items: typeof quote.items) => {
    const hasDuration = items.some(i => i.duration && i.duration > 1);
    const hasRemark = items.some(i => i.remark);
    const formatDuration = (item: typeof quote.items[0]) => {
      if (!item.duration || item.duration <= 1) return '1';
      const unit = item.durationUnit === 'days' ? 'Days' : 'Months';
      return `${item.duration} ${unit}`;
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
            <th className="col-quantity">Quantity</th>
            <th className="col-rate">Rate</th>
            {hasDuration && <th className="col-duration">Duration</th>}
            <th className="col-total"><span className="th-main">AMOUNT</span><span className="th-sub">(excl.GST)</span></th>
            {quote.gstEnabled && <th className="col-gst-pct">GST %</th>}
            {quote.gstEnabled && <th className="col-final"><span className="th-main">AMOUNT</span><span className="th-sub">(incl.GST)</span></th>}
            {hasRemark && <th className="col-remark">Remark</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
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
                <td className="item-total">{formatCurrency(item.total)}</td>
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
            <td className="tfoot-excl">{formatCurrency(subtotal)}</td>
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
      <div className="header-info-row">
        <div className="company-details">
          {company.phone && <p>Phone: <a href={`tel:${company.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.phone}</a></p>}
          {company.email && <p>Email: <a href={`mailto:${company.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.email}</a></p>}
          {company.gst && <p>GST: {company.gst}</p>}
          {company.abn && <p>ABN: {company.abn}</p>}
        </div>
        {showMetaInfo && (
          <div className="quote-meta">
            <h2>QUOTATION</h2>
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
        {client.email && <p>Email: <a href={`mailto:${client.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.email}</a></p>}
        {client.phone && <p>Phone: <a href={`tel:${client.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.phone}</a></p>}
        {client.address && <p>Address: {client.address}</p>}
        {client.gst && <p>GST: {client.gst}</p>}
      </div>
    </div>
  );

  // Render company contact footer (appears on every page)
  const renderCompanyFooter = (pageNum: number) => (
    <div className="company-contact-footer">
      <div className="footer-divider"></div>
      <div className="footer-content">
        {company.website && <span className="footer-item">🌐 <a href={ensureHttps(company.website)} style={{ color: 'inherit', textDecoration: 'none' }}>{company.website}</a></span>}
        {company.address && <span className="footer-item">📍 {company.address}</span>}
        <span className="footer-page-number">{pageNum}</span>
      </div>
    </div>
  );

  // Single service quote (original behavior)
  if (!isMultiService) {
    return (
      <>
        <div id="pdf-page-1" className="template-corporate-minimal">
          {renderHeader()}
          {renderClientDetails()}

          <div className="quote-items-section">
            {renderItemsTable(quote.items)}
          </div>

          {/* Company Contact Footer */}
          {renderCompanyFooter(1)}
        </div>

        <div id="pdf-page-2" className="template-corporate-minimal">
          <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />

          {/* Company Contact Footer */}
          {renderCompanyFooter(2)}
        </div>

        {/* Terms & Conditions Page */}
        <div id="pdf-page-3" className="template-corporate-minimal">
          {/* General Terms */}
          <div className="terms-section">
            <h3>Terms & Conditions:</h3>
            <ul>
              {quote.termsAndConditions
                ? filterGSTTerms(quote.termsAndConditions
                    .split(/\n|•|\d+\.\s/)
                    .map(t => t.trim())
                    .filter(Boolean))
                    .map((term, i) => <li key={i}>{renderTermWithLinks(term)}</li>)
                : <li>Standard terms and conditions apply</li>
              }
            </ul>
          </div>

          {/* Item-specific Terms */}
          {quote.items.map((item) => 
            item.termsAndConditions ? (
              <div key={item.id} className="terms-section">
                <h3>{item.description.split(' - ')[0]} — <span style={{ textTransform: 'none' }}>SPECIFIC Ts & Cs</span></h3>
                <ul>
                  {filterGSTTerms(item.termsAndConditions
                    .split(/\n|•|\d+\.\s/)
                    .map(t => t.trim())
                    .filter(Boolean))
                    .map((term, i) => <li key={i}>{renderTermWithLinks(term)}</li>)
                  }
                </ul>
              </div>
            ) : null
          )}

          {/* System Generated Notice */}
          <div className="system-generated-notice">
            <p>This is a system-generated quotation and does not require a signature.</p>
          </div>

          {/* Company Contact Footer */}
          {renderCompanyFooter(3)}
        </div>
      </>
    );
  }

  // Multi-service quote - render summary + individual service pages
  return (
    <>
      {/* Page 1: Summary Page */}
      <div id="pdf-page-summary" className="template-corporate-minimal">
        {renderHeader()}
        {renderClientDetails()}

        <div className="quote-items-section">
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>
            Quote Summary - All Services
          </h3>
          {renderItemsTable(quote.items)}
        </div>

        {/* Company Contact Footer */}
        {renderCompanyFooter(1)}
      </div>

      {/* Pages 2+: Individual Service Pages */}
      {serviceGroups.map((group, groupIndex) => {
        return (
          <React.Fragment key={groupIndex}>
            <div style={{ pageBreakBefore: 'always' }} />
            <>
              <div id={`pdf-service-${groupIndex}`} className="template-corporate-minimal">
                <div className="quote-items-section">
                  <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600', color: '#750926' }}>
                    {getServiceGroupHeading(group)}
                  </h3>
                  {renderItemsTable(group.items)}
                </div>

                {/* Company Contact Footer */}
                {renderCompanyFooter(groupIndex * 2 + 2)}
              </div>

              <div id={`pdf-service-ref-${groupIndex}`} className="template-corporate-minimal">
                <ReferenceImages proposalPages={data.proposalPages} items={group.items} />

                {renderCompanyFooter(groupIndex * 2 + 3)}
              </div>
            </>
          </React.Fragment>
        );
      })}

      {/* Last Page: Terms & Conditions */}
      <div id="pdf-page-terms" className="template-corporate-minimal">
        {/* General Terms */}
        <div className="terms-section">
          <h3>Terms & Conditions:</h3>
          <ul>
            {DEFAULT_GENERAL_TERMS.map((term, i) => <li key={i}>{term}</li>)}
          </ul>
        </div>

        {/* Service-Specific Terms */}
        {serviceGroups.map((group, i) => (
          (group.termsAndConditions || quote.termsAndConditions) ? (
            <div key={i} className="terms-section">
              <h3>{getServiceGroupHeading(group)} — <span style={{ textTransform: 'none' }}>SPECIFIC Ts & Cs</span></h3>
              <ul>
                {filterGSTTerms(group.termsAndConditions
                  ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                  : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                ).map((term, j) => <li key={j}>{term}</li>)}
              </ul>
            </div>
          ) : null
        ))}

        {/* System Generated Notice */}
        <div className="system-generated-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
        </div>

        {/* Company Contact Footer */}
        {renderCompanyFooter(serviceGroups.length * 2 + 2)}
      </div>
    </>
  );
};
