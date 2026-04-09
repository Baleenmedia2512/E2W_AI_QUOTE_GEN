import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
import './ClassicBusiness.css';

export const ClassicBusiness: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
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
            {company.address && <p>{company.address}</p>}
            {company.phone && <p>Phone: {company.phone}</p>}
            {company.email && <p>Email: {company.email}</p>}
            {company.website && <p>Website: {company.website}</p>}
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
            <p className="recipient-name">{client.name}</p>
            {client.company && <p>{client.company}</p>}
            {client.address && <p>{client.address}</p>}
            {client.email && <p>Email: {client.email}</p>}
            {client.phone && <p>Phone: {client.phone}</p>}
            {client.gst && <p>GST: {client.gst}</p>}
          </div>
        </div>

        {/* Introduction */}
        <div className="introduction">
          <p>Dear {client.name},</p>
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
                  <th className="col-duration">Months</th>
                )}
                <th className="col-amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
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
                    <td className="cell-duration">{item.duration || 1}</td>
                  )}
                  <td className="cell-amount">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Calculation Summary */}
        <div className="calculation-section">
          <table className="calculation-table">
            <tbody>
              <tr>
                <td className="calc-label">Subtotal:</td>
                <td className="calc-value">{formatCurrency(calculateSubtotal())}</td>
              </tr>
              {quote.gstEnabled && (
                <tr>
                  <td className="calc-label">GST ({quote.gstPercentage}%):</td>
                  <td className="calc-value">{formatCurrency(calculateGST())}</td>
                </tr>
              )}
              <tr className="calc-total-row">
                <td className="calc-label-total">TOTAL (INR):</td>
                <td className="calc-value-total">{formatCurrency(calculateTotal())}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* General Terms & Conditions */}
        <div className="terms-section">
          <h3 className="section-heading">Terms & Conditions</h3>
          <ol className="terms-list">
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
          </ol>
        </div>

        {/* Item-specific Terms (for single-service quotes) */}
        {!isMultiService && quote.items.map((item) => 
          item.termsAndConditions ? (
            <div key={item.id} className="terms-section">
              <h3 className="section-heading">{item.description.split(' - ')[0]} — Terms & Conditions</h3>
              <ol className="terms-list">
                {item.termsAndConditions
                  .split(/\n|•|\d+\.\s/)
                  .map(t => t.trim())
                  .filter(Boolean)
                  .map((term, i) => <li key={i}>{term}</li>)
                }
              </ol>
            </div>
          ) : null
        )}

        {/* System Generated Notice */}
        <div className="system-generated-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
          <p className="generated-by">Generated by {company.name.toUpperCase()}</p>
        </div>
        </div>

        {/* Reference Images from Proposal - only show for single service */}
        {!isMultiService && (
          <div id="pdf-page-2">
            <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />
          </div>
        )}

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
      
      return (
        <React.Fragment key={groupIndex}>
          <div style={{ pageBreakBefore: 'always' }} />
          <div className="template-classic-business">
            <div className="classic-container">
              <div id={`pdf-service-${groupIndex}`} className="template-classic-business">
              <div className="letterhead">
                <div className="letterhead-content">
                  {company.logo && (
                    <div className="logo-container">
                      <img src={company.logo} alt={company.name} className="letterhead-logo" />
                    </div>
                  )}
                  <div className="letterhead-right">
                    <h1 className="letterhead-title">{group.serviceType}</h1>
                    <div className="letterhead-divider"></div>
                    <p className="letterhead-subtitle">Service Breakdown</p>
                  </div>
                </div>
                <div className="ornamental-line"></div>
              </div>

              {/* Company Contact Details */}
              <div className="company-contact-section">
                <div className="company-contact-details">
                  {company.address && <p>{company.address}</p>}
                  {company.phone && <p>Phone: {company.phone}</p>}
                  {company.email && <p>Email: {company.email}</p>}
                  {company.website && <p>Website: {company.website}</p>}
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

              <div className="address-block">
                <div className="address-label">To:</div>
                <div className="address-content">
                  <p className="recipient-name">{client.name}</p>
                  {client.company && <p>{client.company}</p>}
                  {client.address && <p>{client.address}</p>}
                  {client.email && <p>Email: {client.email}</p>}
                  {client.phone && <p>Phone: {client.phone}</p>}
                  {client.gst && <p>GST: {client.gst}</p>}
                </div>
              </div>

              {/* Introduction */}
              <div className="introduction">
                <p>Dear {client.name},</p>
                <p>
                  Thank you for your interest in our {group.serviceType.toLowerCase()} branding services. 
                  We are pleased to submit this quotation for your consideration. 
                  Below you will find a detailed breakdown of the {group.serviceType.toLowerCase()} branding services and associated costs.
                </p>
              </div>

              <div className="items-section">
                <h3 className="section-heading">{group.serviceType} Branding Services</h3>
                <table className="classic-table">
                  <thead>
                    <tr>
                      <th className="col-num">#</th>
                      <th className="col-description">Description</th>
                      <th className="col-qty">Qty</th>
                      <th className="col-rate">Unit Price</th>
                      <th className="col-amount">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, index) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="calculation-section">
                <table className="calculation-table">
                  <tbody>
                    <tr>
                      <td className="calc-label">Subtotal:</td>
                      <td className="calc-value">{formatCurrency(groupSubtotal)}</td>
                    </tr>
                    {quote.gstEnabled && (
                      <tr>
                        <td className="calc-label">GST ({quote.gstPercentage}%):</td>
                        <td className="calc-value">{formatCurrency(groupGST)}</td>
                      </tr>
                    )}
                    <tr className="calc-total-row">
                      <td className="calc-label-total">TOTAL (INR):</td>
                      <td className="calc-value-total">{formatCurrency(groupTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Terms & Conditions - Service Specific */}
              <div className="terms-section">
                <h3 className="section-heading">Terms & Conditions</h3>
                <ol className="terms-list">
                  {(group.termsAndConditions || quote.termsAndConditions)
                    ? (group.termsAndConditions
                        ? group.termsAndConditions.split('\n').map((t: string) => t.trim().replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
                        : filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                      ).map((term, i) => <li key={i}>{term}</li>)
                    : <li>Standard terms and conditions apply</li>
                  }
                </ol>
              </div>

              {/* System Generated Notice */}
              <div className="system-generated-notice">
                <p>This is a system-generated quotation and does not require a signature.</p>
                <p className="generated-by">Generated by {company.name.toUpperCase()}</p>
              </div>
              </div>

              <div id={`pdf-service-ref-${groupIndex}`}>
                <ReferenceImages proposalPages={data.proposalPages} items={group.items} />
              </div>

              <div className="classic-footer">
                <div className="ornamental-line"></div>
                <p className="footer-text">
                  {company.name.toUpperCase()} - Professional {group.serviceType} Branding Services
                </p>
              </div>
            </div>
          </div>
        </React.Fragment>
      );
    })}
    </>
  );
};
