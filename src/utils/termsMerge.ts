import { QuoteItem } from '../types/quote';
import {
  DEFAULT_GENERAL_TERMS,
  extractServiceType,
  normalizeTermsList,
} from './quoteGrouping';

/** One T&C line for display / merge — labels empty = general. */
export interface DisplayTerm {
  text: string;
  labels: string[];
}

/** Normalize a term for equality checks (ignore bullets, case, trailing punctuation). */
export function normalizeTermKey(term: string): string {
  return term
    .replace(/^[\u2022\u2023\u25aa\u25cf\-\–\*•]\s*/, '')
    .replace(/^\d+[\.\)]\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ');
}

function stripTermDecorations(term: string): string {
  return term
    .replace(/^[\u2022\u2023\u25aa\u25cf\-\–\*•]\s*/, '')
    .replace(/^\d+[\.\)]\s*/, '')
    .trim();
}

function dedupeLabels(labels: string[]): string[] {
  const unique: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    if (!unique.some((u) => u.toLowerCase() === trimmed.toLowerCase())) {
      unique.push(trimmed);
    }
  }
  return unique;
}

/**
 * Normalize a service name for T&C attribution.
 * Keeps specific identity (e.g. "Bus Semi Branding", "Mobile Van Non LED")
 * instead of collapsing to "Bus" / "Van".
 */
export function normalizeTermsServiceLabel(serviceType: string): string {
  const cleaned = serviceType.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Service';
  return cleaned
    .replace(/\bnon[\s-]?led\b/gi, 'Non LED')
    .replace(/\bled\b/gi, 'LED');
}

/**
 * T&C bold prefix label for a quote item — prefers serviceName, else extracted type.
 */
export function termsLabelFromItem(
  item: Pick<QuoteItem, 'description' | 'title' | 'serviceName'>,
): string {
  const fromName = item.serviceName?.trim();
  if (fromName) return normalizeTermsServiceLabel(fromName);
  return normalizeTermsServiceLabel(
    extractServiceType(item.description || item.title || 'Service'),
  );
}

/**
 * @deprecated Prefer {@link normalizeTermsServiceLabel} / {@link termsLabelFromItem}.
 * Kept for callers that still pass a raw service-type string.
 */
export function shortServiceLabel(serviceType: string): string {
  return normalizeTermsServiceLabel(serviceType);
}

/** "Apartment Lift" | "Apartment Lift & Lobby" | "Bus Shelter Demo Anna Nagar". */
export function formatServiceLabelPrefix(labels: string[]): string {
  const unique = dedupeLabels(labels);
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];

  // Many location-specific services sharing one T&C → short medium label for red prefix
  if (unique.length > 2) {
    const common = commonLeadingLabel(unique);
    if (common) return common;
  }

  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')} & ${unique[unique.length - 1]}`;
}

/** Shared leading words across labels, e.g. "Police Booth" from many "Police Booth Chennai …". */
function commonLeadingLabel(labels: string[]): string {
  const splits = labels.map((l) => l.trim().split(/\s+/).filter(Boolean));
  if (splits.length === 0 || splits.some((s) => s.length === 0)) return '';
  const first = splits[0];
  let i = 0;
  while (
    i < first.length &&
    splits.every((s) => (s[i] || '').toLowerCase() === first[i].toLowerCase())
  ) {
    i += 1;
  }
  // Need a real medium phrase (e.g. "Police Booth", "Pole Kiosk"), not only "Police"
  if (i >= 2) return first.slice(0, i).join(' ');
  return '';
}

/** Legacy paren form for parsers: "(Bus)", "(Bus and Auto)". */
export function formatServiceAttribution(labels: string[]): string {
  const unique = dedupeLabels(labels);
  if (unique.length === 0) return '';
  if (unique.length === 1) return `(${unique[0]})`;
  if (unique.length === 2) return `(${unique[0]} and ${unique[1]})`;
  return `(${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]})`;
}

/** Plain string for one display term (storage / textarea). */
export function formatDisplayTermLine(term: DisplayTerm): string {
  const prefix = formatServiceLabelPrefix(term.labels);
  return prefix ? `${prefix}: ${term.text}` : term.text;
}

/**
 * Parse a stored line back into text + service labels.
 * Supports: "Service: text", "A & B: text", and legacy "text (Service)".
 */
