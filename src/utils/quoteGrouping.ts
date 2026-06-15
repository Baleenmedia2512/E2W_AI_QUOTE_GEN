import { QuoteItem } from '../types/quote';

export interface ServiceGroup {
  serviceType: string;
  items: QuoteItem[];
  subtotal: number;
  termsAndConditions?: string;
}

/**
 * Default general terms and conditions to show on summary page for multi-service quotes
 */
export const DEFAULT_GENERAL_TERMS = [
  'Prices are exclusive of GST',
  'Ad. Material shall be shared by the client or Design charges extra applicable',
  '100% Upfront payment required for releasing the Ads',
  'Printed colors may look different from digital design',
  'Client must approved the final design before printing. Once approved, Baleen Media will not be responsible for any design errors.',
  'If the client stops the campaign during campaign period, no refund will be provided'
];

/**
 * Extract service type from item description.
 * Returns the specific service name by stripping price/rate suffixes first.
 * Examples:
 *   "Bus Semi Branding - Rental Price (per Bus month)"    → "Bus Semi Branding"
 *   "Bus Shelter Panel - Lit - Display Price (for 30 days)" → "Bus Shelter Panel - Lit"
 *   "Auto Full Branding - Printing & Fixing Price"        → "Auto Full Branding"
 * Falls back to vehicle keyword for simple single-word descriptions.
 */
export function extractServiceType(description: string): string {
  // Normalize embedded hyphens between word chars (e.g. "Van-Non" → "Van Non")
  // so descriptions like "Mobile Van-Non Led" and "Mobile Van Non Led" resolve
  // to the same service type key regardless of how Gemini formats them.
  const description_norm = description.replace(/(\w)-(\w)/g, '$1 $2');

  // Step 1: Strip ALL price/rate/cost type suffixes to get the base service name.
  // Pattern covers:
  //   "- Distribution Price (per copy)"  → strip
  //   "- Design Price (Extra)"           → strip
  //   "- Display Price"                  → strip
  //   "- Printing & Fixing Price"        → strip
  //   "- Rental Price"                   → strip
  //   "- Installation Price"             → strip
  //   "- Rate (per month)"               → strip
  // The broad fallback catches any "- <Word(s)> Price/Rate/Cost/Charge" pattern.
  const priceSuffixPattern = /\s*[-–—]\s*(Display|Rental|Printing|Fixing|Installation|Mounting|Labour|Creative|Design|Distribution|Delivery|Insertion|Rate|Price|Cost|Charge|Extra)\b.*/i;
  // Broad fallback: "- Anything Price/Rate/Cost/Charge..."
  const broadSuffixPattern = /\s*[-–—]\s*[\w\s&]+?\s+(Price|Rate|Cost|Charge|Pricing)\b.*/i;

  let stripped = description_norm
    .replace(priceSuffixPattern, '')
    .trim()
    .replace(/\s*[-–—]\s*$/, '')
    .trim();

  // Apply broad pattern if specific one didn't change anything
  if (stripped === description_norm.trim()) {
    stripped = description_norm
      .replace(broadSuffixPattern, '')
      .trim()
      .replace(/\s*[-–—]\s*$/, '')
      .trim();
  }

  // If stripping produced a multi-word result it is a meaningful specific service name.
  // Single-word results (e.g. "Bus") fall through to keyword matching below.
  if (stripped && stripped.includes(' ')) {
    return stripped;
  }

  // Step 2: Fallback — vehicle/service keyword matching (backward compatibility).
  const desc = description_norm.toLowerCase();
  if (desc.includes('bus')) return 'Bus';
  if (desc.includes('auto')) return 'Auto';
  if (desc.includes('tempo')) return 'Tempo';
  if (desc.includes('cab') || desc.includes('taxi')) return 'Cab';
  if (desc.includes('truck')) return 'Truck';
  if (desc.includes('vehicle')) return 'Vehicle';
  if (desc.includes('banner')) return 'Banner';
  if (desc.includes('signage') || desc.includes('sign board')) return 'Signage';
  if (desc.includes('hoarding')) return 'Hoarding';
  if (desc.includes('flex') || desc.includes('vinyl')) return 'Printing';
  if (desc.includes('brochure') || desc.includes('pamphlet')) return 'Print Materials';

  // Default: use first word if no match
  const firstWord = description.split(/[\s\-,]+/)[0];
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
}

/**
 * Group quote items by service type
 */
