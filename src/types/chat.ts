export interface ServiceSuggestion {
  name: string;
  category: string;
  similarity?: string;
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
  matchType?: string; // "exact", "multiple", "partial", "none"

  // MULTIPLE_MATCH
  isMultipleMatch?: boolean;
  groupedServices?: GroupedServices[];
  directParts?: string[]; // Specific segments to send straight to Gemini alongside checkboxes
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
