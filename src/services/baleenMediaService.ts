import { supabase } from './supabaseClient';
import type { Quote } from '../types/quote';
import type { ClientInfo } from '../types/client';
import { buildBaleenQuotePayload } from '../utils/baleenQuotePayload';
import { extractEdgeFunctionMessage } from '../utils/edgeFunctionError';
import { authService } from './authService';

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

    const payload = buildBaleenQuotePayload(params.quote, params.client);
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