export function groupItemsByServiceType(items: QuoteItem[]): ServiceGroup[] {
  const groups = new Map<string, QuoteItem[]>();
  
  items.forEach(item => {
    const serviceType = extractServiceType(item.description);
    if (!groups.has(serviceType)) {
      groups.set(serviceType, []);
    }
    groups.get(serviceType)!.push(item);
  });
  
  // Convert to array and calculate subtotals
  return Array.from(groups.entries()).map(([serviceType, groupItems]) => ({
    serviceType,
    items: groupItems,
    subtotal: groupItems.reduce((sum, item) => sum + item.total, 0),
    termsAndConditions: groupItems[0]?.termsAndConditions
  }));
}

/**
 * Check if quote has multiple service types
 */
export function isMultiServiceQuote(items: QuoteItem[]): boolean {
  const serviceTypes = new Set<string>();
  items.forEach(item => {
    serviceTypes.add(extractServiceType(item.description));
  });
  return serviceTypes.size > 1;
}

/**
 * Filter terms and conditions for a specific service type
 * Returns array of filtered terms
 */
export function filterTermsByServiceType(termsAndConditions: string, serviceType: string): string[] {
  if (!termsAndConditions) return [];

  const serviceTypeLower = serviceType.toLowerCase();

  // serviceType may now be a full specific name like "Bus Semi Branding" instead of just "Bus".
  // Extract the base vehicle keyword for matching against T&C section headers which use
  // single vehicle keywords (bus, auto, etc.).
  const serviceKeywords = ['bus', 'auto', 'tempo', 'cab', 'truck', 'van', 'vehicle'];
  const vehicleKeyword = serviceKeywords.find(k => serviceTypeLower.includes(k)) || serviceTypeLower;

  // Split by newlines and bullets to get individual lines
  const lines = termsAndConditions
    .split(/\n/)
    .map(t => t.trim().replace(/^[•\-\*]\s*/, '').replace(/\s*\|\s*/g, ' ').trim())
    .filter(Boolean);

  const filteredTerms: string[] = [];
  let currentServiceSection = '';

  for (const line of lines) {
    const lineLower = line.toLowerCase();

    // Check if this line is a service section header (e.g., "Bus Full Branding:")
    const isServiceHeader = serviceKeywords.some(keyword =>
      lineLower.includes(keyword) && lineLower.includes(':')
    );

    if (isServiceHeader) {
      // This is a section header - determine which service it belongs to
      currentServiceSection = '';
      for (const keyword of serviceKeywords) {
        if (lineLower.includes(keyword)) {
          currentServiceSection = keyword;
          break;
        }
      }

      // If this header matches our target vehicle keyword, include it
      if (currentServiceSection === vehicleKeyword) {
        filteredTerms.push(line);
      }
    } else {
      // This is a regular term - include it if we're in the right service section
      if (currentServiceSection === vehicleKeyword) {
        filteredTerms.push(line);
      } else if (currentServiceSection === '') {
        // No section detected yet, check if term explicitly mentions the vehicle keyword
        if (lineLower.includes(vehicleKeyword)) {
          filteredTerms.push(line);
        }
      }
    }
  }

  return filteredTerms;
}

/**
 * Get only general terms (non-service-specific) for summary page
 * Returns ONLY terms that don't mention any service type keywords
 */
