/**
 * Geographic location hierarchy resolved from a location string.
 * Returned by locationResolver.resolveLocation() using Nominatim API.
 *
 * Example:
 * "Karaikudi" → {town: "Karaikudi", district: "Sivaganga", state: "Tamil Nadu", ...}
 * "Chennai" → {town: "Chennai", district: null, state: "Tamil Nadu", ...}
 */
export interface ResolvedLocation {
  /** Town/village/city name (most specific) */
  town: string;
  
  /** District/county name (if available) */
  district: string | null;
  
  /** State/province name (if available) */
  state: string | null;
  
  /** Country name */
  country: string | null;
  
  /** Confidence score from geocoding service (0-1) */
  confidence: number;
}
