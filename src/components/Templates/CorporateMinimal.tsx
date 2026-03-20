import React from 'react';
import { TemplateProps } from '../../types';
import { ReferenceImages } from './ReferenceImages';
import { isMultiServiceQuote, groupItemsByServiceType, filterTermsByServiceType, filterNotesByServiceType, DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
import './CorporateMinimal.css';

export const CorporateMinimal: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
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

  // Render header component (reusable)
  const renderHeader = (showMetaInfo = true) => (
    <div className="template-header">
      <div className="company-info">
        {company.logo && (
          <img src={company.logo} alt={company.name} className="company-logo" />
        )}
        <h1 className="company-name">{company.name}</h1>
        <div className="company-details">
          <p>{company.address}</p>
          {company.phone && <p>Phone: {company.phone}</p>}
          {company.email && <p>Email: {company.email}</p>}
          {company.website && <p>Website: {company.website}</p>}
          {company.abn && <p>ABN: {company.abn}</p>}
        </div>
      </div>
      {showMetaInfo && (
        <div className="quote-meta">
          <h2>QUOTATION</h2>
          <div className="meta-details">
            <div className="meta-row">
              <span className="meta-label">Quote Number:</span>
              <span className="meta-value">{quote.quoteNumber}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Date:</span>
              <span className="meta-value">{formatDate(quote.date)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Valid Until:</span>
              <span className="meta-value">{formatDate(quote.validUntil)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Render client details component (reusable)
  const renderClientDetails = () => (
    <div className="client-section">
      <h3>Quote Prepared For:</h3>
      <div className="client-details">
        <p className="client-name">{client.name}</p>
        {client.company && <p>{client.company}</p>}
        {client.email && <p>Email: {client.email}</p>}
        {client.phone && <p>Phone: {client.phone}</p>}
        {client.address && <p>Address: {client.address}</p>}
      </div>
    </div>
  );

  // Single service quote (original behavior)
  if (!isMultiService) {
    return (
      <div className="template-corporate-minimal">
        {renderHeader()}
        {renderClientDetails()}

        {/* Quote Items */}
        <div className="quote-items-section">
          <table className="items-table">
            <thead>
              <tr>
                <th className="col-description">Description</th>
                <th className="col-quantity">Quantity</th>
                <th className="col-rate">Rate</th>
                <th className="col-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                <tr key={index}>
                  <td className="item-description">
                    <div className="item-title">{item.description}</div>
                    {item.details && <div className="item-details">{item.details}</div>}
                  </td>
                  <td className="item-quantity">{item.quantity}</td>
                  <td className="item-rate">{formatCurrency(item.rate)}</td>
                  <td className="item-total">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="totals-section">
          <div className="totals-table">
            <div className="total-row">
              <span className="total-label">Subtotal:</span>
              <span className="total-value">{formatCurrency(calculateSubtotal())}</span>
            </div>
            {quote.gstEnabled && (
              <div className="total-row">
                <span className="total-label">GST ({quote.gstPercentage}%):</span>
                <span className="total-value">{formatCurrency(calculateGST())}</span>
              </div>
            )}
            <div className="total-row total-final">
              <span className="total-label">Total (INR):</span>
              <span className="total-value">{formatCurrency(calculateTotal())}</span>
            </div>
          </div>
        </div>

        {/* Terms & Conditions */}
        {quote.notes && (
          <div className="notes-section">
            <h3>Notes:</h3>
            <p>{quote.notes}</p>
          </div>
        )}

        <div className="terms-section">
          <h3>Terms & Conditions:</h3>
          <ul>
            {quote.termsAndConditions
              ? quote.termsAndConditions
                  .split(/\n|•|\d+\.\s/)
                  .map(t => t.trim())
                  .filter(Boolean)
                  .map((term, i) => <li key={i}>{term}</li>)
              : <li>Standard terms and conditions apply</li>
            }
          </ul>
        </div>

        {/* System Generated Notice */}
        <div className="system-generated-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
          <p className="generated-by">Generated by {company.name}</p>
        </div>

        {/* Reference Images from Proposal */}
        <ReferenceImages proposalPages={data.proposalPages} items={quote.items} />
      </div>
    );
  }

  // Multi-service quote - render summary + individual service pages
  return (
    <>
      {/* Page 1: Summary Page */}
      <div className="template-corporate-minimal">
        {renderHeader()}
        {renderClientDetails()}

        <div className="quote-items-section">
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>
            Quote Summary - All Services
          </h3>
          <table className="items-table">
            <thead>
              <tr>
                <th className="col-description">Description</th>
                <th className="col-quantity">Quantity</th>
                <th className="col-rate">Rate</th>
                <th className="col-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                <tr key={index}>
                  <td className="item-description">
                    <div className="item-title">{item.description}</div>
                    {item.details && <div className="item-details">{item.details}</div>}
                  </td>
                  <td className="item-quantity">{item.quantity}</td>
                  <td className="item-rate">{formatCurrency(item.rate)}</td>
                  <td className="item-total">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="totals-section">
          <div className="totals-table">
            <div className="total-row">
              <span className="total-label">Subtotal:</span>
              <span className="total-value">{formatCurrency(calculateSubtotal())}</span>
            </div>
            {quote.gstEnabled && (
              <div className="total-row">
                <span className="total-label">GST ({quote.gstPercentage}%):</span>
                <span className="total-value">{formatCurrency(calculateGST())}</span>
              </div>
            )}
            <div className="total-row total-final">
              <span className="total-label">Total (INR):</span>
              <span className="total-value">{formatCurrency(calculateTotal())}</span>
            </div>
          </div>
        </div>

        {/* Terms & Conditions */}
        {quote.notes && (
          <div className="notes-section">
            <h3>Notes:</h3>
            <p>{quote.notes}</p>
          </div>
        )}

        <div className="terms-section">
          <h3>Terms & Conditions:</h3>
          <ul>
            {DEFAULT_GENERAL_TERMS.map((term, i) => <li key={i}>{term}</li>)}
          </ul>
        </div>

        <div className="system-generated-notice">
          <p>This is a system-generated quotation and does not require a signature.</p>
          <p className="generated-by">Generated by {company.name}</p>
        </div>
      </div>

      {/* Pages 2+: Individual Service Pages */}
      {serviceGroups.map((group, groupIndex) => {
        const groupSubtotal = group.subtotal;
        const groupGST = quote.gstEnabled ? groupSubtotal * (quote.gstPercentage / 100) : 0;
        const groupTotal = groupSubtotal + groupGST;

        return (
          <React.Fragment key={groupIndex}>
            <div style={{ pageBreakBefore: 'always' }} />
            <div className="template-corporate-minimal">
              {renderHeader()}
              {renderClientDetails()}

              <div className="quote-items-section">
                <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600', color: '#750926' }}>
                  {group.serviceType} Branding Services
                </h3>
                <table className="items-table">
                  <thead>
                    <tr>
                      <th className="col-description">Description</th>
                      <th className="col-quantity">Quantity</th>
                      <th className="col-rate">Rate</th>
                      <th className="col-total">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, index) => (
                      <tr key={index}>
                        <td className="item-description">
                          <div className="item-title">{item.description}</div>
                          {item.details && <div className="item-details">{item.details}</div>}
                        </td>
                        <td className="item-quantity">{item.quantity}</td>
                        <td className="item-rate">{formatCurrency(item.rate)}</td>
                        <td className="item-total">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="totals-section">
                <div className="totals-table">
                  <div className="total-row">
                    <span className="total-label">Subtotal:</span>
                    <span className="total-value">{formatCurrency(groupSubtotal)}</span>
                  </div>
                  {quote.gstEnabled && (
                    <div className="total-row">
                      <span className="total-label">GST ({quote.gstPercentage}%):</span>
                      <span className="total-value">{formatCurrency(groupGST)}</span>
                    </div>
                  )}
                  <div className="total-row total-final">
                    <span className="total-label">Total (INR):</span>
                    <span className="total-value">{formatCurrency(groupTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {quote.notes && (
                <div className="notes-section">
                  <h3>Notes:</h3>
                  <p>{filterNotesByServiceType(quote.notes, group.serviceType)}</p>
                </div>
              )}

              {/* Terms & Conditions - Service Specific */}
              <div className="terms-section">
                <h3>Terms & Conditions:</h3>
                <ul>
                  {quote.termsAndConditions
                    ? filterTermsByServiceType(quote.termsAndConditions, group.serviceType)
                        .map((term, i) => <li key={i}>{term}</li>)
                    : <li>Standard terms and conditions apply</li>
                  }
                </ul>
              </div>

              <div className="system-generated-notice">
                <p>This is a system-generated quotation and does not require a signature.</p>
                <p className="generated-by">Generated by {company.name}</p>
              </div>

              {/* Service-specific reference images */}
              <ReferenceImages proposalPages={data.proposalPages} items={group.items} />
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};
