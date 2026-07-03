export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  quantityUnit?: string; // Custom unit label e.g. "per bus", "per vehicle"
  unitPrice: number;
  duration?: number; // Campaign duration (only when user requested months/days)
  durationUnit?: 'months' | 'days';
  durationLabel?: string; // Custom duration label e.g. "months", "per month"
  /** True when duration came from DB metadata default (display only; total uses ×1). */
  durationIsAuto?: boolean;
  /** Minimum booking duration from proposal (e.g. 1 month). Used as divisor in pricing. */
  minDuration?: number;
  minDurationUnit?: 'months' | 'days';
  /** Requested width/height from user chat (for size ratio pricing). */
  reqWidth?: number;
  reqHeight?: number;
  /** Minimum width/height from proposal metadata (denominator for size ratio). */
  minWidth?: number;
  minHeight?: number;
  total: number;
  remark?: string; // Optional per-row remark/note
}

export interface QuoteItem {
  id: string;
  description: string;
  details?: string;
  quantity: number;
  quantityUnit?: string; // Custom unit label e.g. "per bus", "per vehicle"
  rate: number;
  duration?: number; // Campaign duration (only when user requested months/days)
  durationUnit?: 'months' | 'days';
  durationLabel?: string; // Custom duration label e.g. "months", "per month"
  /** True when duration came from DB metadata default (display only; total uses ×1). */
  durationIsAuto?: boolean;
  /** Minimum booking duration from proposal (e.g. 1 month). Used as divisor in pricing. */
  minDuration?: number;
  minDurationUnit?: 'months' | 'days';
  /** Requested width/height from user chat (for size ratio pricing). */
  reqWidth?: number;
  reqHeight?: number;
  /** Minimum width/height from proposal metadata (denominator for size ratio). */
  minWidth?: number;
  minHeight?: number;
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
  /** Campaign city (e.g. Chennai) — used for multi-location PDF sections */
  city?: string;
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
