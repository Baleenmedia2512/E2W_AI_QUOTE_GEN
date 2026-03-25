import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, filterNotesByServiceType, DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
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

  return (
    <>
    <div id="pdf-page-1" className="template-modern-sales">
      {/* Top Bar */}
      <div className="top-bar">
        <div className="bar-section">
          {company.logo && (
            <img src={company.logo} alt={company.name} className="top-logo" />
          )}
          <span className="company-title">{company.name}</span>
        </div>
        <div className="bar-section">
          <span className="quote-label">Quote #{quote.quoteNumber}</span>
        </div>
      </div>

      {/* Main Container */}
      <div className="main-container">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-title">Quote Details</h3>
            <div className="detail-row">
              <span className="detail-key">Date Issued:</span>
              <span className="detail-value">{formatDate(quote.date)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-key">Valid Until:</span>
              <span className="detail-value">{formatDate(quote.validUntil)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-key">Quote Number:</span>
              <span className="detail-value">{quote.quoteNumber}</span>
            </div>
          </div>

          <div className="sidebar-section">
            <h3 className="sidebar-title">Our Details</h3>
            <p className="sidebar-text">{company.name}</p>
            <p className="sidebar-text">{company.address}</p>
            {company.phone && <p className="sidebar-text">{company.phone}</p>}
            {company.email && <p className="sidebar-text">{company.email}</p>}
            {company.abn && (
              <div className="abn-badge">
                <span>ABN: {company.abn}</span>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="sidebar-title">Client</h3>
            <p className="sidebar-text sidebar-highlight">{client.name}</p>
            {client.company && <p className="sidebar-text">{client.company}</p>}
            {client.email && <p className="sidebar-text">{client.email}</p>}
            {client.phone && <p className="sidebar-text">{client.phone}</p>}
          </div>

          <div className="sidebar-section total-preview">
            <h3 className="sidebar-title">Total</h3>
            <div className="total-amount">{formatCurrency(calculateTotal())}</div>
            <p className="total-label">Inc. GST</p>
          </div>
        </div>

        {/* Main Content */}
        <div className="main-content">
          <div className="content-header">
            <h1 className="content-title">Your Quote</h1>
            <p className="content-subtitle">
              We're pleased to provide you with this quotation for your consideration
            </p>
          </div>

          {/* Items List */}
          <div className="items-container">
            {quote.items.map((item, index) => (
              <div key={index} className="item-card">
                <div className="item-header">
                  <div className="item-badge">{index + 1}</div>
                  <h3 className="item-name">{item.description}</h3>
                </div>
                {item.details && (
                  <p className="item-description">{item.details}</p>
                )}
                <div className="item-pricing">
                  <div className="pricing-row">
                    <span className="pricing-text">
                      {item.quantity} × {formatCurrency(item.rate)}{item.duration && item.duration > 1 ? ` × ${item.duration} months` : ''}
                    </span>
                    <span className="pricing-amount">{formatCurrency(item.total)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Calculation Breakdown */}
          <div className="breakdown-section">
            <div className="breakdown-card">
              <div className="breakdown-row">
                <span className="breakdown-label">Subtotal</span>
                <span className="breakdown-value">{formatCurrency(calculateSubtotal())}</span>
              </div>
              {quote.gstEnabled && (
                <div className="breakdown-row">
                  <span className="breakdown-label">GST ({quote.gstPercentage}%)</span>
                  <span className="breakdown-value">{formatCurrency(calculateGST())}</span>
                </div>
              )}
              <div className="breakdown-row breakdown-total">
                <span className="breakdown-label">Total Amount</span>
                <span className="breakdown-value">{formatCurrency(calculateTotal())}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {quote.notes && (
            <div className="notes-box">
              <h3 className="notes-title">Important Notes</h3>
              <p className="notes-text">{quote.notes}</p>
            </div>
          )}

          {/* Terms */}
          <div className="terms-box">
            <h3 className="terms-title">Terms & Conditions</h3>
            <ul className="terms-list">
              {isMultiService 
                ? DEFAULT_GENERAL_TERMS.map((term, i) => <li key={i}>{term}</li>)
                : (quote.termsAndConditions
                    ? quote.termsAndConditions
                        .split(/\n|•|\d+\.\s/)
                        .map(t => t.trim())
                        .filter(Boolean)
                        .map((term, i) => <li key={i}>{term}</li>)
                    : <li>Standard terms and conditions apply</li>
                  )
              }
            </ul>
          </div>

          {/* CTA Section */}
          <div className="cta-section">
            <h2 className="cta-title">Ready to proceed?</h2>
            <p className="cta-text">
              Sign below to accept this quotation and we'll get started on your project
            </p>
            <div className="signature-grid">
              <div className="signature-field">
                <label className="signature-label">Client Signature</label>
                <div className="signature-box"></div>
                <input type="text" placeholder="Print Name" className="signature-input" />
                <input type="text" placeholder="Date" className="signature-input" />
              </div>
              <div className="signature-field">
                <label className="signature-label">Authorized by {company.name}</label>
                <div className="signature-box signature-filled">✓ Authorized</div>
                <div className="authorized-date">{formatDate(new Date())}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="footer-bar">
        <p>Thank you for your business | {company.name}</p>
        {company.website && <p>{company.website}</p>}
      </div>
    </div>
    
    {/*Reference Images from Proposal - only show for single service */}
    {!isMultiService && (
      <div id="pdf-page-2">
        <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />
      </div>
    )}
    
    {/* Multi-Service: Individual Service Pages */}
    {isMultiService && serviceGroups.map((group, groupIndex) => {
      const groupSubtotal = group.subtotal;
      const groupGST = quote.gstEnabled ? groupSubtotal * (quote.gstPercentage / 100) : 0;
      const groupTotal = groupSubtotal + groupGST;
      
      return (
        <React.Fragment key={groupIndex}>
          <div style={{ pageBreakBefore: 'always' }} />
          <div id={`pdf-service-${groupIndex}`} className="template-modern-sales">
            <div className="top-bar">
              <div className="bar-section">
                {company.logo && (
                  <img src={company.logo} alt={company.name} className="top-logo" />
                )}
                <span className="company-title">{company.name}</span>
              </div>
              <div className="bar-section">
                <span className="quote-label">{group.serviceType} Branding</span>
              </div>
            </div>

            <div className="main-container">
              <div className="sidebar">
                <div className="sidebar-section">
                  <h3 className="sidebar-title">Quote Details</h3>
                  <div className="detail-row">
                    <span className="detail-key">Date Issued:</span>
                    <span className="detail-value">{formatDate(quote.date)}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Valid Until:</span>
                    <span className="detail-value">{formatDate(quote.validUntil)}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Quote Number:</span>
                    <span className="detail-value">{quote.quoteNumber}</span>
                  </div>
                </div>
                
                <div className="sidebar-section">
                  <h3 className="sidebar-title">Service Type</h3>
                  <p className="sidebar-text sidebar-highlight">{group.serviceType} Branding</p>
                </div>
                
                <div className="sidebar-section">
                  <h3 className="sidebar-title">Client</h3>
                  <p className="sidebar-text">{client.name}</p>
                  {client.company && <p className="sidebar-text">{client.company}</p>}
                  {client.email && <p className="sidebar-text">{client.email}</p>}
                  {client.phone && <p className="sidebar-text">{client.phone}</p>}
                </div>
                
                <div className="sidebar-section total-preview">
                  <h3 className="sidebar-title">Total</h3>
                  <div className="total-amount">{formatCurrency(groupTotal)}</div>
                  <p className="total-label">Inc. GST</p>
                </div>
              </div>

              <div className="main-content">
                <div className="content-header">
                  <h1 className="content-title">{group.serviceType} Branding Details</h1>
                  <p className="content-subtitle">
                    Detailed breakdown for {group.serviceType.toLowerCase()} branding services
                  </p>
                </div>

                <div className="items-container">
                  {group.items.map((item, index) => (
                    <div key={index} className="item-card">
                      <div className="item-header">
                        <div className="item-badge">{index + 1}</div>
                        <h3 className="item-name">{item.description}</h3>
                      </div>
                      {item.details && (
                        <p className="item-description">{item.details}</p>
                      )}
                      <div className="item-pricing">
                        <div className="pricing-row">
                          <span className="pricing-text">
                            {item.quantity} × {formatCurrency(item.rate)}
                          </span>
                          <span className="pricing-amount">{formatCurrency(item.total)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="breakdown-section">
                  <div className="breakdown-card">
                    <div className="breakdown-row">
                      <span className="breakdown-label">Subtotal</span>
                      <span className="breakdown-value">{formatCurrency(groupSubtotal)}</span>
                    </div>
                    {quote.gstEnabled && (
                      <div className="breakdown-row">
                        <span className="breakdown-label">GST ({quote.gstPercentage}%)</span>
                        <span className="breakdown-value">{formatCurrency(groupGST)}</span>
                      </div>
                    )}
                    <div className="breakdown-row breakdown-total">
                      <span className="breakdown-label">Total Amount</span>
                      <span className="breakdown-value">{formatCurrency(groupTotal)}</span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {quote.notes && (
                  <div className="notes-box">
                    <h3 className="notes-title">Important Notes</h3>
                    <p className="notes-text">{filterNotesByServiceType(quote.notes, group.serviceType)}</p>
                  </div>
                )}

                {/* Terms - Service Specific */}
                <div className="terms-box">
                  <h3 className="terms-title">Terms & Conditions</h3>
                  <ul className="terms-list">
                    {(group.termsAndConditions || quote.termsAndConditions)
                      ? (group.termsAndConditions
                          ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                          : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                        ).map((term, i) => <li key={i}>{term}</li>)
                      : <li>Standard terms and conditions apply</li>
                    }
                  </ul>
                </div>

                {/* CTA Section */}
                <div className="cta-section">
                  <h2 className="cta-title">Ready to proceed?</h2>
                  <p className="cta-text">
                    Sign below to accept this {group.serviceType.toLowerCase()} branding quotation and we'll get started on your project
                  </p>
                  <div className="signature-grid">
                    <div className="signature-field">
                      <label className="signature-label">Client Signature</label>
                      <div className="signature-box"></div>
                      <input type="text" placeholder="Print Name" className="signature-input" />
                      <input type="text" placeholder="Date" className="signature-input" />
                    </div>
                    <div className="signature-field">
                      <label className="signature-label">Authorized by {company.name}</label>
                      <div className="signature-box signature-filled">✓ Authorized</div>
                      <div className="authorized-date">{formatDate(new Date())}</div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
            </div>

            <div id={`pdf-service-ref-${groupIndex}`}>
              <ReferenceImages proposalPages={data.proposalPages} items={group.items} />
            </div>
        </React.Fragment>
      );
    })}
    </>
  );
};
