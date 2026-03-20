import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, filterNotesByServiceType, DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
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

  return (
    <>
    <div className="template-premium-agency">
      {/* Hero Header */}
      <div className="hero-header">
        <div className="header-overlay">
          {company.logo && (
            <img src={company.logo} alt={company.name} className="hero-logo" />
          )}
          <h1 className="hero-title">PROFESSIONAL QUOTATION</h1>
          <p className="hero-subtitle">Investment Proposal for Excellence</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="content-wrapper">
        {/* Quote Info Bar */}
        <div className="info-bar">
          <div className="info-item">
            <span className="info-label">Quote #</span>
            <span className="info-value">{quote.quoteNumber}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Issued</span>
            <span className="info-value">{formatDate(quote.date)}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Valid Until</span>
            <span className="info-value">{formatDate(quote.validUntil)}</span>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="two-column-section">
          <div className="column">
            <div className="card">
              <h3 className="card-title">From</h3>
              <div className="card-content">
                <p className="entity-name">{company.name}</p>
                <p>{company.address}</p>
                {company.phone && <p>T: {company.phone}</p>}
                {company.email && <p>E: {company.email}</p>}
                {company.website && <p>W: {company.website}</p>}
                {company.abn && <p>ABN: {company.abn}</p>}
              </div>
            </div>
          </div>
          <div className="column">
            <div className="card card-accent">
              <h3 className="card-title">To</h3>
              <div className="card-content">
                <p className="entity-name">{client.name}</p>
                {client.company && <p>{client.company}</p>}
                {client.email && <p>E: {client.email}</p>}
                {client.phone && <p>T: {client.phone}</p>}
                {client.address && <p>{client.address}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Investment Breakdown */}
        <div className="services-section">
          <h2 className="section-title">Investment Breakdown</h2>
          <div className="services-list">
            {quote.items.map((item, index) => (
              <div key={index} className="service-item">
                <div className="service-header">
                  <span className="service-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="service-content">
                    <h4 className="service-name">{item.description}</h4>
                    {item.details && <p className="service-details">{item.details}</p>}
                  </div>
                </div>
                <div className="service-pricing">
                  <div className="pricing-detail">
                    <span className="pricing-label">Quantity</span>
                    <span className="pricing-value">{item.quantity}</span>
                  </div>
                  <div className="pricing-detail">
                    <span className="pricing-label">Rate</span>
                    <span className="pricing-value">{formatCurrency(item.rate)}</span>
                  </div>
                  <div className="pricing-detail total-detail">
                    <span className="pricing-label">Total</span>
                    <span className="pricing-value">{formatCurrency(item.total)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Investment Summary */}
        <div className="summary-section">
          <div className="summary-card">
            <h3 className="summary-title">Investment Summary</h3>
            <div className="summary-rows">
              <div className="summary-row">
                <span className="summary-label">Subtotal</span>
                <span className="summary-value">{formatCurrency(calculateSubtotal())}</span>
              </div>
              {quote.gstEnabled && (
                <div className="summary-row">
                  <span className="summary-label">GST ({quote.gstPercentage}%)</span>
                  <span className="summary-value">{formatCurrency(calculateGST())}</span>
                </div>
              )}
              <div className="summary-row summary-total">
                <span className="summary-label">Total Investment</span>
                <span className="summary-value">{formatCurrency(calculateTotal())}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div className="notes-section">
            <h3 className="section-title">Additional Notes</h3>
            <div className="notes-content">
              <p>{quote.notes}</p>
            </div>
          </div>
        )}

        {/* Terms */}
        <div className="terms-section">
          <h3 className="section-title">Terms & Conditions</h3>
          <div className="terms-grid">
            {isMultiService
              ? DEFAULT_GENERAL_TERMS.map((term, i) => (
                  <div className="term-item" key={i}>
                    <div className="term-icon">✓</div>
                    <div className="term-content">
                      <p>{term}</p>
                    </div>
                  </div>
                ))
              : (quote.termsAndConditions
                  ? quote.termsAndConditions
                      .split(/\n|•|\d+\.\s/)
                      .map(t => t.trim())
                      .filter(Boolean)
                      .map((term, i) => (
                        <div className="term-item" key={i}>
                          <div className="term-icon">✓</div>
                          <div className="term-content">
                            <p>{term}</p>
                          </div>
                        </div>
                      ))
                  : <div className="term-item"><div className="term-icon">✓</div><div className="term-content"><p>Standard terms and conditions apply</p></div></div>
                )
            }
          </div>
        </div>

        {/* Signature */}
        <div className="signature-section">
          <div className="signature-block">
            <h4>Acceptance & Authorization</h4>
            <p className="signature-text">
              By signing below, you accept the terms and conditions outlined in this quotation
            </p>
            <div className="signature-areas">
              <div className="signature-area">
                <div className="signature-line"></div>
                <p className="signature-label">Authorized by {company.name}</p>
                <p className="signature-date">Date: {formatDate(new Date())}</p>
              </div>
              <div className="signature-area">
                <div className="signature-line"></div>
                <p className="signature-label">Client Signature</p>
                <p className="signature-date">Date: _______________</p>
              </div>
            </div>
          </div>
        </div>
        {/* Reference Images from Proposal - only show for single service */}
        {!isMultiService && (
          <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        <p>Thank you for considering {company.name} for your project</p>
      </div>
    </div>
    
    {/* Multi-Service: Individual Service Pages */}
    {isMultiService && serviceGroups.map((group, groupIndex) => {
      const groupSubtotal = group.subtotal;
      const groupGST = quote.gstEnabled ? groupSubtotal * (quote.gstPercentage / 100) : 0;
      const groupTotal = groupSubtotal + groupGST;
      
      return (
        <React.Fragment key={groupIndex}>
          <div style={{ pageBreakBefore: 'always' }} />
          <div className="template-premium-agency">
            <div className="hero-header">
              <div className="header-overlay">
                {company.logo && (
                  <img src={company.logo} alt={company.name} className="hero-logo" />
                )}
                <h1 className="hero-title">{group.serviceType} BRANDING</h1>
                <p className="hero-subtitle">Detailed Service Breakdown</p>
              </div>
            </div>

            <div className="content-wrapper">
              <div className="info-bar">
                <div className="info-item">
                  <span className="info-label">Quote #</span>
                  <span className="info-value">{quote.quoteNumber}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Issued</span>
                  <span className="info-value">{formatDate(quote.date)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Valid Until</span>
                  <span className="info-value">{formatDate(quote.validUntil)}</span>
                </div>
              </div>

              {/* Two Column Layout */}
              <div className="two-column-section">
                <div className="column">
                  <div className="card">
                    <h3 className="card-title">From</h3>
                    <div className="card-content">
                      <p className="entity-name">{company.name}</p>
                      <p>{company.address}</p>
                      {company.phone && <p>T: {company.phone}</p>}
                      {company.email && <p>E: {company.email}</p>}
                    </div>
                  </div>
                </div>
                <div className="column">
                  <div className="card card-accent">
                    <h3 className="card-title">To</h3>
                    <div className="card-content">
                      <p className="entity-name">{client.name}</p>
                      {client.company && <p>{client.company}</p>}
                      {client.email && <p>E: {client.email}</p>}
                      {client.phone && <p>T: {client.phone}</p>}
                      {client.address && <p>{client.address}</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="services-section">
                <h2 className="section-title">{group.serviceType} Branding Details</h2>
                <div className="services-list">
                  {group.items.map((item, index) => (
                    <div key={index} className="service-item">
                      <div className="service-header">
                        <span className="service-number">{String(index + 1).padStart(2, '0')}</span>
                        <div className="service-content">
                          <h4 className="service-name">{item.description}</h4>
                          {item.details && <p className="service-details">{item.details}</p>}
                        </div>
                      </div>
                      <div className="service-pricing">
                        <div className="pricing-detail">
                          <span className="pricing-label">Quantity</span>
                          <span className="pricing-value">{item.quantity}</span>
                        </div>
                        <div className="pricing-detail">
                          <span className="pricing-label">Rate</span>
                          <span className="pricing-value">{formatCurrency(item.rate)}</span>
                        </div>
                        <div className="pricing-detail total-detail">
                          <span className="pricing-label">Total</span>
                          <span className="pricing-value">{formatCurrency(item.total)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="summary-section">
                <div className="summary-card">
                  <h3 className="summary-title">Service Total</h3>
                  <div className="summary-rows">
                    <div className="summary-row">
                      <span className="summary-label">Subtotal</span>
                      <span className="summary-value">{formatCurrency(groupSubtotal)}</span>
                    </div>
                    {quote.gstEnabled && (
                      <div className="summary-row">
                        <span className="summary-label">GST ({quote.gstPercentage}%)</span>
                        <span className="summary-value">{formatCurrency(groupGST)}</span>
                      </div>
                    )}
                    <div className="summary-row summary-total">
                      <span className="summary-label">Total</span>
                      <span className="summary-value">{formatCurrency(groupTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {quote.notes && (
                <div className="notes-section">
                  <h3 className="section-title">Additional Notes</h3>
                  <div className="notes-content">
                    <p>{filterNotesByServiceType(quote.notes, group.serviceType)}</p>
                  </div>
                </div>
              )}

              {/* Terms - Service Specific */}
              <div className="terms-section">
                <h3 className="section-title">Terms & Conditions</h3>
                <div className="terms-grid">
                  {quote.termsAndConditions
                    ? filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                        .map((term, i) => (
                          <div className="term-item" key={i}>
                            <div className="term-icon">✓</div>
                            <div className="term-content">
                              <p>{term}</p>
                            </div>
                          </div>
                        ))
                    : <div className="term-item"><div className="term-icon">✓</div><div className="term-content"><p>Standard terms and conditions apply</p></div></div>
                  }
                </div>
              </div>

              {/* Signature */}
              <div className="signature-section">
                <div className="signature-block">
                  <h4>Acceptance & Authorization</h4>
                  <p className="signature-text">
                    By signing below, you accept the terms and conditions for {group.serviceType.toLowerCase()} branding services outlined in this quotation
                  </p>
                  <div className="signature-areas">
                    <div className="signature-area">
                      <div className="signature-line"></div>
                      <p className="signature-label">Authorized by {company.name}</p>
                      <p className="signature-date">Date: {formatDate(new Date())}</p>
                    </div>
                    <div className="signature-area">
                      <div className="signature-line"></div>
                      <p className="signature-label">Client Signature</p>
                      <p className="signature-date">Date: _______________</p>
                    </div>
                  </div>
                </div>
              </div>

              <ReferenceImages proposalPages={data.proposalPages} items={group.items} />
            </div>

            <div className="footer">
              <p>{company.name} - Professional {group.serviceType} Branding Services</p>
            </div>
          </div>
        </React.Fragment>
      );
    })}
    </>
  );
};
