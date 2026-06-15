import { QuoteItem } from '../types/quote';

export interface DbServiceRecord {
  service_id: string;
  service_name?: string;
  metadata?: {
    terms?: string;
    terms_and_conditions?: string;
    [key: string]: unknown;
  };
}

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
 * - Single service: all terms → top-level, item terms cleared
 * - Multi service: per-service terms → first item of each serviceId group
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

  if (uniqueServiceIds.length === 1) {
    const dbTerms = termsByServiceId.get(uniqueServiceIds[0])!;
    return {
      items: items.map((item) => ({ ...item, termsAndConditions: undefined })),
      termsAndConditions: dbTerms,
      hydratedFromDb: true,
    };
  }

  const seenServiceIds = new Set<string>();
  const hydratedItems = items.map((item) => {
    if (!item.serviceId || !termsByServiceId.has(item.serviceId)) {
      return item;
    }
    if (seenServiceIds.has(item.serviceId)) {
      return { ...item, termsAndConditions: undefined };
    }
    seenServiceIds.add(item.serviceId);
    return { ...item, termsAndConditions: termsByServiceId.get(item.serviceId) };
  });

  const generalTerms =
    topLevelTerms.trim() && !isRateCardFootnoteText(topLevelTerms)
      ? topLevelTerms
      : '';

  return {
    items: hydratedItems,
    termsAndConditions: generalTerms,
    hydratedFromDb: true,
  };
}
