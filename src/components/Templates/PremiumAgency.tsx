import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS, getServiceGroupHeading } from '../../utils/quoteGrouping';
import './PremiumAgency.css';

export const PremiumAgency: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
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
      month: 'long',
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
            <p className="pa-party-detail">{company.address}</p>
            {company.phone && <p className="pa-party-detail">T: {company.phone}</p>}
            {company.email && <p className="pa-party-detail">E: {company.email}</p>}
            {company.website && <p className="pa-party-detail">W: {company.website}</p>}
            {company.gst && <p className="pa-party-detail">GST: {company.gst}</p>}
            {company.abn && <p className="pa-party-detail pa-abn">ABN: {company.abn}</p>}
          </div>
          <div className="pa-party-card pa-party-accent">
            <div className="pa-party-label">TO</div>
            <p className="pa-party-name">{client.name.toUpperCase()}</p>
            {client.company && <p className="pa-party-detail">{client.company}</p>}
            {client.email && <p className="pa-party-detail">E: {client.email}</p>}
            {client.phone && <p className="pa-party-detail">T: {client.phone}</p>}
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
                  <th className="pa-col-dur">Months</th>
                )}
                <th className="pa-col-amt">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                <tr key={index}>
                  <td className="pa-cell-num">{String(index + 1).padStart(2, '0')}</td>
                  <td className="pa-cell-desc">
                    <strong>{item.description}</strong>
                    {item.details && <div className="pa-item-details">{item.details}</div>}
                  </td>
                  <td className="pa-cell-qty">{item.quantity}</td>
                  <td className="pa-cell-rate">{formatCurrency(item.rate)}</td>
                  {quote.items.some(i => i.duration && i.duration > 1) && (
                    <td className="pa-cell-dur">{item.duration || 1}</td>
                  )}
                  <td className="pa-cell-amt">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="pa-summary">
          <div className="pa-summary-card">
            <div className="pa-summary-row">
              <span>Subtotal</span>
              <span>{formatCurrency(calculateSubtotal())}</span>
            </div>
            {quote.gstEnabled && (
              <div className="pa-summary-row">
                <span>GST ({quote.gstPercentage}%)</span>
                <span>{formatCurrency(calculateGST())}</span>
              </div>
            )}
            <div className="pa-summary-row pa-summary-total">
              <span>Total Investment</span>
              <span>{formatCurrency(calculateTotal())}</span>
            </div>
          </div>
        </div>

        {/* General Terms */}
        <div className="pa-terms">
          <h3 className="pa-section-title">Terms & Conditions</h3>
          <div className="pa-terms-grid">
            {isMultiService
              ? DEFAULT_GENERAL_TERMS.map((term, i) => (
                  <div className="pa-term-item" key={i}>
                    <span className="pa-term-check">&#10003;</span>
                    <span>{term}</span>
                  </div>
                ))
              : (quote.termsAndConditions
                  ? quote.termsAndConditions
                      .split(/\n|•|\d+\.\s/)
                      .map(t => t.trim())
                      .filter(Boolean)
                      .map((term, i) => (
                        <div className="pa-term-item" key={i}>
                          <span className="pa-term-check">&#10003;</span>
                          <span>{term}</span>
                        </div>
                      ))
                  : <div className="pa-term-item"><span className="pa-term-check">&#10003;</span><span>Standard terms and conditions apply</span></div>
                )
            }
          </div>
        </div>

        {/* Item-specific Terms (for single-service quotes) */}
        {!isMultiService && quote.items.map((item) => 
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
      <div className="pa-footer">
        <p>Thank you for considering {company.name.toUpperCase()} for your project</p>
        <p className="pa-footer-company">{company.name}</p>
      </div>
    </div>

    {/* Reference Images from Proposal - HIDDEN
    {!isMultiService && (
      <div id="pdf-page-2" className="template-premium-agency">
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
                      <th className="pa-col-amt">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, index) => (
                      <tr key={index}>
                        <td className="pa-cell-num">{String(index + 1).padStart(2, '0')}</td>
                        <td className="pa-cell-desc">
                          <strong>{item.description}</strong>
                          {item.details && <div className="pa-item-details">{item.details}</div>}
                        </td>
                        <td className="pa-cell-qty">{item.quantity}</td>
                        <td className="pa-cell-rate">{formatCurrency(item.rate)}</td>
                        <td className="pa-cell-amt">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              <div className="pa-summary">
                <div className="pa-summary-card">
                  <div className="pa-summary-row">
                    <span>Subtotal</span>
                    <span>{formatCurrency(groupSubtotal)}</span>
                  </div>
                  {quote.gstEnabled && (
                    <div className="pa-summary-row">
                      <span>GST ({quote.gstPercentage}%)</span>
                      <span>{formatCurrency(groupGST)}</span>
                    </div>
                  )}
                  <div className="pa-summary-row pa-summary-total">
                    <span>Total</span>
                    <span>{formatCurrency(groupTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Terms */}
              <div className="pa-terms">
                <h3 className="pa-section-title">Terms & Conditions</h3>
                <div className="pa-terms-grid">
                  {(group.termsAndConditions || quote.termsAndConditions)
                    ? (group.termsAndConditions
                        ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                        : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                      ).map((term, i) => (
                        <div className="pa-term-item" key={i}>
                          <span className="pa-term-check">&#10003;</span>
                          <span>{term}</span>
                        </div>
                      ))
                    : <div className="pa-term-item"><span className="pa-term-check">&#10003;</span><span>Standard terms and conditions apply</span></div>
                  }
                </div>
              </div>
            </div>
            
            {/* Company Contact Footer */}
            {renderCompanyFooter()}
          </div>

          {/* Service-specific reference images - HIDDEN
          <div id={`pdf-service-ref-${groupIndex}`} className="template-premium-agency">
            <ReferenceImages proposalPages={data.proposalPages} items={group.items} />
            
            {groupIndex === serviceGroups.length - 1 && (
              <>
                <div className="pa-notice">
                  <p>This is a system-generated quotation and does not require a signature.</p>
                </div>
                <div className="pa-footer">
                  <p>{company.name.toUpperCase()} - Professional Branding Services</p>
                  <p className="pa-footer-company">{company.name}</p>
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
