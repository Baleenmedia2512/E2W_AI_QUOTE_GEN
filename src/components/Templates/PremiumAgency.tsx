import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading } from '../../utils/quoteGrouping';
import './PremiumAgency.css';

export const PremiumAgency: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
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
      month: 'long',
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
    <div id={isMultiService ? "pdf-page-summary" : "pdf-page-1"} className="template-premium-agency">
      {/* Header */}
      <div className="pa-header">
        <div className="pa-header-left">
          {company.logo && (
            <img src={company.logo} alt={company.name} className="pa-logo" />
          )}
          <div className="pa-company-name">{company.name}</div>
        </div>
        <div className="pa-header-right">
          <h1 className="pa-title">QUOTATION</h1>
          <div className="pa-title-rule"></div>
          <p className="pa-subtitle">{company.name}</p>
        </div>
      </div>

      {/* Info Strip */}
      <div className="pa-info-strip">
        <div className="pa-info-item">
          <span className="pa-info-label">Quote No.</span>
          <span className="pa-info-value">{quote.quoteNumber}</span>
        </div>
        <div className="pa-info-item">
          <span className="pa-info-label">Date Issued</span>
          <span className="pa-info-value">{formatDate(quote.date)}</span>
        </div>
        <div className="pa-info-item">
          <span className="pa-info-label">Valid Until</span>
          <span className="pa-info-value">{formatDate(quote.validUntil)}</span>
        </div>
      </div>

      {/* Body */}
      <div className="pa-body">
        {/* Parties */}
        <div className="pa-parties">
          <div className="pa-party-card">
            <div className="pa-party-label">FROM</div>
            <p className="pa-party-name">{company.name}</p>
            {company.phone && <p className="pa-party-detail">T: <a href={`tel:${company.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.phone}</a></p>}
            {company.email && <p className="pa-party-detail">E: <a href={`mailto:${company.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.email}</a></p>}
            {company.gst && <p className="pa-party-detail">GST: {company.gst}</p>}
            {company.abn && <p className="pa-party-detail pa-abn">ABN: {company.abn}</p>}
          </div>
          <div className="pa-party-card pa-party-accent">
            <div className="pa-party-label">TO</div>
            <p className="pa-party-name">{(client.company || client.name).toUpperCase()}</p>
            {client.email && <p className="pa-party-detail">E: <a href={`mailto:${client.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.email}</a></p>}
            {client.phone && <p className="pa-party-detail">T: <a href={`tel:${client.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.phone}</a></p>}
            {client.address && <p className="pa-party-detail">{client.address}</p>}
            {client.gst && <p className="pa-party-detail">GST: {client.gst}</p>}
          </div>
        </div>

        {/* Items Table */}
        <div className="pa-section">
          <h3 className="pa-section-title">Investment Breakdown</h3>
          <table className="pa-table">
            <thead>
              <tr>
                <th className="pa-col-num">#</th>
                <th className="pa-col-desc">Description</th>
                <th className="pa-col-qty">Qty</th>
                <th className="pa-col-rate">Rate</th>
                {quote.items.some(i => i.duration && i.duration > 1) && (
                  <th className="pa-col-dur">Dur.</th>
                )}
                <th className="pa-col-amt"><span className="th-main">AMOUNT</span><span className="th-sub">(excl GST)</span></th>
                {quote.gstEnabled && <th className="pa-col-gst-pct">GST %</th>}
                {quote.gstEnabled && <th className="pa-col-incl"><span className="th-main">AMOUNT</span><span className="th-sub">(incl GST)</span></th>}
                {hasRemark && <th className="pa-col-remark">Remark</th>}
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => {
                const itemGST = quote.gstEnabled ? item.total * (quote.gstPercentage / 100) : 0;
                const itemFinal = item.total + itemGST;
                return (
                  <tr key={index}>
                    <td className="pa-cell-num">{String(index + 1).padStart(2, '0')}</td>
                    <td className="pa-cell-desc">
                      <strong>{item.description}</strong>
                      {item.details && <div className="pa-item-details">{item.details}</div>}
                    </td>
                    <td className="pa-cell-qty">{item.quantity}</td>
                    <td className="pa-cell-rate">{formatCurrency(item.rate)}</td>
                    {quote.items.some(i => i.duration && i.duration > 1) && (
                      <td className="pa-cell-dur">{`${item.duration || 1} ${item.durationUnit === 'days' ? 'Da' : 'Mo'}`}</td>
                    )}
                    <td className="pa-cell-amt">{formatCurrency(item.total)}</td>
                    {quote.gstEnabled && <td className="pa-cell-gst-pct">{quote.gstPercentage}%</td>}
                    {quote.gstEnabled && <td className="pa-cell-incl">{formatCurrency(itemFinal)}</td>}
                    {hasRemark && <td className="pa-cell-remark">{item.remark || ''}</td>}
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
      <div className="pa-footer">
        <p>Thank you for considering {company.name.toUpperCase()} for your project</p>
        <p className="pa-footer-company">{company.name}</p>
      </div>
    </div>

    {!isMultiService && (
      <div id="pdf-page-2" className="template-premium-agency">
        <ReferenceImages proposalPages={data.proposalPages} proposalPageMap={data.proposalPageMap} items={quote.items} />

        {renderCompanyFooter(2)}
      </div>
    )}

    {/* Terms & Conditions Page (single-service) */}
    {!isMultiService && (
      <div id="pdf-page-3" className="template-premium-agency">
        <div className="pa-terms">
          <h3 className="pa-section-title">Terms & Conditions</h3>
          <div className="pa-terms-grid">
            {quote.termsAndConditions
              ? quote.termsAndConditions
                  .split(/\n|•|\d+\.\s/)
                  .map(t => t.trim())
                  .filter(Boolean)
                  .map((term, i) => (
                    <div className="pa-term-item" key={i}>
                      <span className="pa-term-check">&#10003;</span>
                      <span>{renderTermWithLinks(term)}</span>
                    </div>
                  ))
              : <div className="pa-term-item"><span className="pa-term-check">&#10003;</span><span>Standard terms and conditions apply</span></div>
            }
          </div>
        </div>

        {quote.items.map((item) => 
          item.termsAndConditions ? (
            <div key={item.id} className="pa-terms">
              <h3 className="pa-section-title">{item.description.split(' - ')[0]} — Terms & Conditions</h3>
              <div className="pa-terms-grid">
                {item.termsAndConditions
                  .split(/\n|•|\d+\.\s/)
                  .map(t => t.trim())
                  .filter(Boolean)
                  .map((term, i) => (
                    <div className="pa-term-item" key={i}>
                      <span className="pa-term-check">&#10003;</span>
                      <span>{renderTermWithLinks(term)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          ) : null
        )}

        <div className="pa-notice">
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
          <div id={`pdf-service-${groupIndex}`} className="template-premium-agency">
            <div className="pa-body">
              {/* Items Table */}
              <div className="pa-section">
                <h3 className="pa-section-title">{getServiceGroupHeading(group)}</h3>
                <table className="pa-table">
                  <thead>
                    <tr>
                      <th className="pa-col-num">#</th>
                      <th className="pa-col-desc">Description</th>
                      <th className="pa-col-qty">Qty</th>
                      <th className="pa-col-rate">Rate</th>
                      <th className="pa-col-amt"><span className="th-main">AMOUNT</span><span className="th-sub">(excl GST)</span></th>
                      {quote.gstEnabled && <th className="pa-col-gst-pct">GST %</th>}
                      {quote.gstEnabled && <th className="pa-col-incl"><span className="th-main">AMOUNT</span><span className="th-sub">(incl GST)</span></th>}
                      {hasRemarkGroup && <th className="pa-col-remark">Remark</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, index) => {
                      const itemGST = quote.gstEnabled ? item.total * (quote.gstPercentage / 100) : 0;
                      const itemFinal = item.total + itemGST;
                      return (
                        <tr key={index}>
                          <td className="pa-cell-num">{String(index + 1).padStart(2, '0')}</td>
                          <td className="pa-cell-desc">
                            <strong>{item.description}</strong>
                            {item.details && <div className="pa-item-details">{item.details}</div>}
                          </td>
                          <td className="pa-cell-qty">{item.quantity}</td>
                          <td className="pa-cell-rate">{formatCurrency(item.rate)}</td>
                          <td className="pa-cell-amt">{formatCurrency(item.total)}</td>
                          {quote.gstEnabled && <td className="pa-cell-gst-pct">{quote.gstPercentage}%</td>}
                          {quote.gstEnabled && <td className="pa-cell-incl">{formatCurrency(itemFinal)}</td>}
                          {hasRemarkGroup && <td className="pa-cell-remark">{item.remark || ''}</td>}
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

          <div id={`pdf-service-ref-${groupIndex}`} className="template-premium-agency">
            <ReferenceImages proposalPages={data.proposalPages} proposalPageMap={data.proposalPageMap} items={group.items} />

            {renderCompanyFooter(groupIndex * 2 + 3)}
          </div>
        </React.Fragment>
      );
    })}

    {/* Last Page: Terms & Conditions (multi-service) */}
    {isMultiService && (
      <div id="pdf-page-terms" className="template-premium-agency">
        <div className="pa-terms">
          <h3 className="pa-section-title">Terms & Conditions</h3>
          <div className="pa-terms-grid">
            {DEFAULT_GENERAL_TERMS.map((term, i) => (
              <div className="pa-term-item" key={i}>
                <span className="pa-term-check">&#10003;</span>
                <span>{term}</span>
              </div>
            ))}
          </div>
        </div>

        {serviceGroups.map((group, i) => (
          (group.termsAndConditions || quote.termsAndConditions) ? (
            <div key={i} className="pa-terms">
              <h3 className="pa-section-title">{getServiceGroupHeading(group)} — Terms & Conditions</h3>
              <div className="pa-terms-grid">
                {(group.termsAndConditions
                  ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                  : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                ).map((term, j) => (
                  <div className="pa-term-item" key={j}>
                    <span className="pa-term-check">&#10003;</span>
                    <span>{term}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        ))}

        <div className="pa-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
        </div>

        <div className="pa-footer">
          <p>{company.name.toUpperCase()} - Professional Branding Services</p>
          <p className="pa-footer-company">{company.name}</p>
        </div>

        {renderCompanyFooter(serviceGroups.length * 2 + 2)}
      </div>
    )}
    </>
  );
};
