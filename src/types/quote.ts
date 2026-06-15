export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  duration?: number; // Duration value (months or days)
  durationUnit?: 'months' | 'days'; // Unit for duration field
  total: number;
  remark?: string; // Optional per-row remark/note
}

export interface QuoteItem {
  id: string;
  description: string;
  details?: string;
  quantity: number;
  rate: number;
  duration?: number; // Duration value (months or days)
  durationUnit?: 'months' | 'days'; // Unit for duration field
  total: number;
  minimumQuantity?: number; // Minimum order quantity from proposal
  remark?: string; // Optional per-row remark/note
  // Legacy fields for backward compatibility
  title?: string;
  lineItems?: LineItem[];
  subtotal?: number;
  // Per-item terms for multi-service quotes
  termsAndConditions?: string;
  /** Links to proposal_chunks.service_id for direct image lookup in preview */
  serviceId?: string;
  /** Canonical service name from proposal_chunks */
  serviceName?: string;
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
