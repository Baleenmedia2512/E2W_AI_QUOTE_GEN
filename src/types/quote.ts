export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  /** Independent quantity for one-time Printing/Fixing/Mounting charges. */
  oneTimeQuantity?: number;
  quantityUnit?: string; // Qty column label e.g. "bus", "vehicle" (not "per bus")
  unitPrice: number;
  duration?: number; // Campaign duration (only when user requested months/days)
  durationUnit?: 'months' | 'days';
  durationLabel?: string; // Custom duration label e.g. "months", "per month"
  /** True when duration came from DB metadata default. */
  durationIsAuto?: boolean;
  total: number;
  remark?: string; // Optional per-row remark/note
}

export interface QuoteItem {
  id: string;
  description: string;
  details?: string;
  quantity: number;
  /** Independent quantity for one-time Printing/Fixing/Mounting charges. */
  oneTimeQuantity?: number;
  quantityUnit?: string; // Qty column label e.g. "bus", "vehicle" (not "per bus")
  rate: number;
  duration?: number; // Campaign duration (only when user requested months/days)
  durationUnit?: 'months' | 'days';
  durationLabel?: string; // Custom duration label e.g. "months", "per month"
  /** True when duration came from DB metadata default. */
  durationIsAuto?: boolean;
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
  /**
   * Per-unit one-time add-on breakdown (Printing & Mounting, RTO, …).
   * When set, pricing-breakdown formula/edit uses these instead of a single bundled rate.
   */
  oneTimeComponents?: { label: string; amount: number }[];
  /**
   * Vendor P&F unit cost stamped at quote build (margin checks if catalog cache misses).
   */
  vendorPfUnitCost?: number;
  /** Vendor display unit cost per day stamped at quote build. */
  vendorDisplayUnitCostPerDay?: number;
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
