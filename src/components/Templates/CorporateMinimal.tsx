import React from 'react';
import { TemplateProps } from '../../types';
import './CorporateMinimal.css';

export const CorporateMinimal: React.FC<TemplateProps> = ({ data, editable: _editable = false, onDataChange: _onDataChange }) => {
  const { company, client, quote } = data;

  const calculateSubtotal = () => {
    return quote.items.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateGST = () => {
    const subtotal = calculateSubtotal();
    return subtotal * 0.1; // 10% GST
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
    <div className="template-corporate-minimal">
      {/* Header */}
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
      </div>

      {/* Client Details */}
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
          <div className="total-row">
            <span className="total-label">GST (10%):</span>
            <span className="total-value">{formatCurrency(calculateGST())}</span>
          </div>
          <div className="total-row total-final">
            <span className="total-label">Total (AUD):</span>
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
          <li>This quotation is valid for 30 days from the date of issue</li>
          <li>Payment terms: Net 30 days from invoice date</li>
          <li>Prices are in Australian Dollars (AUD) and include GST where applicable</li>
          <li>A deposit of 50% may be required before commencement of work</li>
          <li>Any variations to the scope of work will be quoted separately</li>
        </ul>
      </div>

      {/* Signature */}
      <div className="signature-section">
        <div className="signature-box">
          <div className="signature-line"></div>
          <p className="signature-label">Authorized Signature</p>
          <p className="signature-name">{company.name}</p>
        </div>
        <div className="signature-box">
          <div className="signature-line"></div>
          <p className="signature-label">Client Acceptance</p>
          <p className="signature-date">Date: _______________</p>
        </div>
      </div>
    </div>
  );
};