/** Split raw T&C text into display-ready lines (strips bullet prefixes). */
export function normalizeTermsList(rawTerms: string): string[] {
  if (!rawTerms?.trim()) return [];
  return rawTerms
    .split('\n')
    .map((t) =>
      t
        .trim()
        .replace(/^[\u2022\u2023\u25aa\u25cf\-\–\*•]\s*/, '')
        .replace(/\s*\|\s*/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * General terms for PDF summary — prefers extracted general lines, falls back to defaults
 * only when no quote terms exist at all.
 */
export function resolveGeneralTermsList(
  quoteTerms: string,
  hasServiceSpecificTerms: boolean,
): string[] {
  const general = getGeneralTerms(quoteTerms);
  if (general.length > 0) return general;

  if (quoteTerms.trim()) {
    return hasServiceSpecificTerms ? [] : normalizeTermsList(quoteTerms);
  }

  return [...DEFAULT_GENERAL_TERMS];
}

export function getGeneralTerms(termsAndConditions: string): string[] {
  if (!termsAndConditions) return [];
  
  // Split by newlines to get individual lines
  const lines = termsAndConditions
    .split(/\n/)
    .map(t => t.trim().replace(/\s*\|\s*/g, ' '))
    .filter(Boolean);
  
  const generalTerms: string[] = [];
  
  // List of all service type keywords
  const serviceKeywords = ['bus', 'auto', 'tempo', 'cab', 'truck', 'van', 'vehicle', 'branding'];
  
  // Track terms we've seen - if we see very similar terms with different numbers,
  // they're likely service-specific (e.g., "10 working days" vs "7 working days")
  const termPatterns = new Map<string, number>();
  
  for (const line of lines) {
    // Remove leading bullets/numbers for analysis
    const cleanLine = line.replace(/^[•\-\*\d+\.\s]+/, '').trim();
    const cleanLineLower = cleanLine.toLowerCase();
    
    // Skip if this line is a service section header (has keyword + colon)
    const isServiceHeader = serviceKeywords.some(keyword => 
      cleanLineLower.includes(keyword) && cleanLineLower.includes(':')
    );
    
    if (isServiceHeader) {
      continue; // Skip service headers
    }
    
    // Skip if line mentions ANY service keyword (it's service-specific)
    const mentionsService = serviceKeywords.some(keyword => 
      cleanLineLower.includes(keyword)
    );
    
    if (mentionsService) {
      continue; // Skip service-specific terms
    }
    
    // Create a pattern by removing numbers - this helps detect service-specific terms
    // e.g., "10 working days" and "7 working days" both become "working days"
    const pattern = cleanLineLower.replace(/\d+/g, 'X');
    
    // Count how many times we see this pattern
    termPatterns.set(pattern, (termPatterns.get(pattern) || 0) + 1);
  }
  
  // Now filter: exclude terms whose pattern appears multiple times (service-specific variations)
  for (const line of lines) {
    const cleanLine = line.replace(/^[•\-\*\d+\.\s]+/, '').trim();
    const cleanLineLower = cleanLine.toLowerCase();
    
    // Skip service headers
    const isServiceHeader = serviceKeywords.some(keyword => 
      cleanLineLower.includes(keyword) && cleanLineLower.includes(':')
    );
    if (isServiceHeader) continue;
    
    // Skip if mentions service
    const mentionsService = serviceKeywords.some(keyword => 
      cleanLineLower.includes(keyword)
    );
    if (mentionsService) continue;
    
    // Get pattern and check if it appears multiple times
    const pattern = cleanLineLower.replace(/\d+/g, 'X');
    const patternCount = termPatterns.get(pattern) || 0;
    
    // If pattern appears multiple times, it's service-specific (skip it)
    if (patternCount > 1) {
      continue;
    }
    
    // This is a general term - include it
    generalTerms.push(cleanLine);
  }
  
  return generalTerms;
}


/**
 * Filter notes for a specific service type
 */
export function filterNotesByServiceType(notes: string | undefined, serviceType: string): string {
  if (!notes) return '';

  const serviceTypeLower = serviceType.toLowerCase();

  // serviceType may now be a full specific name like "Bus Semi Branding" — extract vehicle keyword.
  const serviceKeywords = ['bus', 'auto', 'tempo', 'cab', 'truck', 'van', 'vehicle'];
  const vehicleKeyword = serviceKeywords.find(k => serviceTypeLower.includes(k)) || serviceTypeLower;

  // Split notes by newlines to handle structured notes
  const lines = notes.split(/\n/).map(s => s.trim()).filter(Boolean);

  const filteredLines: string[] = [];
  let currentServiceSection = '';

  for (const line of lines) {
    const lineLower = line.toLowerCase();

    // Check if this line is a service section header
    const isServiceHeader = serviceKeywords.some(keyword =>
      lineLower.includes(keyword) && (lineLower.includes(':') || lineLower.endsWith(keyword))
    );

    if (isServiceHeader) {
      // Determine which service this header belongs to
      currentServiceSection = '';
      for (const keyword of serviceKeywords) {
        if (lineLower.includes(keyword)) {
          currentServiceSection = keyword;
          break;
        }
      }

      // Include header if it matches our target vehicle keyword
      if (currentServiceSection === vehicleKeyword) {
        filteredLines.push(line);
      }
    } else {
      // Regular note line
      if (currentServiceSection === vehicleKeyword) {
        filteredLines.push(line);
      } else if (currentServiceSection === '') {
        // No section detected, check if line mentions the vehicle keyword
        if (lineLower.includes(vehicleKeyword)) {
          filteredLines.push(line);
        }
      }
    }
  }

  return filteredLines.join(' ');
}

/**
 * Get a clean heading for a service group.
 * group.serviceType is now the specific service name (e.g. "Bus Semi Branding",
 * "Bus Shelter Panel - Lit") so we return it directly.
 */
export function getServiceGroupHeading(group: ServiceGroup): string {
  return group.serviceType;
}
