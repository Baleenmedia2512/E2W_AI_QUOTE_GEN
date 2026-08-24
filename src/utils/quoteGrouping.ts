import { QuoteItem } from '../types/quote';
import {
  isOneTimeLineDescription,
  computeQuoteItemTotal,
  toCampaignDays,
  toDailyRate,
  toDisplayDuration,
  toDisplayRecurringRate,
  DAYS_PER_MONTH,
  shouldDisplayAsMonths,
} from './durationUtils';
import { formatUnitRateInr } from './rateDisplay';
import { listOneTimeAddOnComponents } from './dbPricingUtils';
import { resolveDbServiceForQuoteItem } from './quoteEditValidation';
import { canonicalizeServiceName } from './serviceNameUtils';
import { formatServiceHeadingDisplay } from './serviceHeading';

export interface ServiceGroup {
  serviceType: string;
  /** City label when quote spans multiple locations (e.g. "Chennai") */
  city?: string;
  items: QuoteItem[];
  subtotal: number;
  termsAndConditions?: string;
}

/** Unique group key: city + service when city is set, else service only. */
export function getQuoteItemGroupKey(item: QuoteItem): string {
  const serviceType = extractServiceType(item.description);
  const city = item.city?.trim().toLowerCase();
  if (city && city !== '—') {
    return `${city}|${serviceType.toLowerCase()}`;
  }
  return serviceType.toLowerCase();
}

/** True when quote items span more than one city. */
export function quoteHasMultipleCities(items: QuoteItem[]): boolean {
  const cities = new Set(
    items
      .map((i) => i.city?.trim().toLowerCase())
      .filter((c) => c && c !== '—'),
  );
  return cities.size > 1;
}

/** Prefix description with city on summary tables when multiple cities present. */
export function formatQuoteItemDescription(item: QuoteItem, showCity: boolean): string {
  if (!showCity || !item.city?.trim() || item.city === '—') {
    return item.description;
  }
  const cityLabel = item.city.charAt(0).toUpperCase() + item.city.slice(1);
  return `${cityLabel} — ${item.description}`;
}

/** One row per service for Executive Pricing Summary (Display + P&F collapsed). */
export interface ExecutiveSummaryRow {
  id: string;
  /** Display label (title-cased) */
  serviceId: string;
  /** Raw catalog service_id for vendor lookup / grouping */
  catalogServiceId?: string;
  quantity: number;
  /** Independent quantity used by Printing/Fixing/Mounting. */
  oneTimeQuantity: number;
  quantityUnit?: string;
  /** Display duration value (months when exact ×30, else days) */
  duration?: number;
  durationUnit?: 'months' | 'days';
  durationLabel?: string;
  /** Stored campaign length in days (for edits / formulas) */
  durationDays?: number;
  /** Display / recurring unit rate (excl. GST) — monthly or daily per ratePeriod */
  requiringCharge: number;
  /** Stored daily recurring rate (for edits) */
  dailyRate?: number;
  /** How requiringCharge is labeled in UI */
  ratePeriod?: 'per_day' | 'per_month';
  /** Printing & Fixing / one-time unit rate (excl. GST) */
  oneTimeCharge: number;
  /** Optional one-time component breakdown used by inline summary edits. */
  oneTimeComponents?: { label: string; amount: number }[];
  /** Combined line totals excl. GST */
  amountExclGst: number;
  remark?: string;
}

function executiveSummaryGroupKey(item: QuoteItem): string {
  if (item.serviceId?.trim()) {
    return item.serviceId.trim().toLowerCase();
  }
  return getQuoteItemGroupKey(item);
}

/** Display tokens that must stay fully uppercase (from kebab service_id). */
const SERVICE_ID_ACRONYMS = new Set([
  'led',
  'lcd',
  'oled',
  'gst',
  'ifsc',
  'abn',
  'atm',
  'tv',
  'ac',
]);

function titleCaseServiceIdWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  if (SERVICE_ID_ACRONYMS.has(lower)) return lower.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Display service id: apartment-lift-branding-chennai → Apartment Lift Branding Chennai */
export function formatServiceIdDisplay(serviceId: string): string {
  const spaced = serviceId
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return serviceId;
  return spaced
    .split(' ')
    .map(titleCaseServiceIdWord)
    .join(' ');
}

/**
 * Collapse Display Price + Printing & Fixing lines into one row per service_id.
 * RECURRING CHARGE = display_price; ONE TIME CHARGE = P&F; amount is excl. GST.
 */