export function parseDisplayTermLine(line: string): DisplayTerm {
  const cleaned = stripTermDecorations(line);
  if (!cleaned) return { text: '', labels: [] };

  // First ": " separates service label(s) from term body.
  // Multi-location merges can make the prefix thousands of chars — do not cap length tightly.
  const colonIdx = cleaned.indexOf(': ');
  if (colonIdx > 0 && colonIdx < cleaned.length - 2) {
    const prefix = cleaned.slice(0, colonIdx).trim();
    const rest = cleaned.slice(colonIdx + 2).trim();
    if (
      rest &&
      prefix.length >= 2 &&
      !/[.!?]/.test(prefix) &&
      !/^\d/.test(prefix) &&
      /[A-Za-z]/.test(prefix)
    ) {
      const labels = prefix
        .split(/\s*,\s*|\s*&\s*|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
      // Allow long outdoor location titles; reject only empty / sentence-like pieces
      if (
        labels.length >= 1 &&
        labels.every(
          (l) =>
            l.length >= 2 &&
            l.length <= 300 &&
            !/[.!?]/.test(l) &&
            /[A-Za-z]/.test(l),
        )
      ) {
        return { text: rest, labels: dedupeLabels(labels) };
      }
    }
  }

  // Legacy: trailing "(Apartment Lift)" / "(A and B)"
  const parenMatch = cleaned.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const text = parenMatch[1].trim();
    const inside = parenMatch[2].trim();
    const labels = inside
      .split(/\s*,\s*|\s+and\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      text &&
      labels.length >= 1 &&
      labels.every((l) => l.length <= 300 && !/[.!?]/.test(l))
    ) {
      return { text, labels: dedupeLabels(labels) };
    }
  }

  return { text: cleaned, labels: [] };
}

export interface ServiceTermsEntry {
  label: string;
  terms: string[];
}

/**
 * Order: general → single-service extras (quote service order) → multi-service shared.
 */
export function orderDisplayTerms(
  terms: DisplayTerm[],
  serviceOrder: string[] = [],
): DisplayTerm[] {
  const general = terms.filter((t) => t.labels.length === 0);
  const singles = terms.filter((t) => t.labels.length === 1);
  const multi = terms.filter((t) => t.labels.length > 1);

  const orderedSingles: DisplayTerm[] = [];
  const used = new Set<DisplayTerm>();

  for (const svc of serviceOrder) {
    for (const t of singles) {
      if (used.has(t)) continue;
      if (t.labels[0].toLowerCase() === svc.toLowerCase()) {
        orderedSingles.push(t);
        used.add(t);
      }
    }
  }
  for (const t of singles) {
    if (!used.has(t)) orderedSingles.push(t);
  }

  return [...general, ...orderedSingles, ...multi];
}

/**
 * Merge general T&C with per-service terms into structured entries.
 */
export function mergeTermsWithServiceTagsEntries(
  generalTerms: string[],
  serviceEntries: ServiceTermsEntry[],
): DisplayTerm[] {
  const order: string[] = [];
  const map = new Map<string, DisplayTerm>();
  const serviceOrder: string[] = [];

  for (const g of generalTerms) {
    const text = stripTermDecorations(g);
    const key = normalizeTermKey(text);
    if (!key || map.has(key)) continue;
    map.set(key, { text, labels: [] });
    order.push(key);
  }

  for (const entry of serviceEntries) {
    const label = entry.label.trim();
    if (!label) continue;
    if (!serviceOrder.some((s) => s.toLowerCase() === label.toLowerCase())) {
      serviceOrder.push(label);
    }

    for (const term of entry.terms) {
      const text = stripTermDecorations(term);
      const key = normalizeTermKey(text);
      if (!key) continue;

      const existing = map.get(key);
      if (existing) {
        if (existing.labels.length > 0) {
          if (!existing.labels.some((l) => l.toLowerCase() === label.toLowerCase())) {
            existing.labels.push(label);
          }
        }
        continue;
      }

      map.set(key, { text, labels: [label] });
      order.push(key);
    }
  }

  const unsorted = order.map((key) => map.get(key)!);
  return orderDisplayTerms(unsorted, serviceOrder);
}

/**
 * Merge general T&C with per-service terms (string lines for storage).
 */
export function mergeTermsWithServiceTags(
  generalTerms: string[],
  serviceEntries: ServiceTermsEntry[],
): string[] {
  return mergeTermsWithServiceTagsEntries(generalTerms, serviceEntries).map(formatDisplayTermLine);
}

