export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  duration?: number; // Duration in months for recurring/per-month pricing
  total: number;
}

export interface QuoteItem {
  id: string;
  description: string;
  details?: string;
  quantity: number;
  rate: number;
  duration?: number; // Duration in months for recurring/per-month pricing
  total: number;
  // Legacy fields for backward compatibility
  title?: string;
  lineItems?: LineItem[];
  subtotal?: number;
  // Per-item terms for multi-service quotes
  termsAndConditions?: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  date: Date | string;
  validUntil: Date | string;
  items: QuoteItem[];
  subtotal: number;
  gstEnabled: boolean;
  gstPercentage: number; // GST percentage (5, 18, etc.)
  gstAmount: number;
  total: number;
  notes?: string;
  deliveryTimeline: string;
  termsAndConditions: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteState {
  currentQuote: Quote | null;
  quotes: Quote[];
}
