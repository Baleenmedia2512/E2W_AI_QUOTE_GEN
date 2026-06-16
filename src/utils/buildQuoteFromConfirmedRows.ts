import { Quote, QuoteItem } from '../types/quote';
import {
  ConfirmationRow,
  dedupeConfirmationRows,
  getMinQuantityFromDbService,
} from './cloudQuoteValidation';
import {
  DbMetadataLike,
  enrichQuoteItemsDurationFromDb,
  resolveQuoteLineDuration,
} from './durationUtils';
import { DEFAULT_GENERAL_TERMS } from './quoteGrouping';
import { DbService, resolveServiceIdFromCatalog } from './serviceResolver';
import { hydrateQuoteTermsFromCatalog } from './termsHydration';

interface DbPricing {
  structure?: string;
  display_price?: number;
  production_price?: number;
  display_period?: string;
  production_unit?: string;
  unit_price?: number;
  price?: number;
  combined_price?: number;
  total_price?: number;
  period?: string;
  min_quantity?: number;
  unit?: string;
}

export type BuildQuoteFromDbResult =
  | { success: true; quote: Quote }
  | { success: false; message: string; unresolved: string[] };

function readNumber(...values: unknown[]): number {
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function buildLineItemsFromDbService(
  svc: DbService,
  quantity: number,
  userMessage: string,
  sectionIndex: number,
): QuoteItem[] {
  const m = svc.metadata || {};
  const pricing = (m.pricing || {}) as DbPricing;
  const serviceName = svc.service_name;
  const meta = m as DbMetadataLike;
  const minQty = getMinQuantityFromDbService(svc) ?? undefined;
  const items: QuoteItem[] = [];
  let lineIndex = 0;

  const mkId = () => `${sectionIndex}-${lineIndex++}`;

  const addLine = (description: string, rate: number, qty: number, isRecurring: boolean) => {
    const resolved = resolveQuoteLineDuration({ description }, userMessage, meta);
    const mult = isRecurring ? resolved.multiplier : 1;
    items.push({
      id: mkId(),
      title: serviceName,
      description,
      serviceId: svc.service_id,
      serviceName,
      quantity: qty,
      rate,
      duration: isRecurring ? resolved.duration : undefined,
      durationUnit: isRecurring ? resolved.durationUnit : undefined,
      durationIsAuto: isRecurring ? resolved.isAutoFromDb : undefined,
      total: qty * rate * mult,
      minimumQuantity: minQty,
    });
  };

  if (pricing.structure === 'separate' || (pricing.display_price && pricing.production_price)) {
    const displayPeriod = pricing.display_period || pricing.period || 'per month';
    addLine(
      `${serviceName} - Display Price (${displayPeriod})`,
      readNumber(pricing.display_price),
      quantity,
      true,
    );
    const prodUnit = pricing.production_unit || 'per unit';
    addLine(
      `${serviceName} - Printing & Fixing Price (${prodUnit})`,
      readNumber(pricing.production_price),
      quantity,
      false,
    );
    return items;
  }

  if (pricing.structure === 'campaign' || (pricing.unit_price && pricing.min_quantity)) {
    const unitPrice = readNumber(pricing.unit_price, (m as { unit_price?: number }).unit_price);
    const period = pricing.period || String((m as { duration?: string }).duration || '').trim();
    addLine(
      `${serviceName} - Unit Price${period ? ` (${period})` : ''}`,
      unitPrice,
      quantity,
      true,
    );
    return items;
  }

  const price = readNumber(
    pricing.price,
    pricing.unit_price,
    pricing.combined_price,
    pricing.total_price,
    (m as { unit_price?: number }).unit_price,
  );
  const period =
    pricing.period ||
    pricing.display_period ||
    String((m as { duration?: string }).duration || '').trim() ||
    'per month';
  addLine(`${serviceName} - Rental Price (${period})`, price, quantity, true);
  return items;
}

/**
 * Build a complete Quote from confirm-table rows using proposal_chunks DB metadata.
 * No Gemini — service_id, pricing, and terms come from the catalog.
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

    const lineItems = buildLineItemsFromDbService(
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

    allItems.push(...lineItems);
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
  const quoteItems = hydrated.items;

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
