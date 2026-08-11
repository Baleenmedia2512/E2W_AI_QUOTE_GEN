import { QuoteItem } from '../types/quote';
import {
  DEFAULT_GENERAL_TERMS,
  extractServiceType,
  normalizeTermsList,
} from './quoteGrouping';
import { KNOWN_CITY_LIST } from './serviceNameUtils';

/** One T&C line for display / merge — labels empty = general. */
export interface DisplayTerm {
  text: string;
  labels: string[];
}

/** Multi-word media mediums (first words of service names). Longer phrases first. */
const MULTI_WORD_MEDIUMS = [
  'no parking boards',
  'no parking board',
  'no parking',
  'police booth',
  'bus shelter',
  'bus stand',
  'metro station',
  'metro train',
  'mobile van',
  'pole kiosk',
  'train wrap',
  'train inside',
  'bus semi',
  'bus full',
  'auto semi',
  'auto full',
  'apartment lobby',
  'apartment lift',
  'lamp post',
  'led hoarding',
] as const;

function titleCaseWords(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === 'led' || lower === 'lcd' || lower === 'oled') return lower.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function detectCityInLabel(label: string, cityHint?: string): string {
  const hint = (cityHint || '').trim();
  if (hint && hint !== '—') return titleCaseWords(hint);
  const lower = label.toLowerCase();
  for (const c of KNOWN_CITY_LIST) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(lower)) return titleCaseWords(c);
  }
  return '';
}