export function formatMergedTermsAsBullets(terms: string[]): string {
  return terms.map((t) => `• ${t.replace(/^•\s*/, '')}`).join('\n');
}

/**
 * Build service term entries from quote items (first non-empty terms per service group).
 */
export function collectServiceTermsEntries(items: QuoteItem[]): ServiceTermsEntry[] {
  const entries: ServiceTermsEntry[] = [];
  const seenKeys = new Set<string>();

  for (const item of items) {
    const raw = item.termsAndConditions?.trim();
    if (!raw) continue;

    const label = termsLabelFromItem(item);
    const groupKey = (item.serviceId || label).toLowerCase();
    if (seenKeys.has(groupKey)) continue;
    seenKeys.add(groupKey);

    const terms = normalizeTermsList(raw);
    if (terms.length === 0) continue;

    entries.push({ label, terms });
  }

  return entries;
}

/** Service labels in quote item order (for sorting display terms). */
export function collectServiceOrderFromItems(items: QuoteItem[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const label = termsLabelFromItem(item);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    order.push(label);
  }
  return order;
}

/**
 * One merged T&C list: DEFAULT_GENERAL_TERMS + unique service extras with tags.
 */
export function buildMergedTermsAndConditions(
  items: QuoteItem[],
  generalTerms: string[] = DEFAULT_GENERAL_TERMS,
): string {
  const entries = collectServiceTermsEntries(items);
  const merged = mergeTermsWithServiceTags(generalTerms, entries);
  return formatMergedTermsAsBullets(merged);
}

/** Expand legacy short T&C labels ("Bus", "Van") to full item service names. */
function expandLegacyTermLabels(terms: DisplayTerm[], items: QuoteItem[]): DisplayTerm[] {
  const fullLabels = collectServiceOrderFromItems(items);
  if (fullLabels.length === 0) return terms;

  return terms.map((term) => {
    if (term.labels.length === 0) return term;
    const next: string[] = [];
    for (const label of term.labels) {
      const sl = label.toLowerCase();
      const hits = fullLabels.filter((f) => {
        const fl = f.toLowerCase();
        if (fl === sl) return true;
        if (fl.startsWith(`${sl} `)) return true;
        if (fl.includes(` ${sl} `) || fl.endsWith(` ${sl}`)) return true;
        return false;
      });
      if (hits.length > 0) next.push(...hits);
      else next.push(label);
    }
    return { ...term, labels: dedupeLabels(next) };
  });
}

/**
 * Resolve structured display terms (ordered, with labels for bold rendering).
 */
export function resolveMergedDisplayTermEntries(
  quoteTerms: string | undefined,
  items: QuoteItem[],
  generalTerms: string[] = DEFAULT_GENERAL_TERMS,
): DisplayTerm[] {
  const serviceOrder = collectServiceOrderFromItems(items);
  const hasItemTerms = items.some((i) => i.termsAndConditions?.trim());

  if (hasItemTerms) {
    return mergeTermsWithServiceTagsEntries(generalTerms, collectServiceTermsEntries(items));
  }

  if (quoteTerms?.trim()) {
    const lines = normalizeTermsList(quoteTerms);
    const parsed = lines.map(parseDisplayTermLine).filter((t) => t.text);

    const generalCovered = generalTerms.every((g) =>
      parsed.some((l) => normalizeTermKey(l.text) === normalizeTermKey(g)),
    );
    const hasAttribution = parsed.some((t) => t.labels.length > 0);

    if (generalCovered || hasAttribution) {
      return orderDisplayTerms(expandLegacyTermLabels(parsed, items), serviceOrder);
    }

    const label = items[0]
      ? termsLabelFromItem(items[0])
      : 'Service';
    return mergeTermsWithServiceTagsEntries(generalTerms, [{ label, terms: lines }]);
  }

  return generalTerms.map((text) => ({ text, labels: [] as string[] }));
}

/**
 * Resolve display lines for PDF/preview (plain strings).
 */
export function resolveMergedDisplayTerms(
  quoteTerms: string | undefined,
  items: QuoteItem[],
  generalTerms: string[] = DEFAULT_GENERAL_TERMS,
): string[] {
  return resolveMergedDisplayTermEntries(quoteTerms, items, generalTerms).map(formatDisplayTermLine);
}
