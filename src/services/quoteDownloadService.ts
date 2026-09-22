import { supabase } from './supabaseClient';
import { QuoteDownload, QuoteDownloadInput } from '../types/quoteDownload';

function newQuoteDownloadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `qd_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Record that a quote PDF was downloaded for a Lead.
 * - Stores Lead id + quote number (e.g. QT-10001) in QuoteDownload.
 * - Same quoteNumber → skip duplicate insert (unique).
 * - Failures are logged only; never throw (must not block PDF download).
 */
export const recordQuoteDownload = async (
  input: QuoteDownloadInput,
): Promise<QuoteDownload | null> => {
  const leadId = (input.leadId || '').trim();
  const quoteNumber = (input.quoteNumber || '').trim();
  if (!leadId || !quoteNumber) {
    return null;
  }

  try {
    const { data: existingRows, error: findError } = await supabase
      .from('QuoteDownload')
      .select('*')
      .eq('quoteNumber', quoteNumber)
      .limit(1);

    if (findError) {
      console.error('❌ QuoteDownload: Lookup failed:', findError.message, findError);
      return null;
    }

    if (existingRows?.[0]?.id) {
      return existingRows[0] as QuoteDownload;
    }

    const payload = {
      id: newQuoteDownloadId(),
      leadId,
      quoteNumber,
      createdAt: new Date().toISOString(),
    };

    const { data: created, error: insertError } = await supabase
      .from('QuoteDownload')
      .insert(payload)
      .select('*')
      .single();

    if (insertError) {
      console.error('❌ QuoteDownload: Insert failed:', insertError.message, insertError, payload);
      return null;
    }

    console.log('✅ QuoteDownload: Recorded', created?.quoteNumber, '→', created?.leadId);
    return created as QuoteDownload;
  } catch (error) {
    console.error('❌ QuoteDownload: recordQuoteDownload exception:', error);
    return null;
  }
};