/** Strip site/type tails that shouldn't appear in the short T&C red prefix. */
function stripTermsMediumNoise(medium: string): string {
  return medium
    .replace(/\b(fixing|printing|mounting)(\s+alone)?\b/gi, ' ')
    .replace(/\b(display|rental)\s+price\b/gi, ' ')
    .replace(/\s*[—–\-]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Short T&C heading: "No Parking Boards Fixing Alone - Chennai" → "No Parking Boards Chennai".
 * Medium + city is enough; drop direction / site / fixing-alone tails.
 */
export function shortenTermsHeadingLabel(
  label: string,
  cityHint?: string,
): string {
  const raw = (label || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Service';

  const city = detectCityInLabel(raw, cityHint);

  // Prefer first structured segment (Medium · Type · City · …)
  const segments = raw
    .split(/\s*[·|]\s*|\s*[—–]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  let mediumSource = segments[0] || raw;

  if (city) {
    mediumSource = mediumSource
      .replace(new RegExp(`\\s+[—–\\-]?\\s*${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
      .trim();
  }

  const words = mediumSource.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return city || 'Service';
  }

  // Already short catalog-style name (≤3 words): keep, append city if needed
  if (words.length <= 3) {
    let base = normalizeTermsServiceLabel(titleCaseWords(words.join(' ')));
    base = stripTermsMediumNoise(base) || base;
    // Re-resolve multi-word after noise strip
    const toks = base.split(/\s+/).filter(Boolean);
    const resolved =
      resolveMultiWordMedium(toks.map((w) => w.toLowerCase()), toks) || base;
    if (city && !resolved.toLowerCase().includes(city.toLowerCase())) {
      return `${resolved} ${city}`;
    }
    return resolved;
  }

  const resolved =
    resolveMultiWordMedium(words.map((w) => w.toLowerCase()), words)
    || stripTermsMediumNoise(titleCaseWords(words.slice(0, 3).join(' ')))
    || titleCaseWords(words[0]);

  let medium = normalizeTermsServiceLabel(resolved);
  medium = stripTermsMediumNoise(medium) || medium;

  // Cap stray long mediums — but keep known 3-word phrases (No Parking Boards)
  const mw = medium.split(/\s+/).filter(Boolean);
  if (mw.length > 3) {
    const again = resolveMultiWordMedium(mw.map((w) => w.toLowerCase()), mw);
    medium = again || mw.slice(0, 3).join(' ');
  }

  if (city && !medium.toLowerCase().includes(city.toLowerCase())) {
    return `${medium} ${city}`;
  }
  return medium;
}

/** Match MULTI_WORD_MEDIUMS against leading tokens; return title-cased phrase. */
function resolveMultiWordMedium(
  lower: string[],
  originalWords?: string[],
): string | null {
  const src = originalWords || lower;
  for (const prefix of MULTI_WORD_MEDIUMS) {
    const parts = prefix.split(' ');
    if (
      lower.length >= parts.length
      && parts.every((p, i) => lower[i] === p)
    ) {
      return titleCaseWords(src.slice(0, parts.length).join(' '));
    }
  }
  return null;
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
 * T&C bold prefix label for a quote item — medium + city (short).
 */
export function termsLabelFromItem(
  item: Pick<QuoteItem, 'description' | 'title' | 'serviceName' | 'city'>,
): string {
  const cityHint = item.city?.trim() && item.city !== '—' ? item.city : undefined;
  const fromName = item.serviceName?.trim();
  if (fromName) return shortenTermsHeadingLabel(fromName, cityHint);
  return shortenTermsHeadingLabel(
    extractServiceType(item.description || item.title || 'Service'),
    cityHint,
  );
}

/**
 * @deprecated Prefer {@link normalizeTermsServiceLabel} / {@link termsLabelFromItem}.
 * Kept for callers that still pass a raw service-type string.
 */
export function shortServiceLabel(serviceType: string): string {
  return shortenTermsHeadingLabel(serviceType);
}

/** "Hoarding Chennai" | "Police Booth Chennai & Madurai" — always shortened. */
export function formatServiceLabelPrefix(labels: string[]): string {
  const unique = dedupeLabels(
    labels.map((l) => shortenTermsHeadingLabel(l)),
  );
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

  // First ": " / ":" + whitespace separates service label(s) from term body.
  // Multi-location merges can make the prefix thousands of chars — do not cap length tightly.
  const colonMatch = cleaned.match(/^(.{2,}?):\s+(.+)$/);
  if (colonMatch) {
    const prefix = colonMatch[1].trim();
    const rest = colonMatch[2].trim();
    if (
      rest &&
      prefix.length >= 2 &&
      !/[.!?]/.test(prefix) &&
      !/^\d/.test(prefix) &&
      /[A-Za-z]/.test(prefix)
    ) {
      // Require spaces around "&" so "T&C" is not split into "T" + "C".
      const labels = prefix
        .split(/\s*,\s*|\s+&\s+|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((l) => l.replace(/\s+/g, ' '));
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
        return normalizeGeneralTcLabel({ text: rest, labels: dedupeLabels(labels) });
      }
    }
  }

  // Legacy: trailing "(Apartment Lift)" / "(A and B)"
  const parenMatch = cleaned.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const text = parenMatch[1].trim();
    const inside = parenMatch[2].trim();
    const labels = inside
      .split(/\s*,\s*|\s+&\s+|\s+and\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      text &&
      labels.length >= 1 &&
      labels.every((l) => l.length <= 300 && !/[.!?]/.test(l))
    ) {
      return normalizeGeneralTcLabel({ text, labels: dedupeLabels(labels) });
    }
  }

  return { text: cleaned, labels: [] };
}

/** "General T&C" attribution is the general section — not a service label. */
function normalizeGeneralTcLabel(term: DisplayTerm): DisplayTerm {
  if (
    term.labels.length === 1 &&
    /^general\s*t\s*&?\s*c$/i.test(term.labels[0].replace(/\s+/g, ' ').trim())
  ) {
    return { text: term.text, labels: [] };
  }
  return term;
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
 * Ops / schedule lines that share one bullet per service:
 * Lead time + Campaign report + Coverage + Timing.
 */
export function isOpsScheduleTerm(text: string): boolean {
  const t = stripTermDecorations(text).replace(/\.+$/, '').trim();
  if (!t) return false;
  if (/^timing\s*:/i.test(t)) return true;
  if (/^coverage\s*:/i.test(t)) return true;
  if (/^lead\s*time\b/i.test(t)) return true;
  if (/^campaign\s+report\b/i.test(t)) return true;
  return false;
}

/**
 * Topic openers that must stay as their own bullet (not appended to previous).
 * Lead time / Campaign report / Coverage / Timing are handled by ops-schedule merge.
 */
const STANDALONE_TERM_OPENER =
  /^(need\s+to|prior\s+notice|branding\s+will|the\s+client|client\s+must|baleen\s+media\s+will|sites?\s+once|board\s+placement|autos?\s+operate|cabs?\s+operate|one\s+representative|if\s+the\s+client|if\s+there\s+is|if\s+any|any\s+extensions?|all\s+(campaigns|display)|route\s+commitment|the\s+branding|the\s+above\s+cost|rates?\s+are|login\s+report|in\s+case\s+of)\b/i;

/**
 * Short add-on / follow-up lines → append to the previous bullet (joined with ". ").
 * Applies to every service, not only "Re Printing…".
 * Keeps real topic openers as separate points.
 */
export function isContinuationTerm(text: string): boolean {
  const t = stripTermDecorations(text).replace(/\.+$/, '').trim();
  if (!t) return false;

  // Ops schedule lines merge together separately
  if (isOpsScheduleTerm(t)) return false;
  if (STANDALONE_TERM_OPENER.test(t)) return false;

  const words = t.split(/\s+/).filter(Boolean);
  // Explicit charge / re-work add-ons (any length within reason)
  if (/^re[\s-]?(print|mount|fix)/i.test(t)) return true;
  if (/\bcharges?\s+will\s+be\s+extra\b/i.test(t)) return true;
  if (/^will\s+be\s+extra\b/i.test(t)) return true;
  if (/\b(re-?printing|re-?mounting|re-?fixing)\b/i.test(t) && words.length <= 16) {
    return true;
  }

  // Short follow-up sentences (all services) → fold into previous point
  if (words.length > 0 && words.length <= 12) return true;

  return false;
}

function ensureTermPeriod(text: string): string {
  const t = text.replace(/\.+$/, '').trim();
  return t ? `${t}.` : '';
}

function appendTermWithPeriod(base: string, addition: string): string {
  const left = base.replace(/\.+$/, '').trim();
  const right = addition.replace(/\.+$/, '').trim();
  if (!left) return ensureTermPeriod(right);
  if (!right) return ensureTermPeriod(left);
  return `${left}. ${right}.`;
}

/** Build one Lead time / Campaign report / Coverage / Timing bullet. */
function buildOpsScheduleBullet(
  opsTexts: string[],
  timingValues: string[],
): string | null {
  const parts: string[] = [];
  for (const raw of opsTexts) {
    const text = stripTermDecorations(raw).replace(/\.+$/, '').trim();
    if (!text) continue;
    if (/^timing\s*:/i.test(text)) continue; // handled via timingValues
    parts.push(text);
  }
  if (timingValues.length > 0) {
    parts.push(`Timing: ${timingValues.join('. ')}`);
  }
  if (parts.length === 0) return null;
  const joined = parts.join('. ');
  return joined.endsWith('.') ? joined : `${joined}.`;
}

/**
 * Join service-specific term bodies for one label.
 * Ops schedule lines + Timing values share one bullet; wording preserved.
 */
export function mergeTermBodies(texts: string[]): string {
  const parts: string[] = [];
  const opsTexts: string[] = [];
  const timingValues: string[] = [];

  for (const raw of texts) {
    const text = stripTermDecorations(raw).replace(/\.+$/, '').trim();
    if (!text) continue;
    const timing = text.match(/^timing:\s*(.+)$/i);
    if (timing) {
      const value = timing[1].replace(/\.+$/, '').trim();
      if (value) timingValues.push(value);
      continue;
    }
    if (isOpsScheduleTerm(text)) {
      opsTexts.push(text);
      continue;
    }
    if (isContinuationTerm(text) && parts.length > 0) {
      parts[parts.length - 1] = appendTermWithPeriod(parts[parts.length - 1], text);
      continue;
    }
    parts.push(text);
  }

  const opsBullet = buildOpsScheduleBullet(opsTexts, timingValues);
  const all = opsBullet ? [opsBullet.replace(/\.+$/, ''), ...parts] : parts;
  if (all.length === 0) return '';
  const joined = all.join('. ');
  return joined.endsWith('.') ? joined : `${joined}.`;
}

/**
 * Within each service label group:
 * - Merge Lead time + Campaign report + Coverage + Timing into one bullet
 * - Append short continuation lines (e.g. Re Printing…) to the previous bullet
 * - Keep other service lines as separate points
 * General T&C lines are unchanged.
 */
export function collapseSameLabelDisplayTerms(terms: DisplayTerm[]): DisplayTerm[] {
  const general: DisplayTerm[] = [];
  const keyed = new Map<string, { labels: string[]; texts: string[] }>();
  const keyOrder: string[] = [];

  for (const term of terms) {
    if (term.labels.length === 0) {
      general.push(term);
      continue;
    }
    const title = formatServiceLabelPrefix(term.labels) || term.labels.join(' & ');
    const key = title.toLowerCase();
    let bucket = keyed.get(key);
    if (!bucket) {
      bucket = { labels: [...term.labels], texts: [] };
      keyed.set(key, bucket);
      keyOrder.push(key);
    } else {
      bucket.labels = dedupeLabels([...bucket.labels, ...term.labels]);
    }
    if (term.text.trim()) bucket.texts.push(term.text);
  }

  const collapsed: DisplayTerm[] = [];
  for (const key of keyOrder) {
    const bucket = keyed.get(key)!;
    const parts: string[] = [];
    const opsTexts: string[] = [];
    const timingValues: string[] = [];
    let opsInserted = false;

    const flushOps = () => {
      if (opsInserted) return;
      const opsBullet = buildOpsScheduleBullet(opsTexts, timingValues);
      if (opsBullet) {
        parts.push(opsBullet);
        opsInserted = true;
      }
    };

    for (const raw of bucket.texts) {
      const text = stripTermDecorations(raw).replace(/\.+$/, '').trim();
      if (!text) continue;
      const timing = text.match(/^timing:\s*(.+)$/i);
      if (timing) {
        const value = timing[1].replace(/\.+$/, '').trim();
        if (value) timingValues.push(value);
        continue;
      }
      if (isOpsScheduleTerm(text)) {
        opsTexts.push(text);
        continue;
      }
      // Non-ops line: flush collected ops first (keeps Lead time block before other T&Cs)
      flushOps();
      if (isContinuationTerm(text) && parts.length > 0) {
        parts[parts.length - 1] = appendTermWithPeriod(parts[parts.length - 1], text);
        continue;
      }
      parts.push(ensureTermPeriod(text));
    }
    flushOps();

    for (const text of parts) {
      collapsed.push({ text, labels: bucket.labels });
    }
  }

  return [...general, ...collapsed];
}

/**
 * Collapse every service-labeled line for the same service into one bullet
 * (campaign / coverage / timing / lead time, etc.). Timing: values still share
 * one "Timing:" key. Used when product wants a single service point.
 */
export function collapseAllServiceTermsToOne(terms: DisplayTerm[]): DisplayTerm[] {
  const general = terms.filter((t) => t.labels.length === 0);
  const keyed = new Map<string, { labels: string[]; texts: string[] }>();
  const keyOrder: string[] = [];

  for (const term of terms) {
    if (term.labels.length === 0) continue;
    const title = formatServiceLabelPrefix(term.labels) || term.labels.join(' & ');
    const key = title.toLowerCase();
    let bucket = keyed.get(key);
    if (!bucket) {
      bucket = { labels: [...term.labels], texts: [] };
      keyed.set(key, bucket);
      keyOrder.push(key);
    } else {
      bucket.labels = dedupeLabels([...bucket.labels, ...term.labels]);
    }
    if (term.text.trim()) bucket.texts.push(term.text);
  }

  const collapsed = keyOrder
    .map((key) => {
      const bucket = keyed.get(key)!;
      const text = mergeTermBodies(bucket.texts);
      if (!text) return null;
      return { text, labels: bucket.labels } as DisplayTerm;
    })
    .filter((t): t is DisplayTerm => Boolean(t));

  return [...general, ...collapsed];
}

/** One T&C section for UI/PDF: heading once, then body-only bullets. */
export interface DisplayTermSection {
  title: string;
  terms: DisplayTerm[];
}

/**
 * Group ordered display terms into sections.
 * Empty labels → "General T&C"; otherwise the service label prefix.
 */
export function groupDisplayTermsBySection(terms: DisplayTerm[]): DisplayTermSection[] {
  const sections: DisplayTermSection[] = [];
  let current: DisplayTermSection | null = null;

  for (const term of terms) {
    const title =
      term.labels.length === 0
        ? 'General T&C'
        : formatServiceLabelPrefix(term.labels) ||
          term.labels.join(' & ') ||
          'Service';
    if (!current || current.title.toLowerCase() !== title.toLowerCase()) {
      current = { title, terms: [] };
      sections.push(current);
    }
    current.terms.push({ ...term, text: term.text });
  }

  return sections.filter((s) => s.terms.length > 0 && s.terms.some((t) => t.text.trim()));
}

/**
 * Resolve structured display terms (ordered, with labels for section headings).
 * Prefers quote-level attributed terms (post-hydration). Merges Timing: lines only.
 */
export function resolveMergedDisplayTermEntries(
  quoteTerms: string | undefined,
  items: QuoteItem[],
  generalTerms: string[] = DEFAULT_GENERAL_TERMS,
): DisplayTerm[] {
  const serviceOrder = collectServiceOrderFromItems(items);
  const itemEntries = collectServiceTermsEntries(items);
  const quoteTrimmed = (quoteTerms || '').trim();

  const parsedFromQuote = quoteTrimmed
    ? normalizeTermsList(quoteTrimmed)
        .map(parseDisplayTermLine)
        .filter((t) => t.text)
    : [];

  const quoteHasAttribution = parsedFromQuote.some((t) => t.labels.length > 0);

  let resolved: DisplayTerm[];

  // Hydrated quotes store service lines on quote.termsAndConditions with labels.
  // Prefer that over sparse/empty per-item terms.
  if (quoteHasAttribution) {
    const generalCovered = generalTerms.every((g) =>
      parsedFromQuote.some((l) => normalizeTermKey(l.text) === normalizeTermKey(g)),
    );
    if (generalCovered) {
      resolved = orderDisplayTerms(expandLegacyTermLabels(parsedFromQuote, items), serviceOrder);
    } else {
      const missingGeneral = generalTerms
        .filter(
          (g) =>
            !parsedFromQuote.some((p) => normalizeTermKey(p.text) === normalizeTermKey(g)),
        )
        .map((text) => ({ text, labels: [] as string[] }));
      resolved = orderDisplayTerms(
        expandLegacyTermLabels([...missingGeneral, ...parsedFromQuote], items),
        serviceOrder,
      );
    }
  } else if (itemEntries.length > 0) {
    resolved = mergeTermsWithServiceTagsEntries(generalTerms, itemEntries);
  } else if (parsedFromQuote.length > 0) {
    const generalCovered = generalTerms.every((g) =>
      parsedFromQuote.some((l) => normalizeTermKey(l.text) === normalizeTermKey(g)),
    );
    if (generalCovered) {
      resolved = orderDisplayTerms(expandLegacyTermLabels(parsedFromQuote, items), serviceOrder);
    } else {
      const label = items[0] ? termsLabelFromItem(items[0]) : 'Service';
      resolved = mergeTermsWithServiceTagsEntries(generalTerms, [
        { label, terms: parsedFromQuote.map((t) => t.text) },
      ]);
    }
  } else {
    resolved = generalTerms.map((text) => ({ text, labels: [] as string[] }));
  }

  // Keep each T&C as its own bullet under the service heading.
  // Only merge Timing: lines (e.g. 3–7pm + 10am–6pm → one Timing point).
  return collapseSameLabelDisplayTerms(resolved);
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
