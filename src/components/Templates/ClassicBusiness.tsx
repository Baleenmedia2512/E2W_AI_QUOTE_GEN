import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading } from '../../utils/quoteGrouping';
import './ClassicBusiness.css';

export const ClassicBusiness: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
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
    <div className="template-classic-business">
      <div className="classic-container">
        <div id={isMultiService ? "pdf-page-summary" : "pdf-page-1"} className="template-classic-business">
        {/* Letterhead */}
        <div className="letterhead">
          <div className="letterhead-content">
            {company.logo && (
              <div className="logo-container">
                <img src={company.logo} alt={company.name} className="letterhead-logo" />
              </div>
            )}
            <div className="letterhead-right">
              <h1 className="letterhead-title">QUOTATION</h1>
              <div className="letterhead-divider"></div>
              <p className="letterhead-subtitle">{company.name}</p>
            </div>
          </div>
          <div className="ornamental-line"></div>
        </div>

        {/* Company Contact Details */}
        <div className="company-contact-section">
          <div className="company-contact-details">
            {company.phone && <p>Phone: <a href={`tel:${company.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.phone}</a></p>}
            {company.email && <p>Email: <a href={`mailto:${company.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{company.email}</a></p>}
            {company.gst && <p>GST: {company.gst}</p>}
            {company.abn && <p>ABN: {company.abn}</p>}
          </div>
        </div>

        {/* Reference Section */}
        <div className="reference-section">
          <table className="reference-table">
            <tbody>
              <tr>
                <td className="ref-label">Quote Number:</td>
                <td className="ref-value">{quote.quoteNumber}</td>
                <td className="ref-label">Date:</td>
                <td className="ref-value">{formatDate(quote.date)}</td>
              </tr>
              <tr>
                <td className="ref-label">Valid Until:</td>
                <td className="ref-value">{formatDate(quote.validUntil)}</td>
                <td className="ref-label">Currency:</td>
                <td className="ref-value">INR</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Client Address Block */}
        <div className="address-block">
          <div className="address-label">To:</div>
          <div className="address-content">
            <p className="recipient-name">{(client.company || client.name).toUpperCase()}</p>
            {client.address && <p>{client.address}</p>}
            {client.email && <p>Email: <a href={`mailto:${client.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.email}</a></p>}
            {client.phone && <p>Phone: <a href={`tel:${client.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>{client.phone}</a></p>}
            {client.gst && <p>GST: {client.gst}</p>}
          </div>
        </div>

        {/* Introduction */}
        <div className="introduction">
          <p>Dear {client.name.toUpperCase()},</p>
          <p>
            Thank you for your interest in our services. We are pleased to submit this quotation
            for your consideration. Below you will find a detailed breakdown of the proposed
            services and associated costs.
          </p>
        </div>

        {/* Items Table */}
        <div className="items-section">
          <h3 className="section-heading">Scope of Work & Pricing</h3>
          <table className="classic-table">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th className="col-description">Description</th>
                <th className="col-qty">Qty</th>
                <th className="col-rate">Unit Price</th>
                {quote.items.some(i => i.duration && i.duration > 1) && (
                  <th className="col-duration">Dur.</th>
                )}
                <th className="col-amount"><span className="th-main">AMOUNT</span><span className="th-sub">(excl GST)</span></th>
                {quote.gstEnabled && <th className="col-gst-pct">GST %</th>}
                {quote.gstEnabled && <th className="col-incl"><span className="th-main">AMOUNT</span><span className="th-sub">(incl GST)</span></th>}
                {hasRemark && <th className="col-remark">Remark</th>}
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => {
                const itemGST = quote.gstEnabled ? item.total * (quote.gstPercentage / 100) : 0;
                const itemFinal = item.total + itemGST;
                return (
                  <tr key={index}>
                    <td className="cell-num">{index + 1}</td>
                    <td className="cell-description">
                      <strong>{item.description}</strong>
                      {item.details && (
                        <div className="description-details">{item.details}</div>
                      )}
                    </td>
                    <td className="cell-qty">{item.quantity}</td>
                    <td className="cell-rate">{formatCurrency(item.rate)}</td>
                    {quote.items.some(i => i.duration && i.duration > 1) && (
                      <td className="cell-duration">{`${item.duration || 1} ${item.durationUnit === 'days' ? 'Da' : 'Mo'}`}</td>
                    )}
                    <td className="cell-amount">{formatCurrency(item.total)}</td>
                    {quote.gstEnabled && <td className="cell-gst-pct">{quote.gstPercentage}%</td>}
                    {quote.gstEnabled && <td className="cell-incl">{formatCurrency(itemFinal)}</td>}
                    {hasRemark && <td className="cell-remark">{item.remark || ''}</td>}
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

        {!isMultiService && (
          <div id="pdf-page-2" className="template-classic-business">
            <ReferenceImages proposalPages={data.proposalPages} proposalPageMap={data.proposalPageMap} items={quote.items} />

            {renderCompanyFooter(2)}
          </div>
        )}

        {!isMultiService && (
          <div id="pdf-page-3" className="template-classic-business">
            <div className="terms-section">
              <h3 className="section-heading">Terms & Conditions</h3>
              <ol className="terms-list">
                {quote.termsAndConditions
                  ? quote.termsAndConditions
                      .split(/\n|•|\d+\.\s/)
                      .map(t => t.trim())
                      .filter(Boolean)
                      .map((term, i) => <li key={i}>{renderTermWithLinks(term)}</li>)
                  : <li>Standard terms and conditions apply</li>
                }
              </ol>
            </div>

            {quote.items.map((item) => 
              item.termsAndConditions ? (
                <div key={item.id} className="terms-section">
                  <h3 className="section-heading">{item.description.split(' - ')[0]} — Terms & Conditions</h3>
                  <ol className="terms-list">
                    {item.termsAndConditions
                      .split(/\n|•|\d+\.\s/)
                      .map(t => t.trim())
                      .filter(Boolean)
                      .map((term, i) => <li key={i}>{renderTermWithLinks(term)}</li>)
                    }
                  </ol>
                </div>
              ) : null
            )}

            <div className="system-generated-notice">
              <p>This is a system-generated quotation and does not require a signature.</p>
            </div>

            {renderCompanyFooter(3)}
          </div>
        )}

        {/* Company Contact Footer */}
        {renderCompanyFooter(1)}

        {/* Footer */}
        <div className="classic-footer">
          <div className="ornamental-line"></div>
          <p className="footer-text">
            We appreciate the opportunity to serve you and look forward to working with you.
          </p>
          <p className="footer-company">{company.name}</p>
        </div>
      </div>
    </div>
    
    {/* Multi-Service: Individual Service Pages */}
    {isMultiService && serviceGroups.map((group, groupIndex) => {
      const groupSubtotal = group.subtotal;
      const groupGST = quote.gstEnabled ? groupSubtotal * (quote.gstPercentage / 100) : 0;
      const groupTotal = groupSubtotal + groupGST;
      const hasRemarkGroup = group.items.some((i: any) => i.remark);
      
      return (
        <React.Fragment key={groupIndex}>
          <div style={{ pageBreakBefore: 'always' }} />
          <div className="template-classic-business">
            <div className="classic-container">
              <div id={`pdf-service-${groupIndex}`} className="template-classic-business">
              <div className="items-section">
                <h3 className="section-heading">{getServiceGroupHeading(group)}</h3>
                <table className="classic-table">
                  <thead>
                    <tr>
                      <th className="col-num">#</th>
                      <th className="col-description">Description</th>
                      <th className="col-qty">Qty</th>
                      <th className="col-rate">Unit Price</th>
                      <th className="col-amount"><span className="th-main">AMOUNT</span><span className="th-sub">(excl GST)</span></th>
                      {quote.gstEnabled && <th className="col-gst-pct">GST %</th>}
                      {quote.gstEnabled && <th className="col-incl"><span className="th-main">AMOUNT</span><span className="th-sub">(incl GST)</span></th>}
                      {hasRemarkGroup && <th className="col-remark">Remark</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, index) => {
                      const itemGST = quote.gstEnabled ? item.total * (quote.gstPercentage / 100) : 0;
                      const itemFinal = item.total + itemGST;
                      return (
                        <tr key={index}>
                          <td className="cell-num">{index + 1}</td>
                          <td className="cell-description">
                            <strong>{item.description}</strong>
                            {item.details && (
                              <div className="description-details">{item.details}</div>
                            )}
                          </td>
                          <td className="cell-qty">{item.quantity}</td>
                          <td className="cell-rate">{formatCurrency(item.rate)}</td>
                          <td className="cell-amount">{formatCurrency(item.total)}</td>
                          {quote.gstEnabled && <td className="cell-gst-pct">{quote.gstPercentage}%</td>}
                          {quote.gstEnabled && <td className="cell-incl">{formatCurrency(itemFinal)}</td>}
                          {hasRemarkGroup && <td className="cell-remark">{item.remark || ''}</td>}
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

                {/* Company Contact Footer */}
                {renderCompanyFooter(groupIndex * 2 + 2)}              </div>

              <div id={`pdf-service-ref-${groupIndex}`} className="template-classic-business">
                <ReferenceImages proposalPages={data.proposalPages} proposalPageMap={data.proposalPageMap} items={group.items} />

                {renderCompanyFooter(groupIndex * 2 + 3)}
              </div>
            </div>
          </div>
        </React.Fragment>
      );
    })}

    {/* Last Page: Terms & Conditions (multi-service) */}
    {isMultiService && (
      <div id="pdf-page-terms" className="template-classic-business">
        <div className="terms-section">
          <h3 className="section-heading">Terms & Conditions</h3>
          <ol className="terms-list">
            {DEFAULT_GENERAL_TERMS.map((term, i) => <li key={i}>{term}</li>)}
          </ol>
        </div>

        {serviceGroups.map((group, i) => (
          (group.termsAndConditions || quote.termsAndConditions) ? (
            <div key={i} className="terms-section">
              <h3 className="section-heading">{getServiceGroupHeading(group)} — <span style={{ textTransform: 'none' }}>SPECIFIC Ts & Cs</span></h3>
              <ol className="terms-list">
                {(group.termsAndConditions
                  ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                  : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                ).map((term, j) => <li key={j}>{term}</li>)}
              </ol>
            </div>
          ) : null
        ))}

        <div className="system-generated-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
        </div>

        {renderCompanyFooter(serviceGroups.length * 2 + 2)}
      </div>
    )}
    </>
  );
};
