import React from 'react';
import { TemplateProps } from '../../types';
import './PremiumAgency.css';

export const PremiumAgency: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
  const { company, client, quote } = data;

  const calculateSubtotal = () => {
    return quote.items.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateGST = () => {
    const subtotal = calculateSubtotal();
    return subtotal * 0.1;
  };

  const calculateTotal = () => {
    return calculateSubtotal() + calculateGST();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD'
    }).format(amount);
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
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
              <div className="summary-row">
                <span className="summary-label">GST (10%)</span>
                <span className="summary-value">{formatCurrency(calculateGST())}</span>
              </div>
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
          <h3 className="section-title">Terms of Engagement</h3>
          <div className="terms-grid">
            <div className="term-item">
              <div className="term-icon">✓</div>
              <div className="term-content">
                <h4>Validity</h4>
                <p>This quotation is valid for 30 days from issue date</p>
              </div>
            </div>
            <div className="term-item">
              <div className="term-icon">✓</div>
              <div className="term-content">
                <h4>Payment</h4>
                <p>Net 30 days from invoice date. 50% deposit required</p>
              </div>
            </div>
            <div className="term-item">
              <div className="term-icon">✓</div>
              <div className="term-content">
                <h4>Currency</h4>
                <p>All prices in AUD including GST where applicable</p>
              </div>
            </div>
            <div className="term-item">
              <div className="term-icon">✓</div>
              <div className="term-content">
                <h4>Variations</h4>
                <p>Scope changes will be quoted separately</p>
              </div>
            </div>
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
      </div>

      {/* Footer */}
      <div className="footer">
        <p>Thank you for considering {company.name} for your project</p>
      </div>
    </div>
  );
};
