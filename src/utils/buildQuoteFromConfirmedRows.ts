import { Quote, QuoteItem } from '../types/quote';
import {
  ConfirmationRow,
  dedupeConfirmationRows,
} from './cloudQuoteValidation';
import {
  buildLineItemsFromDbPricing,
  hasQuotablePricing,
} from './dbPricingUtils';
import { enrichQuoteItemsDurationFromDb, getServiceScopedUserMessage } from './durationUtils';
import { DEFAULT_GENERAL_TERMS } from './quoteGrouping';
import type { DbService } from './serviceResolver';
import { resolveServiceIdFromCatalog } from './serviceResolver';
import { hydrateQuoteTermsFromCatalog } from './termsHydration';
import { applyVendorPricingForQuoteRow, getVendorRatesCache } from '../services/vendorRateService';

export type BuildQuoteFromDbResult =
  | { success: true; quote: Quote }
  | { success: false; message: string; unresolved: string[] };

function titleCaseCity(city: string): string {
  return city.charAt(0).toUpperCase() + city.slice(1);
}

/**
 * Build a complete Quote from confirm-table rows.
 * Pricing ONLY from vendor_rate_chunks (display_price + printing_and_mounting_price).
 * If vendor pricing is missing → error (proposal_chunks pricing disabled).
 * Qty unit AI runs on Quote Preview only (not here).
 */
export function buildQuoteFromConfirmedRows(
  rows: ConfirmationRow[],
  services: DbService[],
  originalUserInput: string,
): BuildQuoteFromDbResult {
  const uniqueRows = dedupeConfirmationRows(rows);
  const unresolved: string[] = [];
  const allItems: QuoteItem[] = [];
  const vendorRates = getVendorRatesCache();

  for (let i = 0; i < uniqueRows.length; i++) {
    const row = uniqueRows[i];
    const qty =
      typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const cityHint = row.city && row.city !== '—' ? row.city : null;
    const cityLabel = cityHint ? titleCaseCity(cityHint) : undefined;

    let baseSvc: DbService | undefined;
    if (row.serviceId) {
      baseSvc = services.find((s) => s.service_id === row.serviceId);
    }
    if (!baseSvc) {
      const resolved = resolveServiceIdFromCatalog(row.service, services, cityHint);
      if (resolved) {
        baseSvc = services.find((s) => s.service_id === resolved.serviceId);
      }
    }
    if (!baseSvc) {
      unresolved.push(`${row.service} (${row.city})`);
      continue;
    }

    const svc = applyVendorPricingForQuoteRow(
      baseSvc,
      row.service,
      cityHint,
      vendorRates,
    );

    if (!hasQuotablePricing(svc)) {
      unresolved.push(
        `${row.service} (${row.city}) — no pricing in vendor_rate_chunks`,
      );
      continue;
    }

    const scopedUserInput = row.durationDays != null
      ? `${baseSvc.service_name || row.service} ${row.durationDays} days`
      : getServiceScopedUserMessage(
          originalUserInput,
          baseSvc.service_name || row.service,
        );
    console.log('[DurationDebug] quote row scope', {
      service: row.service,
      serviceId: baseSvc.service_id,
      originalUserInput,
      scopedUserInput,
      durationOverrideDays: row.durationDays,
    });
    const lineItems = buildLineItemsFromDbPricing(
      svc,
      qty,
      scopedUserInput,
      i,
    );

    const hasPricing = lineItems.some((item) => item.rate > 0);
    if (!hasPricing) {
      unresolved.push(
        `${row.service} (${row.city}) — no pricing in vendor_rate_chunks`,
      );
      continue;
    }

    const enrichedLineItems = enrichQuoteItemsDurationFromDb(
      lineItems,
      scopedUserInput,
      services,
    );
    for (const line of enrichedLineItems) {
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

  const hydrated = hydrateQuoteTermsFromCatalog(allItems, '', services);
  const quoteItems = hydrated.items.map((item) => ({
    ...item,
    city: item.city || allItems.find((e) => e.id === item.id)?.city,
  }));

  const finalTerms = hydrated.hydratedFromDb
    ? hydrated.termsAndConditions
    : DEFAULT_GENERAL_TERMS.map((t) => `• ${t}`).join('\n');

  const subtotal = quoteItems.reduce((sum, item) => sum + item.total, 0);
  const gstPercentage = 18;
  const gstAmount = subtotal * (gstPercentage / 100);

  const quote: Quote = {
    id: Date.now().toString(),
    quoteNumber: `QT-${Date.now().toString().slice(-6)}`,
    date: new Date().toISOString(),
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
