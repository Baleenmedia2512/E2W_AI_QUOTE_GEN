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
  min_duration?: number | string;
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
 * Cost fields are never stored here.
 * min_qty / min_duration come from vendor top-level only (never pricing.*).
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
  /** Vendor-level only — never from pricing.min_duration */
  min_duration?: number | string;
  /** Vendor-level only — never from pricing.duration_measurement_unit */
  duration_measurement_unit?: string;
  /** Site location label (e.g. "100 feet Road towards Power house") */
  direction_remarks?: string;
  area_name?: string;
  /** Design / coach specs for PDF Display Specification section */
  specifications?: Record<string, unknown>;
  size?: string | Record<string, unknown>;
  material?: string | Record<string, unknown>;
  reference_image?: string;
  customer_review?: string;
}
