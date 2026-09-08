/** Vendor pricing block (mirrored _price fields inside vendor_rate_chunks.metadata.pricing). */
export interface VendorPricingBlock {
  structure?: string;
  display_price?: number | string;
  display_period?: string;
  printing_and_mounting_price?: number | string;
  printing_price?: number | string;
  mounting_price?: number | string;
  official_and_incidental_price?: number | string;
  rto_price?: number | string;
  freight_price?: number | string;
  recce_price?: number | string;
  space_rental_price?: number | string;
  total_price?: number | string;
  min_qty?: number | string;
  /** @deprecated Prefer vendor top-level min_days — not used for billing. */
  min_duration?: number | string;
  /** @deprecated Prefer vendor top-level min_days — unused for billing. */
  min_days?: number | string;
  /** @deprecated Unused — display_price is always day-wise. */
  duration_measurement_unit?: string;
  qty_measurement_unit?: string;
  production_unit?: string;
  period?: string;
  [key: string]: unknown;
}

export interface VendorImageRef {
  url: string;
  type: string;
  pageNumber?: number;
}

export interface VendorReview {
  reviewUrl?: string;
  starCount?: number;
  reviewText?: string;
  reviewerName?: string;
}

/**
 * Normalized vendor row for quotes.
 * Cost fields kept for margin checks (display_unit_cost_per_day, printing/mounting cost).
 * min_qty / min_days come from vendor top-level only (never pricing.*).
 * All display_price values are day-wise; duration_measurement_unit is unused for billing.
 */
export interface VendorRateRow {
  medium: string;
  city: string;
  vendor_name?: string;
  /** Unique site id from vendor_rate_chunks (never collapse sites on rate_key) */
  service_id?: string;
  rate_key?: string;
  /** Discriminator e.g. elevated / underground (from metadata.medium_type) */
  medium_type?: string;
  preferred_vendor_rank?: number;
  pricing?: VendorPricingBlock;
  /** Quote extras — fall back to proposal_chunks when missing */
  terms?: string;
  images?: VendorImageRef[];
  review?: VendorReview;
  lead_time_days?: number | string;
  qty_measurement_unit?: string;
  /** Vendor-level only — never from pricing.min_qty */
  min_qty?: number | string;
  /** Vendor-level minimum campaign days — never from pricing.* */
  min_days?: number | string;
  /** @deprecated Prefer min_days — legacy alias while old rows migrate. */
  min_duration?: number | string;
  /** @deprecated Unused for billing — display prices are always day-wise. */
  duration_measurement_unit?: string;
  /** Site location label (e.g. "100 feet Road towards Power house") */
  direction_remarks?: string;
  area_name?: string;
  latitude?: string | number;
  longitude?: string | number;
  /** Design / coach specs for PDF Specification section */
  specifications?: Record<string, unknown>;
  size?: string | Record<string, unknown>;
  /** Optional — omit / empty / NA → Material section hidden on PDF */
  material?: string | Record<string, unknown>;
  /** Display dimensions from DB — omit when NA / empty */
  display_width?: string | number;
  display_height?: string | number;
  display_length?: string | number;
  reference_image?: string;
  customer_review?: string;
  /** Vendor cost — display per unit per day (margin checks). */
  display_unit_cost_per_day?: number | string;
  display_cost?: number | string;
  display_cost_measurement_unit?: string;
  printing_cost?: number | string;
  mounting_cost?: number | string;
  printing_and_mounting_cost?: number | string;
  display_unit_price_per_day?: number | string;
}
