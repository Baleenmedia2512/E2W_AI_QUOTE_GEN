import { QuoteItem } from '../types/quote';
import { DEFAULT_GENERAL_TERMS, normalizeTermsList } from './quoteGrouping';
import {
  formatMergedTermsAsBullets,
  mergeTermsWithServiceTags,
  termsLabelFromItem,
  type ServiceTermsEntry,
} from './termsMerge';

export interface DbServiceRecord {
  service_id: string;
  service_name?: string;
  metadata?: {
    terms?: string;
    terms_and_conditions?: string;
    [key: string]: unknown;
  };
}

export {
  buildMergedTermsAndConditions,
  formatServiceAttribution,
  formatServiceLabelPrefix,
  mergeTermsWithServiceTags,
  normalizeTermKey,
  normalizeTermsServiceLabel,
  resolveMergedDisplayTerms,
  resolveMergedDisplayTermEntries,
  shortServiceLabel,
  termsLabelFromItem,
} from './termsMerge';

/** Detect Gemini rate-card footnotes masquerading as T&C */
export function isRateCardFootnoteText(terms: string): boolean {
  if (!terms?.trim()) return false;
  const lower = terms.toLowerCase();
  return (
    terms.includes('மூக்க்கம்கககம்க்') ||
    terms.includes('சர்வீஸ்') ||
    lower.includes('no explicit general terms') ||
    lower.includes('no classified display ad') ||
    lower.includes('srilanka edition') ||
    lower.includes('rate card')
  );
}

/**
 * Convert proposal_chunks metadata.terms to bulleted newline format for preview/PDF.
 * DB stores: "Point A. Point B. Point C" or pre-formatted bullet lines.
 */
export function formatMetadataTerms(raw: string | undefined | null): string {
  if (!raw?.trim()) return '';

  const trimmed = raw.trim();

  if (trimmed.includes('\n')) {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => (/^[•\-\*]/.test(line) ? line : `• ${line.replace(/^[•\-\*]\s*/, '')}`))
      .join('\n');
  }

  const parts = trimmed
    .split(/\.\s+(?=[A-Z(]|$)/)
    .map((p) => p.trim())
    .filter(Boolean);

  return parts
    .map((part) => {
      const text = part.endsWith('.') ? part : `${part}.`;
      return `• ${text.replace(/^•\s*/, '')}`;
    })
    .join('\n');
}

function readRawTermsFromService(svc: DbServiceRecord): string | null {
  const raw = svc.metadata?.terms || svc.metadata?.terms_and_conditions;
  return raw?.trim() ? raw.trim() : null;
}

/** Look up formatted T&C for a proposal_chunks.service_id */
export function lookupTermsByServiceId(
  serviceId: string,
  services: DbServiceRecord[],
): string | null {
  const svc = services.find((s) => s.service_id === serviceId);
  if (!svc) {
    console.warn(`⚠️ [T&C-Hydrate] service_id not found in DB: "${serviceId}"`);
    return null;
  }
  console.log(`📋 [T&C-Hydrate] Found service "${serviceId}" | metadata.terms preview: "${String(svc.metadata?.terms || '').slice(0, 80)}"`);

  const raw = readRawTermsFromService(svc);
  return raw ? formatMetadataTerms(raw) : null;
}

export interface HydratedQuoteTerms {
  items: QuoteItem[];
  termsAndConditions: string;
  hydratedFromDb: boolean;
}

/**
 * Replace Gemini-extracted T&C with proposal_chunks.metadata.terms (source of truth).
 * Always produces ONE merged list: DEFAULT_GENERAL_TERMS + unique service extras
 * tagged with service name(s), e.g. "Minimum 10 units (Bus and Auto)".
 * Per-item termsAndConditions are cleared.
 */
export function hydrateQuoteTermsFromCatalog(
  items: QuoteItem[],
  topLevelTerms: string,
  dbServices: DbServiceRecord[],
): HydratedQuoteTerms {
  if (!dbServices.length) {
    return { items, termsAndConditions: topLevelTerms, hydratedFromDb: false };
  }

  const uniqueServiceIds = [
    ...new Set(items.map((i) => i.serviceId).filter(Boolean)),
  ] as string[];

  if (uniqueServiceIds.length === 0) {
    return { items, termsAndConditions: topLevelTerms, hydratedFromDb: false };
  }

  const termsByServiceId = new Map<string, string>();
  for (const serviceId of uniqueServiceIds) {
    const formatted = lookupTermsByServiceId(serviceId, dbServices);
    if (formatted) termsByServiceId.set(serviceId, formatted);
  }

  if (termsByServiceId.size === 0) {
    return { items, termsAndConditions: topLevelTerms, hydratedFromDb: false };
  }

  console.log(
    `📋 [T&C-Hydrate] Loaded DB terms for ${termsByServiceId.size}/${uniqueServiceIds.length} service(s)`,
  );

  const entries: ServiceTermsEntry[] = [];
  const seenServiceIds = new Set<string>();

  for (const item of items) {
    if (!item.serviceId || !termsByServiceId.has(item.serviceId)) continue;
    if (seenServiceIds.has(item.serviceId)) continue;
    seenServiceIds.add(item.serviceId);

    const raw = termsByServiceId.get(item.serviceId)!;
    const terms = normalizeTermsList(raw);
    if (terms.length === 0) continue;

    entries.push({
      label: termsLabelFromItem(item),
      terms,
    });
  }

  const merged = mergeTermsWithServiceTags([...DEFAULT_GENERAL_TERMS], entries);

  console.log(
    `📋 [T&C-Hydrate] Merged ${merged.length} term(s) from ${entries.length} service(s)`,
  );

  return {
    items: items.map((item) => ({ ...item, termsAndConditions: undefined })),
    termsAndConditions: formatMergedTermsAsBullets(merged),
    hydratedFromDb: true,
  };
}
