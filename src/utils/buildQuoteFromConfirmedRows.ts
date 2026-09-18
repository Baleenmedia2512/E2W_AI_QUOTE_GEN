import { Quote, QuoteItem } from '../types/quote';
import {
  ConfirmationRow,
  dedupeConfirmationRows,
} from './cloudQuoteValidation';
import {
  buildLineItemsFromDbPricing,
  hasQuotablePricing,
  pickPreferredDbService,
} from './dbPricingUtils';
import { enrichQuoteItemsDurationFromDb, getServiceScopedUserMessage } from './durationUtils';
import { DEFAULT_GENERAL_TERMS } from './quoteGrouping';
import type { DbService } from './serviceResolver';
import { resolveServiceIdFromCatalog } from './serviceResolver';
import { hydrateQuoteTermsFromCatalog } from './termsHydration';
import { applyVendorPricingForQuoteRow, getVendorRatesCache } from '../services/vendorRateService';

export type BuildQuoteFromDbResult =
  | { success: true; quote: Quote; skipped?: string[] }
  | { success: false; message: string; unresolved: string[] };

function titleCaseCity(city: string): string {
  return city.charAt(0).toUpperCase() + city.slice(1);
}

/** Preserve the catalog's exact city value for quote display. */
function exactDbCity(svc: DbService): string | undefined {
  const raw = String((svc.metadata as { city?: unknown } | undefined)?.city ?? '').trim();
  if (raw && raw.toUpperCase() !== 'NA' && raw !== '—') {
    return raw;
  }
  return undefined;
}

function coordinateKey(meta: Record<string, unknown>): string {
  const nested = (meta.coordinates || meta.coordinate) as Record<string, unknown> | undefined;
  const read = (...keys: string[]): string => {
    for (const key of keys) {
      const value = meta[key] ?? nested?.[key];
      if (value != null && String(value).trim() !== '') return String(value).trim().toLowerCase();
    }
    return '';
  };
  const latitude = read('latitude', 'lat');
  const longitude = read('longitude', 'lng', 'long', 'lon');
  return latitude || longitude ? `${latitude || 'na'},${longitude || 'na'}` : 'na,na';
}

/**
 * Confirmation rows identify catalog records, but several vendor records can
 * represent the same logical quote service. Keep one requested row for each
 * service/city/quantity combination before resolving vendor pricing.
 *
 * Distinct sites (different area / direction) and distinct medium_types
 * (Elevated vs Underground, Frontlit vs Nonlit) stay separate. Vendor
 * duplicates that share medium + type + city with no site identity collapse
 * to one preferred row so the executive summary does not show Fixing twice.
 */
function dedupeLogicalQuoteRows(
  rows: ConfirmationRow[],
  services: DbService[] = [],
): ConfirmationRow[] {
  const byLogical = new Map<string, ConfirmationRow[]>();

  for (const row of rows) {
    const svc = row.serviceId
      ? services.find((s) => s.service_id === row.serviceId)
      : undefined;
    const meta = (svc?.metadata || {}) as Record<string, unknown>;
    const medium = String(meta.medium || row.service || '')
      .toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const cityKey = (row.city && row.city !== '—' ? row.city : '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const qty = typeof row.qty === 'number'
      ? row.qty
      : parseInt(String(row.qty), 10) || 1;
    const area = String(meta.area_name || meta.area || '').trim();
    const direction = String(meta.direction_remarks || '').trim();
    const mediumType = String(meta.medium_type || meta.mediumType || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const typeKey =
      mediumType && mediumType !== 'na' ? mediumType : '';
    const siteParts = [area, direction]
      .filter((v) => v && v.toUpperCase() !== 'NA');
    const siteKey = siteParts
      .map((v) => v.toLowerCase().replace(/\s+/g, ' ').trim())
      .join('|');
    const coordinates = coordinateKey(meta);
    // medium_type is part of product identity (Elevated vs Underground,
    // Frontlit vs Nonlit). Only collapse true vendor twins that share type.
    const key = siteKey
      ? `site:${medium}|${typeKey}|${cityKey}|${siteKey}|${coordinates}|${qty}`
      : `logical:${medium}|${typeKey}|${cityKey}|${coordinates}|${qty}`;
    const list = byLogical.get(key);
    if (list) list.push(row);
    else byLogical.set(key, [row]);
  }

  const out: ConfirmationRow[] = [];
  for (const group of byLogical.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    // Prefer the preferred/quotable catalog row when several vendor ids share
    // the same logical medium + city with no site distinction.
    const candidates = group
      .map((row) => ({
        row,
        svc: row.serviceId
          ? services.find((s) => s.service_id === row.serviceId)
          : undefined,
      }))
      .filter((x): x is { row: ConfirmationRow; svc: DbService } => !!x.svc);
    if (candidates.length) {
      const preferred = pickPreferredDbService(candidates.map((c) => c.svc));
      const match = preferred
        ? candidates.find((c) => c.svc.service_id === preferred.service_id)
        : candidates[0];
      out.push(match?.row || group[0]);
    } else {
      out.push(group[0]);
    }
  }
  return out;
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
  const uniqueRows = dedupeLogicalQuoteRows(dedupeConfirmationRows(rows), services);
  const unresolved: string[] = [];
  const allItems: QuoteItem[] = [];
  const vendorRates = getVendorRatesCache();

  for (let i = 0; i < uniqueRows.length; i++) {
    const row = uniqueRows[i];
    const qty =
      typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
    const cityHint = row.city && row.city !== '—' ? row.city : null;
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

    const cityLabel = exactDbCity(baseSvc)
      || (cityHint ? titleCaseCity(cityHint) : undefined);

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

  // Partial success: quote everything with rates; only fail when nothing is quotable.
  if (allItems.length === 0) {
    return {
      success: false,
      message: unresolved.length
        ? `Could not resolve pricing for: ${unresolved.join('; ')}`
        : 'No services could be resolved from your selection.',
      unresolved,
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

  return {
    success: true,
    quote,
    skipped: unresolved.length ? unresolved : undefined,
  };
}
