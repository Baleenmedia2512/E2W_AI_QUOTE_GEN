import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading } from '../../utils/quoteGrouping';
import './ModernSales.css';

export const ModernSales: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
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
  const hasRemark = quote.items.some(i => i.remark);

  const calculateSubtotal = () => {
    return quote.items.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateGST = () => {
    const subtotal = calculateSubtotal();
    return quote.gstEnabled ? subtotal * (quote.gstPercentage / 100) : 0;
  };

  const calculateTotal = () => {
    return calculateSubtotal() + calculateGST();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
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

  return (
    <>
    <div id={isMultiService ? "pdf-page-summary" : "pdf-page-1"} className="template-modern-sales">
      {/* Header */}
      <div className="ms-header">
        <div className="ms-header-left">
          {company.logo && (
            <img src={company.logo} alt={company.name} className="ms-logo" />
          )}
          <div className="ms-company-name">{company.name}</div>
        </div>
        <div className="ms-header-right">
          <h1 className="ms-title">QUOTATION</h1>
          <div className="ms-title-accent"></div>
        </div>
      </div>

      {/* Quote Info Strip */}
      <div className="ms-info-strip">
        <div className="ms-info-item">
          <span className="ms-info-label">Quote No.</span>
          <span className="ms-info-value">{quote.quoteNumber}</span>
        </div>
        <div className="ms-info-item">
          <span className="ms-info-label">Date Issued</span>
          <span className="ms-info-value">{formatDate(quote.date)}</span>
        </div>
        <div className="ms-info-item">
          <span className="ms-info-label">Valid Until</span>
          <span className="ms-info-value">{formatDate(quote.validUntil)}</span>
        </div>
      </div>

      {/* Body Content */}
      <div className="ms-body">
        {/* From / To Cards */}
        <div className="ms-parties">
          <div className="ms-party-card">
            <div className="ms-party-label">FROM</div>
            <p className="ms-party-name">{company.name}</p>
            {company.phone && <p className="ms-party-detail">T: <a href={`tel:${company.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.phone}</a></p>}
            {company.email && <p className="ms-party-detail">E: <a href={`mailto:${company.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.email}</a></p>}
            {company.gst && <p className="ms-party-detail">GST: {company.gst}</p>}
            {company.abn && <p className="ms-party-detail ms-abn">ABN: {company.abn}</p>}
          </div>
          <div className="ms-party-card ms-party-accent">
            <div className="ms-party-label">TO</div>
            <p className="ms-party-name">{(client.company || client.name).toUpperCase()}</p>
            {client.email && <p className="ms-party-detail">E: <a href={`mailto:${client.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.email}</a></p>}
            {client.phone && <p className="ms-party-detail">T: <a href={`tel:${client.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.phone}</a></p>}
            {client.address && <p className="ms-party-detail">{client.address}</p>}
            {client.gst && <p className="ms-party-detail">GST: {client.gst}</p>}
          </div>
        </div>

        {/* Items Table */}
        <div className="ms-section">
          {isMultiService
            ? <h3 style={{ textAlign: 'center', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#3b0a14', margin: '0 0 18px 0', paddingBottom: '10px', borderBottom: '2px solid #2980b9' }}>Executive Pricing Summary</h3>
            : <h3 className="ms-section-title">Scope of Work &amp; Pricing</h3>
          }
          <table className="ms-table">
            <thead>
              <tr>
                <th className="ms-col-num">#</th>
                <th className="ms-col-desc">Description</th>
                <th className="ms-col-qty">QTY</th>
                <th className="ms-col-rate">UNIT RATE</th>
                {quote.items.some(i => i.duration && i.duration > 1) && (
                  <th className="ms-col-dur">Months</th>
                )}
                <th className="ms-col-amt"><span className="th-main">AMOUNT</span><span className="th-sub">(excl GST)</span></th>
                {quote.gstEnabled && <th className="ms-col-gst-pct">GST %</th>}
                {quote.gstEnabled && <th className="ms-col-incl"><span className="th-main">AMOUNT</span><span className="th-sub">(incl GST)</span></th>}
                {hasRemark && <th className="ms-col-remark">Remark</th>}
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => {
                const itemGST = quote.gstEnabled ? item.total * (quote.gstPercentage / 100) : 0;
                const itemFinal = item.total + itemGST;
                return (
                  <tr key={index}>
                    <td className="ms-cell-num">{index + 1}</td>
                    <td className="ms-cell-desc">
                      <strong>{item.description}</strong>
                      {item.details && <div className="ms-item-details">{item.details}</div>}
                    </td>
                    <td className="ms-cell-qty">{item.quantity}</td>
                    <td className="ms-cell-rate">{formatCurrency(item.rate)}</td>
                    {quote.items.some(i => i.duration && i.duration > 1) && (
                      <td className="ms-cell-dur">{item.duration || 1}</td>
                    )}
                    <td className="ms-cell-amt">{formatCurrency(item.total)}</td>
                    {quote.gstEnabled && <td className="ms-cell-gst-pct">{quote.gstPercentage}%</td>}
                    {quote.gstEnabled && <td className="ms-cell-incl">{formatCurrency(itemFinal)}</td>}
                    {hasRemark && <td className="ms-cell-remark">{item.remark || ''}</td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="tfoot-totals">
                <td className="tfoot-label" colSpan={quote.items.some(i => i.duration && i.duration > 1) ? 5 : 4}>Total</td>
                <td className="tfoot-excl">{formatCurrency(calculateSubtotal())}</td>
                {quote.gstEnabled && <td className="tfoot-gst-pct"></td>}
                {quote.gstEnabled && <td className="tfoot-incl">{formatCurrency(calculateTotal())}</td>}
                {hasRemark && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>

      </div>

      {/* Company Contact Footer */}
      {renderCompanyFooter(1)}

      {/* Footer */}
      <div className="ms-footer">
        <p>Thank you for your business | {company.name.toUpperCase()}</p>
        {company.website && <p><a href={ensureHttps(company.website)} style={{ color: 'inherit', textDecoration: 'none' }}>{company.website}</a></p>}
        <p className="ms-footer-company">{company.name}</p>
      </div>
    </div>
    
    {!isMultiService && (
      <div id="pdf-page-2" className="template-modern-sales">
        <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />

        {renderCompanyFooter(2)}
      </div>
    )}

    {/* Terms & Conditions Page (single-service) */}
    {!isMultiService && (
      <div id="pdf-page-3" className="template-modern-sales">
        <div className="ms-terms">
          <h3 className="ms-section-title">Terms & Conditions</h3>
          <div className="ms-terms-grid">
            {quote.termsAndConditions
              ? quote.termsAndConditions
                  .split(/\n|•|\d+\.\s/)
                  .map(t => t.trim())
                  .filter(Boolean)
                  .map((term, i) => (
                    <div className="ms-term-item" key={i}>
                      <span className="ms-term-check">&#10003;</span>
                      <span>{renderTermWithLinks(term)}</span>
                    </div>
                  ))
              : <div className="ms-term-item"><span className="ms-term-check">&#10003;</span><span>Standard terms and conditions apply</span></div>
            }
          </div>
        </div>

        {quote.items.map((item) => 
          item.termsAndConditions ? (
            <div key={item.id} className="ms-terms">
              <h3 className="ms-section-title">{item.description.split(' - ')[0]} — Terms & Conditions</h3>
              <div className="ms-terms-grid">
                {item.termsAndConditions
                  .split(/\n|•|\d+\.\s/)
                  .map(t => t.trim())
                  .filter(Boolean)
                  .map((term, i) => (
                    <div className="ms-term-item" key={i}>
                      <span className="ms-term-check">&#10003;</span>
                      <span>{renderTermWithLinks(term)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          ) : null
        )}

        <div className="ms-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
        </div>

        {renderCompanyFooter(3)}
      </div>
    )}
    
    {/* Multi-Service: Individual Service Pages */}
    {isMultiService && serviceGroups.map((group, groupIndex) => {
      const groupSubtotal = group.subtotal;
      const groupGST = quote.gstEnabled ? groupSubtotal * (quote.gstPercentage / 100) : 0;
      const groupTotal = groupSubtotal + groupGST;
      const hasRemarkGroup = group.items.some((i: any) => i.remark);
      
      return (
        <React.Fragment key={groupIndex}>
          <div style={{ pageBreakBefore: 'always' }} />
          <div id={`pdf-service-${groupIndex}`} className="template-modern-sales">
            <div className="ms-body">
              {/* Items */}
              <div className="ms-section">
                <h3 className="ms-section-title" style={{ textAlign: 'center', fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>{getServiceGroupHeading(group)}</h3>
                <h3 className="smart-section-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1a1a2e', margin: '24px 0 14px 0', paddingBottom: '8px', borderBottom: '2px solid #2980b9' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '18px', background: '#2980b9', borderRadius: '2px', flexShrink: 0 }} />
                  1. Pricing Summary
                </h3>
                <table className="ms-table">
                  <thead>
                    <tr>
                      <th className="ms-col-num">#</th>
                      <th className="ms-col-desc">Description</th>
                      <th className="ms-col-qty">QTY</th>
                      <th className="ms-col-rate">UNIT RATE</th>
                      <th className="ms-col-amt"><span className="th-main">AMOUNT</span><span className="th-sub">(excl GST)</span></th>
                      {quote.gstEnabled && <th className="ms-col-gst-pct">GST %</th>}
                      {quote.gstEnabled && <th className="ms-col-incl"><span className="th-main">AMOUNT</span><span className="th-sub">(incl GST)</span></th>}
                      {hasRemarkGroup && <th className="ms-col-remark">Remark</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, index) => {
                      const itemGST = quote.gstEnabled ? item.total * (quote.gstPercentage / 100) : 0;
                      const itemFinal = item.total + itemGST;
                      return (
                        <tr key={index}>
                          <td className="ms-cell-num">{index + 1}</td>
                          <td className="ms-cell-desc">
                            <strong>{item.description}</strong>
                            {item.details && <div className="ms-item-details">{item.details}</div>}
                          </td>
                          <td className="ms-cell-qty">{item.quantity}</td>
                          <td className="ms-cell-rate">{formatCurrency(item.rate)}</td>
                          <td className="ms-cell-amt">{formatCurrency(item.total)}</td>
                          {quote.gstEnabled && <td className="ms-cell-gst-pct">{quote.gstPercentage}%</td>}
                          {quote.gstEnabled && <td className="ms-cell-incl">{formatCurrency(itemFinal)}</td>}
                          {hasRemarkGroup && <td className="ms-cell-remark">{item.remark || ''}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="tfoot-totals">
                      <td className="tfoot-label" colSpan={4}>Total</td>
                      <td className="tfoot-excl">{formatCurrency(groupSubtotal)}</td>
                      {quote.gstEnabled && <td className="tfoot-gst-pct"></td>}
                      {quote.gstEnabled && <td className="tfoot-incl">{formatCurrency(groupTotal)}</td>}
                      {hasRemarkGroup && <td></td>}
                    </tr>
                  </tfoot>
                </table>
              </div>

            </div>
            
            {/* Company Contact Footer */}
            {renderCompanyFooter(groupIndex * 2 + 2)}
          </div>

          <div id={`pdf-service-ref-${groupIndex}`} className="template-modern-sales">
            <ReferenceImages proposalPages={data.proposalPages} items={group.items} />

            {renderCompanyFooter(groupIndex * 2 + 3)}
          </div>

          {(group.termsAndConditions || quote.termsAndConditions) && (
            <div id={`pdf-service-specific-terms-${groupIndex}`} className="template-modern-sales">
              <div className="ms-terms">
                <h3 className="smart-section-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1a1a2e', margin: '0 0 14px 0', paddingBottom: '8px', borderBottom: '2px solid #2980b9' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '18px', background: '#2980b9', borderRadius: '2px', flexShrink: 0 }} />
                  5. Terms &amp; Conditions
                </h3>
                <div className="ms-terms-grid">
                  {(group.termsAndConditions
                    ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                    : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                  ).map((term, j) => (
                    <div className="ms-term-item" key={j}>
                      <span className="ms-term-check">&#10003;</span>
                      <span>{renderTermWithLinks(term)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {renderCompanyFooter(groupIndex * 2 + 4)}
            </div>
          )}
        </React.Fragment>
      );
    })}

    {/* Last Page: Terms & Conditions (multi-service) */}
    {isMultiService && (
      <div id="pdf-page-terms" className="template-modern-sales">
        <div className="ms-terms">
          <h3 className="smart-section-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1a1a2e', margin: '0 0 14px 0', paddingBottom: '8px', borderBottom: '2px solid #2980b9' }}>
            <span style={{ display: 'inline-block', width: '4px', height: '18px', background: '#2980b9', borderRadius: '2px', flexShrink: 0 }} />
            6. Terms &amp; Conditions
          </h3>
          <div className="ms-terms-grid">
            {DEFAULT_GENERAL_TERMS.map((term, i) => (
              <div className="ms-term-item" key={i}>
                <span className="ms-term-check">&#10003;</span>
                <span>{term}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ms-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
        </div>

        <div className="ms-footer">
          <p>{company.name.toUpperCase()} - Professional Branding Services</p>
          <p className="ms-footer-company">{company.name}</p>
        </div>

        {renderCompanyFooter(serviceGroups.length * 2 + 2)}
      </div>
    )}
    </>
  );
};
