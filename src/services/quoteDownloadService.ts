import { QuoteDownload, QuoteDownloadInput } from '../types/quoteDownload';
import { apiFetch } from './apiClient';

export const recordQuoteDownload = async (
  input: QuoteDownloadInput,
): Promise<QuoteDownload | null> => {
  const leadId = (input.leadId || '').trim();
  const quoteNumber = (input.quoteNumber || '').trim();
  if (!leadId || !quoteNumber) return null;

  try {
    const { data, error } = await apiFetch<{ data?: QuoteDownload }>('/api/quotes/downloads', {
      method: 'POST',
      body: JSON.stringify({ leadId, quoteNumber }),
    });
    if (error) {
      console.error('❌ QuoteDownload: Insert failed:', error);
      return null;
    }
    console.log('✅ QuoteDownload: Recorded', data?.data?.quoteNumber, '→', data?.data?.leadId);
    return data?.data || null;
  } catch (error) {
    console.error('❌ QuoteDownload: recordQuoteDownload exception:', error);
    return null;
  }
};
