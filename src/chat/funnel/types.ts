/**
 * Funnel session / turn types (Phase 7.1).
 */
import type { ConfirmationRow } from '../../utils/cloudQuoteValidation';

export type ProgressiveStep =
  | 'related_services'
  | 'did_you_mean'
  | 'pick_city'
  | 'pick_area'
  | 'pick_type'
  | 'pick_direction'
  | 'no_match'
  | 'min_qty_confirm'
  | 'min_duration_confirm'
  | 'qty_or_duration_clarify'
  | 'quote_ready'
  | 'small_talk';

export interface ProgressiveOption {
  id: string;
  label: string;
  serviceId?: string;
  city?: string;
  medium?: string;
  /** DB medium_type discriminator (elevated / underground / …). */
  mediumType?: string;
  /** Group header label for grouped checklist (batch multi-select). */
  group?: string;
  /** Optional reference thumbnail from DB (omit when missing). */
  imageUrl?: string;
}

export interface BatchSegment {
  raw: string;
  token: string;
  qty: number | null;
  city: string | null;
}

export interface ProgressiveSession {
  originalText: string;
  medium?: string;
  /**
   * Selected DB medium_type (elevated / underground / Nonlit …) after type chip.
   * Left unset when user Confirms 2+ types on the same medium (union via candidates).
   */
  mediumType?: string;
  /**
   * True after type step was answered (single lock or multi-type Confirm union).
   * Prevents re-asking Frontlit/Nonlit after multi Confirm when mediumType is unset.
   */
  typesResolved?: boolean;
  /** Browse token from user text (bus, shelter, led) — broader than one medium key. */
  browseToken?: string;
  city?: string;
  area?: string;
  /**
   * Site / direction phrase from free text (e.g. "Gemini Flyover").
   * Used to narrow pool before asking Service → Type → City → Area.
   */
  directionHint?: string;
  /** Confirmed place hint from Did-you-mean (e.g. Gandhi Nagar) for batch/area. */
  placeHint?: string;
  qty: number | null;
  durationText?: string | null;
  candidateServiceIds?: string[];
  bestGuessServiceId?: string;
  bestGuessLabel?: string;
  /** Did-you-mean target: place name or service medium. */
  bestGuessKind?: 'place' | 'service';
  pendingRows?: ConfirmationRow[];
  /** Remaining media types for multi-service (legacy sequential — prefer segments batch). */
  pendingMedia?: string[];
  collectedRows?: ConfirmationRow[];
  collectedServiceIds?: string[];
  aiReply?: string | null;
  /** Last bot opening phrase — avoid repeating the same opener twice in a row. */
  lastOpener?: string | null;
  /** Rotation index for deterministic opener variety. */
  openerIdx?: number;
  /** Last no-match / unavailable message key — avoid identical error loops. */
  lastErrorKey?: string | null;
  /** Multi-service batch: parsed qty+token segments from one message. */
  segments?: BatchSegment[];
  /** Per service_id quantity from segment parsing. */
  qtyByServiceId?: Record<string, number>;
  /**
   * Compact batch chip id → service ids (avoids megabyte `batch-group:uuid,uuid,...` strings).
   */
  batchGroupMap?: Record<string, string[]>;
  /**
   * Remaining cities to process sequentially after multi-city Confirm
   * (area → direction for each).
   */
  pendingCityQueue?: string[];
  /**
   * Remaining batch work items (service + city) after multi-select Confirm.
   */
  workQueue?: Array<{
    medium: string;
    browseToken?: string;
    qty: number | null;
    city?: string;
    area?: string;
    mediumType?: string;
    candidateServiceIds?: string[];
  }>;
  /**
   * Display names for multi-service batch (shown on chip cards as “Selected services”).
   */
  batchServiceLabels?: string[];
  /** Requested services not offered in the locked city (e.g. Cab in Madurai). */
  batchUnavailableLabels?: string[];
  /** One-shot note: "We currently don’t offer Cab in Madurai." */
  batchUnavailableNote?: string;
  /** True after the unavailable note was shown once in botText. */
  batchUnavailableSpoken?: boolean;
  /**
   * Place-only browse (e.g. "hosur"/"madurai") — block silent quote finalize
   * until the user picks a service chip or Continue.
   */
  needsContinueConfirm?: boolean;
  /**
   * User named a place/city/site that is not in catalogue for this service.
   * Force offering available cities/areas — never silent auto-lock → quote.
   */
  unresolvedPlaceOffer?: boolean;
  /** Nominatim hierarchy for statewide / state-labelled DB city coverage. */
  resolvedLocation?: import('../../types/location').ResolvedLocation | null;
}

export interface ProgressiveTurnResult {
  step: ProgressiveStep;
  botText: string;
  options: ProgressiveOption[];
  allowMulti?: boolean;
  session: ProgressiveSession;
  /** When set, caller should generate quote immediately */
  quoteRows?: ConfirmationRow[];
  /** Service names auto-confirmed without city question (rendered as a badge list in UI). */
  autoConfirmedList?: string[];
  /** Min-qty details for each service below minimum (rendered as a structured card). */
  belowMinDetails?: Array<{
    service: string;
    requested: number;
    minimum: number;
    serviceId?: string;
  }>;
}

export type CatalogueBrowseKind = 'services' | 'cities' | 'areas' | 'types';

/**
 * Detect listing / availability questions (not a plain quote request).
 * Examples: "what services are available?", "which cities?", "areas available in chennai"
 */

export interface IntentOverlay {
  kind?: string | null;
  media?: string[] | null;
  medium?: string | null;
  city?: string | null;
  areaHint?: string | null;
  directionHint?: string | null;
  ambiguous?: boolean;
  clarifyHint?: string | null;
  qty?: number | null;
  duration?: string | null;
  shortReply?: string | null;
  /** Nominatim hierarchy when ChatInterface resolved a city geography. */
  resolvedLocation?: import('../../types/location').ResolvedLocation | null;
}
