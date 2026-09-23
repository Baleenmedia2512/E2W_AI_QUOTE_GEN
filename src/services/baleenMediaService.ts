import { supabase } from './supabaseClient';
import type { Quote } from '../types/quote';
import type { ClientInfo } from '../types/client';
import type { VendorRateRow } from '../types/vendorRate';
import { buildBaleenQuotePayload } from '../utils/baleenQuotePayload';
import { extractEdgeFunctionMessage } from '../utils/edgeFunctionError';
import { authService } from './authService';
import { getVendorRatesCache } from './vendorRateService';

/** Catalog meta for Baleen money fields only (exact named keys). */
function vendorRowToBaleenMeta(row: VendorRateRow): Record<string, unknown> {
  const pricing =
    row.pricing && typeof row.pricing === 'object'
      ? (row.pricing as Record<string, unknown>)
      : {};
  return {
    display_unit_price_per_day: row.display_unit_price_per_day,
    display_unit_cost_per_day: row.display_unit_cost_per_day,
    printing_and_mounting_cost: row.printing_and_mounting_cost,
    printing_cost: row.printing_cost,
    mounting_cost: row.mounting_cost,
    official_and_incidental_cost: row.official_and_incidental_cost,
    freight_cost: row.freight_cost,
    extra_km_cost: row.extra_km_cost,
    recce_cost: row.recce_cost,
    min_qty: row.min_qty,
    min_days: row.min_days,
    pricing: {
      display_unit_price_per_day: pricing.display_unit_price_per_day,
      printing_and_mounting_price: pricing.printing_and_mounting_price,
      printing_price: pricing.printing_price,
      mounting_price: pricing.mounting_price,
      fixing_price: pricing.fixing_price,
      official_and_incidental_price: pricing.official_and_incidental_price,
      freight_price: pricing.freight_price,
      extra_km_price: pricing.extra_km_price,
      recce_price: pricing.recce_price,
      display_unit_cost_per_day: pricing.display_unit_cost_per_day,
      printing_and_mounting_cost: pricing.printing_and_mounting_cost,
      printing_cost: pricing.printing_cost,
      mounting_cost: pricing.mounting_cost,
      fixing_cost: pricing.fixing_cost,
      official_and_incidental_cost: pricing.official_and_incidental_cost,
      freight_cost: pricing.freight_cost,
      extra_km_cost: pricing.extra_km_cost,
      recce_cost: pricing.recce_cost,
    },
  };
}

function lookupBaleenMeta(serviceId: string): Record<string, unknown> | null {
  const lower = serviceId.trim().toLowerCase();
  if (!lower) return null;
  const row = getVendorRatesCache().find(
    (r) => (r.service_id || '').trim().toLowerCase() === lower,
  );
  return row ? vendorRowToBaleenMeta(row) : null;
}

export interface PushQuoteToBaleenResult {
  success: boolean;
  message: string;
  id?: string;
  /** Page URL only (from Edge). Never an API fetch from the browser. */
  openUrl?: string;
}

/**
 * After PDF download: invoke Edge Function only.
 * Browser never calls Baleen Media /inbox (avoids CORS + keeps API key server-side).
 */
export async function pushQuoteToBaleenMedia(params: {
  quote: Quote;
  client: ClientInfo;
}): Promise<PushQuoteToBaleenResult> {
  try {
    if (!authService.hasValidSessionToken()) {
      return {
        success: false,
        message: 'Session expired. Please log in again, then retry.',
      };
    }

    const payload = buildBaleenQuotePayload(
      params.quote,
      params.client,
      lookupBaleenMeta,
    );
    if (!payload.quoteId) {
      return { success: false, message: 'Quote number is missing.' };
    }
    if (!payload.lines.length) {
      return { success: false, message: 'Quote has no line items to send.' };
    }

    // ONLY call our Edge Function — never fetch(BALEEN_MEDIA_URL/...) from the browser.
    const sessionToken = authService.getSessionToken()!;
    const { data, error } = await supabase.functions.invoke('push-quote-to-baleen', {
      body: payload,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    const id = data?.id != null && data.id !== '' ? String(data.id) : '';
    if (error || data?.error || !id) {
      const message = await extractEdgeFunctionMessage(
        error,
        data,
        'Could not send quote to Baleen Media.',
      );
      console.error('[Baleen] Edge invoke failed (not a browser→Baleen call):', message);
      return { success: false, message };
    }

    return {
      success: true,
      message: data.message || 'Sent to Baleen Media.',
      id,
      openUrl: typeof data.openUrl === 'string' ? data.openUrl : undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Baleen] invoke exception:', message);
    return { success: false, message: `Failed to send to Baleen Media: ${message}` };
  }
}
