export interface ServiceSuggestion {
  name: string;
  category: string;
  similarity?: string;
  /** First reference image belonging to this exact catalog service. */
  imageUrl?: string;
  serviceId?: string;
  /** Per-service qty when multiple segments share one category group */
  requestedQuantity?: number;
}

export interface GroupedServices {
  vehicleType: string;
  requestedQuantity?: number;
  services: ServiceSuggestion[];
}

export interface CategoryServices {
  category: string;
  services: { name: string }[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isError?: boolean;
  failedInput?: string; // Stores original user input when error occurs (for retry functionality)
  matchType?: string; // "exact", "multiple", "partial", "none"
  
  // MULTIPLE_MATCH
  isMultipleMatch?: boolean;
  groupedServices?: GroupedServices[];
  directParts?: string[];       // Specific segments to send straight to Gemini alongside checkboxes
  originalUserInput?: string; // Stores original user message to preserve duration/days info
  
  // PARTIAL_MATCH
  isPartialMatch?: boolean;
  requestedService?: string;
  requestedQuantity?: number;
  closestServices?: ServiceSuggestion[];
  alternativeServices?: ServiceSuggestion[];
  
  // NO_MATCH
  isNoMatch?: boolean;
  allServicesGrouped?: CategoryServices[];

  // CITY PICKER
  isCityPicker?: boolean;
  // Snapshot of the cityPickerState that produced this multiple-match message,
  // so user can press "Back" on the checkbox UI to return to the city picker.
  cityPickerSnapshot?: {
    originalMessage: string;
    segments: Array<{
      raw: string;
      cityNeeded: boolean;
      detectedCity: string | null;
      selectedCities: string[];
      matchedCities?: string[];
    }>;
    availableCities: string[];
  };

  // CITY SERVICE LIST — shown when user types just a city name (e.g. "madurai")
  // to surface every service available in that city as clickable chips.
  isCityServiceList?: boolean;
  cityServiceList?: Array<{
    city: string;
    services: Array<{ name: string; minQty: number }>;
  }>;

  // RAG SEARCH RESULT — shown when user searches for services in RAG database
  isRagSearchResult?: boolean;
  ragResults?: Array<{
    service_name: string;
    service_id: string;
    content: string;
    similarity: number;
    metadata?: any;
  }>;

  /** Progressive DB+AI chat step (replaces legacy multi-match / city wizard). */
  isProgressiveChat?: boolean;
  progressiveStep?:
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
  progressiveOptions?: Array<{
    id: string;
    label: string;
    serviceId?: string;
    city?: string;
    medium?: string;
    group?: string;
    /** Optional DB reference thumbnail for chip UI. */
    imageUrl?: string;
  }>;
  progressiveAllowMulti?: boolean;
  progressiveAutoConfirmed?: string[];
  /** Batch: service currently being asked about (one chip). */
  progressiveCurrentService?: string;
  /** Batch: services already added to the quote (grows after each Confirm). */
  progressiveQuotedServices?: string[];
  /** Batch: how many services left after the current one. */
  progressiveBatchRemaining?: number;
  /** Services requested but not offered in the locked city (Cab in Madurai). */
  progressiveUnavailable?: string[];
  progressiveUnavailableCity?: string;
  progressiveBelowMin?: Array<{
    service: string;
    requested: number;
    minimum: number;
    serviceId?: string;
  }>;
  progressiveBelowMinDuration?: Array<{
    service: string;
    requested: number;
    minimum: number;
    serviceId?: string;
  }>;
  progressiveSession?: {
    originalText: string;
    medium?: string;
    mediumType?: string;
    browseToken?: string;
    city?: string;
    area?: string;
    directionHint?: string;
    placeHint?: string;
    qty: number | null;
    durationText?: string | null;
    candidateServiceIds?: string[];
    bestGuessServiceId?: string;
    bestGuessLabel?: string;
    bestGuessKind?: 'place' | 'service';
    pendingRows?: Array<{ service: string; qty: number | string; city: string; serviceId?: string; durationDays?: number }>;
    pendingMedia?: string[];
    collectedRows?: Array<{ service: string; qty: number | string; city: string; serviceId?: string; durationDays?: number }>;
    collectedServiceIds?: string[];
    aiReply?: string | null;
    segments?: Array<{ raw: string; token: string; qty: number | null; city: string | null }>;
    qtyByServiceId?: Record<string, number>;
    pendingCityQueue?: string[];
    workQueue?: Array<{
      medium: string;
      browseToken?: string;
      qty: number | null;
      city?: string;
      candidateServiceIds?: string[];
    }>;
    batchServiceLabels?: string[];
  };

  // DEPRECATED (kept for backward compatibility)
  isServiceNotFound?: boolean;
  availableServices?: ServiceSuggestion[];
  validServices?: string[];
  missingServices?: string[];
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}
