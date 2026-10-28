import { supabase } from './supabaseClient';
import type { Quote } from '../types/quote';
import type { ClientInfo } from '../types/client';
import {
  applyVendorGstNumbers,
  buildBaleenQuotePayload,
  usableVendorGst,
} from '../utils/baleenQuotePayload';
import { extractEdgeFunctionMessage } from '../utils/edgeFunctionError';
import { authService } from './authService';

export interface PushQuoteToBaleenResult {
  success: boolean;
  message: string;
  id?: string;
  /** Page URL only (from Edge). Never an API fetch from the browser. */
  openUrl?: string;
}

function normalizeVendorKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Load vendor_gst from public.vendors for the given display names.
 * Case-insensitive match on name (and name_code as fallback).
 */
export async function fetchVendorGstByNames(
  vendorNames: string[],
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      vendorNames
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  ];
  const out = new Map<string, string>();
  if (!unique.length) return out;

  const { data, error } = await supabase
    .from('vendors')
    .select('name, name_code, vendor_gst');

  if (error) {
    console.warn('[Baleen] vendors GST lookup failed:', error.message);
    return out;
  }

  const byKey = new Map<string, string>();
  for (const row of data || []) {
    const gst = usableVendorGst(row.vendor_gst);
    if (!gst) continue;
    const nameKey = normalizeVendorKey(String(row.name || ''));
    const codeKey = normalizeVendorKey(String(row.name_code || '').replace(/-/g, ' '));
    if (nameKey) byKey.set(nameKey, gst);
    if (codeKey) byKey.set(codeKey, gst);
  }

  for (const name of unique) {
    const key = normalizeVendorKey(name);
    const gst = byKey.get(key);
    if (gst) out.set(key, gst);
  }

  return out;
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

    let payload = buildBaleenQuotePayload(params.quote, params.client);
    if (!payload.quoteId) {
      return { success: false, message: 'Quote number is missing.' };
    }
    if (!payload.lines.length) {
      return { success: false, message: 'Quote has no line items to send.' };
    }

    try {
      const gstMap = await fetchVendorGstByNames(
        payload.lines.map((line) => line.vendorName),
      );
      payload = applyVendorGstNumbers(payload, gstMap);
    } catch (gstErr) {
      console.warn('[Baleen] vendor GST enrich skipped:', gstErr);
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
