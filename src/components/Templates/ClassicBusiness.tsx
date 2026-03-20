import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, filterNotesByServiceType, DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
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
        {/* Letterhead */}
        <div className="letterhead">
          <div className="letterhead-content">
            {company.logo && (
              <div className="logo-container">
                <img src={company.logo} alt={company.name} className="letterhead-logo" />
              </div>
            )}
            <div className="letterhead-info">
              <h1 className="letterhead-name">{company.name}</h1>
              <p className="letterhead-address">{company.address}</p>
              <div className="letterhead-contact">
                {company.phone && <span>Tel: {company.phone}</span>}
                {company.email && <span>Email: {company.email}</span>}
                {company.website && <span>Web: {company.website}</span>}
              </div>
              {company.abn && <p className="letterhead-abn">ABN: {company.abn}</p>}
            </div>
          </div>
          <div className="ornamental-line"></div>
        </div>

        {/* Document Title */}
        <div className="document-title">
          <h2>QUOTATION</h2>
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

        {/* Notes */}
        {quote.notes && (
          <div className="notes-section">
            <h3 className="section-heading">Additional Information</h3>
            <div className="notes-box">
              <p>{quote.notes}</p>
            </div>
          </div>
        )}

        {/* Terms & Conditions */}
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

        {/* Acceptance Section */}
        <div className="acceptance-section">
          <h3 className="section-heading">Acceptance</h3>
          <p className="acceptance-text">
            To accept this quotation, please sign below and return a copy to our office.
            Upon receipt, we will commence work as outlined above.
          </p>
          
          <div className="signature-container">
            <div className="signature-column">
              <div className="signature-line">
                <div className="sig-box"></div>
                <div className="sig-details">
                  <p className="sig-label">For and on behalf of:</p>
                  <p className="sig-company">{company.name}</p>
                  <p className="sig-date">Date: {formatDate(new Date())}</p>
                </div>
              </div>
            </div>
            
            <div className="signature-column">
              <div className="signature-line">
                <div className="sig-box client-sig"></div>
                <div className="sig-details">
                  <p className="sig-label">Client Acceptance:</p>
                  <p className="sig-name">Name: _______________________</p>
                  <p className="sig-date">Date: _______________________</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Reference Images from Proposal - only show for single service */}
        {!isMultiService && (
          <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />
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
              <div className="letterhead">
                <div className="letterhead-content">
                  {company.logo && (
                    <div className="logo-container">
                      <img src={company.logo} alt={company.name} className="letterhead-logo" />
                    </div>
                  )}
                  <div className="letterhead-info">
                    <h1 className="letterhead-name">{company.name}</h1>
                    <p className="letterhead-address">{company.address}</p>
                    <div className="letterhead-contact">
                      {company.phone && <span>Tel: {company.phone}</span>}
                      {company.email && <span>Email: {company.email}</span>}
                    </div>
                  </div>
                </div>
                <div className="ornamental-line"></div>
              </div>

              <div className="document-title">
                <h2>{group.serviceType} BRANDING QUOTATION</h2>
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

              {/* Notes */}
              {quote.notes && (
                <div className="notes-section">
                  <h3 className="section-heading">Additional Information</h3>
                  <div className="notes-box">
                    <p>{filterNotesByServiceType(quote.notes, group.serviceType)}</p>
                  </div>
                </div>
              )}

              {/* Terms & Conditions - Service Specific */}
              <div className="terms-section">
                <h3 className="section-heading">Terms & Conditions</h3>
                <ol className="terms-list">
                  {quote.termsAndConditions
                    ? filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                        .map((term, i) => <li key={i}>{term}</li>)
                    : <li>Standard terms and conditions apply</li>
                  }
                </ol>
              </div>

              {/* Acceptance Section */}
              <div className="acceptance-section">
                <h3 className="section-heading">Acceptance</h3>
                <p className="acceptance-text">
                  To accept this quotation for {group.serviceType.toLowerCase()} branding services, 
                  please sign below and return a copy to our office. Upon receipt, we will commence work as outlined above.
                </p>
                
                <div className="signature-container">
                  <div className="signature-column">
                    <div className="signature-line">
                      <div className="sig-box"></div>
                      <div className="sig-details">
                        <p className="sig-label">For and on behalf of:</p>
                        <p className="sig-company">{company.name}</p>
                        <p className="sig-date">Date: {formatDate(new Date())}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="signature-column">
                    <div className="signature-line">
                      <div className="sig-box client-sig"></div>
                      <div className="sig-details">
                        <p className="sig-label">Client Acceptance:</p>
                        <p className="sig-name">Name: _______________________</p>
                        <p className="sig-date">Date: _______________________</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <ReferenceImages proposalPages={data.proposalPages} items={group.items} />

              <div className="classic-footer">
                <div className="ornamental-line"></div>
                <p className="footer-text">
                  {company.name} - Professional {group.serviceType} Branding Services
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
