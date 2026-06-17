import { Quote, QuoteItem } from '../types/quote';
import {
  ConfirmationRow,
  dedupeConfirmationRows,
} from './cloudQuoteValidation';
import {
  buildLineItemsFromDbPricing,
  hasQuotablePricing,
} from './dbPricingUtils';
import { enrichQuoteItemsDurationFromDb } from './durationUtils';
import { DEFAULT_GENERAL_TERMS } from './quoteGrouping';
import { DbService, resolveServiceIdFromCatalog } from './serviceResolver';
import { hydrateQuoteTermsFromCatalog } from './termsHydration';

export type BuildQuoteFromDbResult =
  | { success: true; quote: Quote }
  | { success: false; message: string; unresolved: string[] };

function titleCaseCity(city: string): string {
  return city.charAt(0).toUpperCase() + city.slice(1);
}

/**
 * Build a complete Quote from confirm-table rows using proposal_chunks DB metadata.
 * No Gemini — service_id, pricing, terms, and city come from the catalog.
 */
export function buildQuoteFromConfirmedRows(
  rows: ConfirmationRow[],
  services: DbService[],
  originalUserInput: string,
): BuildQuoteFromDbResult {
  const uniqueRows = dedupeConfirmationRows(rows);
  const unresolved: string[] = [];
  const allItems: QuoteItem[] = [];

  for (let i = 0; i < uniqueRows.length; i++) {
    const row = uniqueRows[i];
    const qty =
      typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const cityHint = row.city && row.city !== '—' ? row.city : null;
    const cityLabel = cityHint ? titleCaseCity(cityHint) : undefined;

    const resolved = resolveServiceIdFromCatalog(row.service, services, cityHint);
    if (!resolved) {
      unresolved.push(`${row.service} (${row.city})`);
      continue;
    }

    const svc = services.find((s) => s.service_id === resolved.serviceId);
    if (!svc) {
      unresolved.push(`${row.service} (${row.city})`);
      continue;
    }

    if (!hasQuotablePricing(svc)) {
      unresolved.push(`${row.service} (${row.city}) — no pricing in DB`);
      continue;
    }

    const lineItems = buildLineItemsFromDbPricing(
      svc,
      qty,
      originalUserInput,
      i,
    );

    const hasPricing = lineItems.some((item) => item.rate > 0);
    if (!hasPricing) {
      unresolved.push(`${row.service} (${row.city}) — no pricing in DB`);
      continue;
    }

    for (const line of lineItems) {
      allItems.push({ ...line, city: cityLabel });
    }
  }

  if (unresolved.length > 0) {
    return {
      success: false,
      message: `Could not resolve pricing for: ${unresolved.join('; ')}`,
      unresolved,
    };
  }

  if (allItems.length === 0) {
    return {
      success: false,
      message: 'No services could be resolved from your selection.',
      unresolved: [],
    };
  }

  const enriched = enrichQuoteItemsDurationFromDb(
    allItems,
    originalUserInput,
    services,
  );
  const hydrated = hydrateQuoteTermsFromCatalog(enriched, '', services);
  const quoteItems = hydrated.items.map((item) => ({
    ...item,
    city: item.city || enriched.find((e) => e.id === item.id)?.city,
  }));

  const finalTerms = hydrated.hydratedFromDb
    ? hydrated.termsAndConditions
    : DEFAULT_GENERAL_TERMS.join('\n');

  const subtotal = quoteItems.reduce((sum, item) => sum + item.total, 0);
  const gstPercentage = 18;
  const gstAmount = subtotal * (gstPercentage / 100);

  const quote: Quote = {
    id: Date.now().toString(),
    quoteNumber: `QT-${Date.now().toString().slice(-6)}`,
    date: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    items: quoteItems,
    subtotal,
    gstEnabled: true,
    gstPercentage,
    gstAmount,
    total: subtotal + gstAmount,
    deliveryTimeline: '7 working days after payment',
    termsAndConditions: finalTerms,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return { success: true, quote };
}