export function buildExecutiveSummaryRows(items: QuoteItem[]): ExecutiveSummaryRow[] {
  const visible = items.filter((i) => i.rate !== 0 || i.total !== 0);
  const groups = new Map<string, QuoteItem[]>();

  for (const item of visible) {
    const key = executiveSummaryGroupKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const rows: ExecutiveSummaryRow[] = [];
  for (const group of groups.values()) {
    const primary = group.find((i) => !isOneTimeLineDescription(i.description)) || group[0];
    let requiringCharge = 0;
    let oneTimeCharge = 0;
    let amountExclGst = 0;

    for (const item of group) {
      // Recompute so month-display formulas match amounts (not stale daily×days drift)
      amountExclGst += computeQuoteItemTotal(item);
      if (isOneTimeLineDescription(item.description)) {
        if (oneTimeCharge <= 0) oneTimeCharge = item.rate;
      } else if (requiringCharge <= 0) {
        requiringCharge = item.rate;
      }
    }

    const rawServiceId =
      group.find((i) => i.serviceId?.trim())?.serviceId?.trim() ||
      group.find((i) => i.serviceName?.trim())?.serviceName?.trim() ||
      extractServiceType(primary.description);
    const serviceId = formatServiceIdDisplay(rawServiceId);

    // Vendor catalog display rates are stored per day. Show monthly only for
    // complete 30-day periods; partial campaigns stay explicitly day-wise.
    const durationDays = toCampaignDays(primary.duration, primary.durationUnit);
    const dailyRate =
      durationDays != null && requiringCharge > 0
        ? toDailyRate(requiringCharge, primary.durationUnit)
        : requiringCharge;
    const displayDur = durationDays != null ? toDisplayDuration(durationDays) : null;
    const displayRate =
      dailyRate > 0 ? toDisplayRecurringRate(dailyRate, durationDays) : null;

    const displayLine = group.find((i) => !isOneTimeLineDescription(i.description));
    const pfLine = group.find((i) => isOneTimeLineDescription(i.description));
    const summaryQty = displayLine
      ? displayLine.quantity
      : (pfLine?.oneTimeQuantity ?? pfLine?.quantity ?? primary.quantity);

    rows.push({
      id: primary.id,
      serviceId,
      catalogServiceId: rawServiceId,
      quantity: summaryQty,
      oneTimeQuantity:
        pfLine?.oneTimeQuantity ??
        pfLine?.quantity ??
        primary.quantity,
      quantityUnit: primary.quantityUnit,
      duration: displayDur?.value,
      durationUnit: displayDur?.unit,
      durationLabel: displayDur?.label,
      durationDays: durationDays ?? undefined,
      requiringCharge: displayRate?.rate ?? 0,
      dailyRate: dailyRate > 0 ? dailyRate : undefined,
      ratePeriod: displayRate?.period,
      oneTimeCharge,
      amountExclGst,
      // Remarks belong in the Specification section only — never on this summary table
      remark: undefined,
    });
  }

  return rows;
}

/** Line in the per-service Pricing Breakdown (DESCRIPTION / AMOUNT). */
export interface PricingBreakdownLine {
  kind: 'display' | 'onetime' | 'subtotal';
  descriptionLines: string[];
  amount: number;
  /** Executive-summary row for inline edits (display / onetime only). */
  editRow?: ExecutiveSummaryRow;
  /** Qty unit label used in the formula (e.g. "buses", "bus"). */
  formulaQtyUnit?: string;
  /** Per-unit one-time parts for separate edit fields (onetime only). */
  oneTimeComponents?: { label: string; amount: number }[];
}

/** Singular qty unit for formulas (e.g. "bus", "Auto"). */
function singularQtyUnit(unit: string | undefined): string {
  const raw = (unit || 'unit').replace(/^per\s+/i, '').trim() || 'unit';
  // Already-plural common forms → singular
  if (/^buses$/i.test(raw)) return raw[0] === raw[0].toUpperCase() ? 'Bus' : 'bus';
  if (/^autos$/i.test(raw)) return raw[0] === raw[0].toUpperCase() ? 'Auto' : 'auto';
  if (/ies$/i.test(raw) && raw.length > 3) {
    return `${raw.slice(0, -3)}y`;
  }
  if (/s$/i.test(raw) && !/(ss|us|is)$/i.test(raw)) {
    return raw.slice(0, -1);
  }
  return raw;
}

/** Plural qty unit for description titles (e.g. "buses", "Autos") — all unit types. */
function pluralizeQtyUnit(unit: string | undefined, qty: number): string {
  const raw = singularQtyUnit(unit);
  if (qty === 1) return raw;
  const lower = raw.toLowerCase();
  const irregular: Record<string, string> = {
    bus: 'buses',
    auto: 'autos',
  };
  if (irregular[lower]) {
    const plural = irregular[lower];
    // Preserve leading capital (Auto → Autos, bus → buses)
    if (raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase()) {
      return plural.charAt(0).toUpperCase() + plural.slice(1);
    }
    return plural;
  }
  if (/y$/i.test(raw) && !/[aeiou]y$/i.test(raw)) return `${raw.slice(0, -1)}ies`;
  if (/s$/i.test(raw)) return raw;
  return `${raw}s`;
}

function campaignDays(row: ExecutiveSummaryRow): number {
  if (row.durationDays != null && row.durationDays > 0) return row.durationDays;
  return toCampaignDays(row.duration, row.durationUnit) ?? 30;
}

function fmtBreakdownInr(n: number): string {
  return formatUnitRateInr(n);
}

/** "A, B & C" for prose titles. */
function formatComponentTitleList(labels: string[]): string {
  if (labels.length === 0) return 'One-time charges';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

/**
 * One-time formula using actual component names when they match the unit rate.
 * Prefers item-stored oneTimeComponents (after per-part edits).
 */
function buildOneTimeFormula(
  unitRate: number,
  qty: number,
  unitForFormula: string,
  pricing: Record<string, unknown> | undefined,
  storedComponents?: { label: string; amount: number }[],
): {
  titlePrefix: string;
  formula: string;
  components?: { label: string; amount: number }[];
} {
  const fromStore =
    storedComponents && storedComponents.length > 0
      ? storedComponents.filter((c) => c.amount > 0 && c.label.trim())
      : [];
  const fromDb = listOneTimeAddOnComponents(pricing);
  const components = fromStore.length > 0 ? fromStore : fromDb;
  const componentSum = components.reduce((s, c) => s + c.amount, 0);
  const matchesRate =
    components.length > 0 &&
    Number.isFinite(unitRate) &&
    Math.abs(componentSum - unitRate) < 0.02;

  if (matchesRate) {
    const formula =
      components.map((c) => `${fmtBreakdownInr(c.amount)} (${c.label})`).join(' + ') +
      ` × ${qty} (${unitForFormula})`;
    return {
      titlePrefix: formatComponentTitleList(components.map((c) => c.label)),
      formula,
      components,
    };
  }

  return {
    titlePrefix: 'Printing & Mounting',
    formula: `${fmtBreakdownInr(unitRate)} (per qty) × ${qty} (${unitForFormula})`,
  };
}

/**
 * Build DESCRIPTION / AMOUNT lines for a service Pricing Breakdown section.
 * Amounts come from stored item totals so they match the quote.
 */
export function buildPricingBreakdownLines(items: QuoteItem[]): {
  lines: PricingBreakdownLine[];
  subtotal: number;
} {
  const visible = items.filter((i) => i.rate !== 0 || i.total !== 0);
  const groups = new Map<string, QuoteItem[]>();

  for (const item of visible) {
    const key = executiveSummaryGroupKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const lines: PricingBreakdownLine[] = [];
  let subtotal = 0;

  for (const group of groups.values()) {
    const primary = group.find((i) => !isOneTimeLineDescription(i.description)) || group[0];
    const row = buildExecutiveSummaryRows(group)[0];
    if (!row) continue;

    const qty = row.quantity;
    const unitPlural = pluralizeQtyUnit(row.quantityUnit ?? primary.quantityUnit, qty);
    const unitSingular = singularQtyUnit(row.quantityUnit ?? primary.quantityUnit);
    const unitForFormula = qty === 1 ? unitSingular : unitPlural;
    const days = campaignDays(row);

    const displayItem = group.find((i) => !isOneTimeLineDescription(i.description));
    const pfItem = group.find((i) => isOneTimeLineDescription(i.description));

    if (displayItem && (displayItem.rate > 0 || displayItem.total > 0)) {
      const rate = displayItem.rate > 0 ? displayItem.rate : (row.dailyRate ?? row.requiringCharge);
      const perDay = toDailyRate(rate, displayItem.durationUnit);
      const asMonths = shouldDisplayAsMonths(days);

      let prose: string;
      let formula: string;
      const displayAmount = computeQuoteItemTotal(displayItem);
      if (asMonths) {
        const months = days / DAYS_PER_MONTH;
        const perMonth = toDisplayRecurringRate(perDay, days).rate;
        const monthLabel = months === 1 ? 'month' : 'months';
        prose = `Display rental for ${qty} ${unitPlural} for ${months} ${monthLabel}.`;
        formula = `${fmtBreakdownInr(perMonth)} (per month per ${unitSingular}) × ${qty} (${unitForFormula}) × ${months} (${monthLabel})`;
      } else {
        prose = `Display rental for ${qty} ${unitPlural} for ${days} days.`;
        formula = `${fmtBreakdownInr(perDay)} (per day per ${unitSingular}) × ${qty} (${unitForFormula}) × ${days} (days)`;
      }

      lines.push({
        kind: 'display',
        descriptionLines: [prose, formula],
        amount: displayAmount,
        editRow: row,
        formulaQtyUnit: unitForFormula,
      });
      subtotal += displayAmount;
    }

    if (pfItem && (pfItem.rate > 0 || pfItem.total > 0)) {
      const unitRate = pfItem.rate > 0 ? pfItem.rate : row.oneTimeCharge;
      const oneTimeQty = row.oneTimeQuantity ?? qty;
      const svc = resolveDbServiceForQuoteItem({
        serviceId: row.catalogServiceId || primary.serviceId || pfItem.serviceId,
        serviceName: primary.serviceName || pfItem.serviceName,
        description: pfItem.description || primary.description,
        city: primary.city || pfItem.city,
      });
      const pricing = (svc?.metadata?.pricing || undefined) as Record<string, unknown> | undefined;
      const { titlePrefix, formula, components } = buildOneTimeFormula(
        unitRate,
        row.oneTimeQuantity,
        unitForFormula,
        pricing,
        pfItem.oneTimeComponents,
      );

      lines.push({
        kind: 'onetime',
        descriptionLines: [
          `${titlePrefix} for ${oneTimeQty} ${pluralizeQtyUnit(row.quantityUnit ?? primary.quantityUnit, oneTimeQty)}`,
          formula,
        ],
        amount: computeQuoteItemTotal(pfItem),
        editRow: row,
        formulaQtyUnit: unitForFormula,
        oneTimeComponents: components,
      });
      subtotal += computeQuoteItemTotal(pfItem);
    }
  }

  lines.push({
    kind: 'subtotal',
    descriptionLines: ['Amount excluding GST'],
    amount: subtotal,
  });

  return { lines, subtotal };
}

/**
 * Default general terms and conditions to show on summary page for multi-service quotes
 */
export const DEFAULT_GENERAL_TERMS = [
  'Prices are exclusive of GST',
  'Ad material shall be provided by the client. Otherwise, design charges will be applicable.',
  '100% upfront payment is required before releasing the ads.',
  'Printed colors may differ from the digital design.',
  'The client must approve the final design before printing. Once approved, Baleen Media will not be responsible for any design errors.',
  'If the client stops the campaign during the campaign period, no refund will be provided.',
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

  items.forEach((item) => {
    const key = getQuoteItemGroupKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  });

  return Array.from(groups.values()).map((groupItems) => ({
    serviceType: extractServiceType(groupItems[0].description),
    city: groupItems[0].city?.trim() && groupItems[0].city !== '—'
      ? groupItems[0].city
      : undefined,
    items: groupItems,
    subtotal: groupItems.reduce((sum, item) => sum + computeQuoteItemTotal(item), 0),
    termsAndConditions: groupItems[0]?.termsAndConditions,
  }));
}

/**
 * Check if quote has multiple service types
 */
export function isMultiServiceQuote(items: QuoteItem[]): boolean {
  const keys = new Set(items.map(getQuoteItemGroupKey));
  return keys.size > 1;
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
 * Order: Medium · Type · City · Area · Direction — deduped, ALL CAPS.
 */
export function getServiceGroupHeading(group: ServiceGroup): string {
  const primary = group.items.find((i) => !isOneTimeLineDescription(i.description)) || group.items[0];
  const raw =
    (primary?.serviceName || '').trim()
    || extractServiceType(primary?.description || group.serviceType || '');
  const withCity =
    group.city?.trim() && group.city !== '—'
    && !canonicalizeServiceName(raw).includes(canonicalizeServiceName(group.city))
      ? `${raw} · ${group.city}`
      : raw;
  return formatServiceHeadingDisplay(withCity);
}
