import React from 'react';
import { TemplateProps } from '../../types';
// import { ReferenceImages } from './ReferenceImages'; // HIDDEN - Design Spec & Reference Images
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading } from '../../utils/quoteGrouping';
import './ModernSales.css';

export const ModernSales: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
  const { company, client, quote } = data;
  
  // Check if this is a multi-service quote
  const isMultiService = quote.items.length > 0 && isMultiServiceQuote(quote.items);
  const serviceGroups = isMultiService ? groupItemsByServiceType(quote.items) : [];

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
      currency: 'INR'
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
  const renderCompanyFooter = () => (
    <div className="company-contact-footer">
      <div className="footer-divider"></div>
      <div className="footer-content">
        {company.website && <span className="footer-item">🌐 {company.website}</span>}
        {company.address && <span className="footer-item">📍 {company.address}</span>}
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
            <p className="ms-party-detail">{company.address}</p>
            {company.phone && <p className="ms-party-detail">T: {company.phone}</p>}
            {company.email && <p className="ms-party-detail">E: {company.email}</p>}
            {company.website && <p className="ms-party-detail">W: {company.website}</p>}
            {company.gst && <p className="ms-party-detail">GST: {company.gst}</p>}
            {company.abn && <p className="ms-party-detail ms-abn">ABN: {company.abn}</p>}
          </div>
          <div className="ms-party-card ms-party-accent">
            <div className="ms-party-label">TO</div>
            <p className="ms-party-name">{client.name.toUpperCase()}</p>
            {client.company && <p className="ms-party-detail">{client.company}</p>}
            {client.email && <p className="ms-party-detail">E: {client.email}</p>}
            {client.phone && <p className="ms-party-detail">T: {client.phone}</p>}
            {client.address && <p className="ms-party-detail">{client.address}</p>}
            {client.gst && <p className="ms-party-detail">GST: {client.gst}</p>}
          </div>
        </div>

        {/* Items Table */}
        <div className="ms-section">
          <h3 className="ms-section-title">Scope of Work & Pricing</h3>
          <table className="ms-table">
            <thead>
              <tr>
                <th className="ms-col-num">#</th>
                <th className="ms-col-desc">Description</th>
                <th className="ms-col-qty">Qty</th>
                <th className="ms-col-rate">Rate</th>
                {quote.items.some(i => i.duration && i.duration > 1) && (
                  <th className="ms-col-dur">Months</th>
                )}
                <th className="ms-col-amt">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="ms-summary">
          <div className="ms-summary-card">
            <div className="ms-summary-row">
              <span>Subtotal</span>
              <span>{formatCurrency(calculateSubtotal())}</span>
            </div>
            {quote.gstEnabled && (
              <div className="ms-summary-row">
                <span>GST ({quote.gstPercentage}%)</span>
                <span>{formatCurrency(calculateGST())}</span>
              </div>
            )}
            <div className="ms-summary-row ms-summary-total">
              <span>Total Amount</span>
              <span>{formatCurrency(calculateTotal())}</span>
            </div>
          </div>
        </div>

        {/* General Terms */}
        <div className="ms-terms">
          <h3 className="ms-section-title">Terms & Conditions</h3>
          <div className="ms-terms-grid">
            {isMultiService 
              ? DEFAULT_GENERAL_TERMS.map((term, i) => (
                  <div className="ms-term-item" key={i}>
                    <span className="ms-term-check">&#10003;</span>
                    <span>{term}</span>
                  </div>
                ))
              : (quote.termsAndConditions
                  ? quote.termsAndConditions
                      .split(/\n|•|\d+\.\s/)
                      .map(t => t.trim())
                      .filter(Boolean)
                      .map((term, i) => (
                        <div className="ms-term-item" key={i}>
                          <span className="ms-term-check">&#10003;</span>
                          <span>{term}</span>
                        </div>
                      ))
                  : <div className="ms-term-item"><span className="ms-term-check">&#10003;</span><span>Standard terms and conditions apply</span></div>
                )
            }
          </div>
        </div>

        {/* Item-specific Terms (for single-service quotes) */}
        {!isMultiService && quote.items.map((item) => 
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
                      <span>{term}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          ) : null
        )}
      </div>

      {/* Company Contact Footer */}
      {renderCompanyFooter()}

      {/* Footer */}
      <div className="ms-footer">
        <p>Thank you for your business | {company.name.toUpperCase()}</p>
        {company.website && <p>{company.website}</p>}
        <p className="ms-footer-company">{company.name}</p>
      </div>
    </div>
    
    {/* Reference Images from Proposal - HIDDEN
    {!isMultiService && (
      <div id="pdf-page-2" className="template-modern-sales">
        <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />
        
        {renderCompanyFooter()}
      </div>
    )}
    */}
    
    {/* Multi-Service: Individual Service Pages */}
    {isMultiService && serviceGroups.map((group, groupIndex) => {
      const groupSubtotal = group.subtotal;
      const groupGST = quote.gstEnabled ? groupSubtotal * (quote.gstPercentage / 100) : 0;
      const groupTotal = groupSubtotal + groupGST;
      
      return (
        <React.Fragment key={groupIndex}>
          <div style={{ pageBreakBefore: 'always' }} />
          <div id={`pdf-service-${groupIndex}`} className="template-modern-sales">
            <div className="ms-body">
              {/* Items */}
              <div className="ms-section">
                <h3 className="ms-section-title">{getServiceGroupHeading(group)}</h3>
                <table className="ms-table">
                  <thead>
                    <tr>
                      <th className="ms-col-num">#</th>
                      <th className="ms-col-desc">Description</th>
                      <th className="ms-col-qty">Qty</th>
                      <th className="ms-col-rate">Rate</th>
                      <th className="ms-col-amt">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, index) => (
                      <tr key={index}>
                        <td className="ms-cell-num">{index + 1}</td>
                        <td className="ms-cell-desc">
                          <strong>{item.description}</strong>
                          {item.details && <div className="ms-item-details">{item.details}</div>}
                        </td>
                        <td className="ms-cell-qty">{item.quantity}</td>
                        <td className="ms-cell-rate">{formatCurrency(item.rate)}</td>
                        <td className="ms-cell-amt">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              <div className="ms-summary">
                <div className="ms-summary-card">
                  <div className="ms-summary-row">
                    <span>Subtotal</span>
                    <span>{formatCurrency(groupSubtotal)}</span>
                  </div>
                  {quote.gstEnabled && (
                    <div className="ms-summary-row">
                      <span>GST ({quote.gstPercentage}%)</span>
                      <span>{formatCurrency(groupGST)}</span>
                    </div>
                  )}
                  <div className="ms-summary-row ms-summary-total">
                    <span>Total Amount</span>
                    <span>{formatCurrency(groupTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Terms */}
              <div className="ms-terms">
                <h3 className="ms-section-title">Terms & Conditions</h3>
                <div className="ms-terms-grid">
                  {(group.termsAndConditions || quote.termsAndConditions)
                    ? (group.termsAndConditions
                        ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                        : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                      ).map((term, i) => (
                        <div className="ms-term-item" key={i}>
                          <span className="ms-term-check">&#10003;</span>
                          <span>{term}</span>
                        </div>
                      ))
                    : <div className="ms-term-item"><span className="ms-term-check">&#10003;</span><span>Standard terms and conditions apply</span></div>
                  }
                </div>
              </div>
            </div>
            
            {/* Company Contact Footer */}
            {renderCompanyFooter()}
          </div>

          {/* Service-specific reference images - HIDDEN
          <div id={`pdf-service-ref-${groupIndex}`} className="template-modern-sales">
            <ReferenceImages proposalPages={data.proposalPages} items={group.items} />
            
            {groupIndex === serviceGroups.length - 1 && (
              <>
                <div className="ms-notice">
                  <p>This is a system-generated quotation and does not require a signature.</p>
                </div>
                <div className="ms-footer">
                  <p>{company.name.toUpperCase()} - Professional Branding Services</p>
                  <p className="ms-footer-company">{company.name}</p>
                </div>
              </>
            )}
            
            {renderCompanyFooter()}
          </div>
          */}
        </React.Fragment>
      );
    })}
    </>
  );
};
