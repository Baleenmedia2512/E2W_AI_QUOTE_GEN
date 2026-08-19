import { createClient } from '@supabase/supabase-js';
import { Quote } from '../types/quote';
import { ClientInfo } from '../types/client';
import { CompanyInfo } from '../types/company';
import { toCampaignDays } from '../utils/durationUtils';
import { authService } from './authService';
import { buildPdfAttachmentPayload } from '../utils/quoteEmailPayload';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL or Anon Key is not defined in environment variables.');
}

const supabase = createClient(supabaseUrl!, supabaseAnonKey!); // Added non-null assertion operators

interface PdfAttachmentInput {
  pdfBlob: Blob;
  filename: string;
}

interface SendQuoteEmailParams {
  pdfAttachments: PdfAttachmentInput[];
  quote: Quote;
  client: ClientInfo;
  company: CompanyInfo;
  downloadedBy: string;
}

interface SendQuoteEmailResult {
  success: boolean;
  message: string;
}

interface QuoteItemForEmailAttachment {
  serviceId?: string;
  serviceName?: string;
  description: string;
  quantity: number;
  duration?: number;
  durationUnit?: 'months' | 'days';
  minimumQuantity?: number;
  quantityUnit?: string;
  rate?: number;
  oneTimeQuantity?: number;
  oneTimeComponents?: { label: string; amount: number }[];
  vendorPfUnitCost?: number;
  vendorDisplayUnitCostPerDay?: number;
  total: number;
  city?: string;
}

const blobToBase64 = async (pdfBlob: Blob): Promise<string> => {
  const arrayBuffer = await pdfBlob.arrayBuffer();
  return btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
  );
};

export const sendQuoteEmail = async (
  params: SendQuoteEmailParams,
): Promise<SendQuoteEmailResult> => {
  try {
    const { pdfAttachments, quote, client, company, downloadedBy } = params;

    if (!pdfAttachments.length) {
      return { success: false, message: 'No PDF attachments to send.' };
    }

    const encodedAttachments = buildPdfAttachmentPayload(
      await Promise.all(
        pdfAttachments.map(async ({ pdfBlob, filename }) => ({
          base64Pdf: await blobToBase64(pdfBlob),
          filename,
        })),
      ),
    );

    const { data, error } = await supabase.functions.invoke('send-quote-email', {
      body: {
        pdfAttachments: encodedAttachments,
        quoteNumber: quote.quoteNumber,
        quoteItems: quote.items.map<QuoteItemForEmailAttachment>((item) => ({
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          description: item.description,
          quantity: Number(item.quantity) || 0,
          duration: toCampaignDays(item.duration, item.durationUnit) ?? item.duration,
          durationUnit: 'days',
          minimumQuantity: item.minimumQuantity,
          quantityUnit: item.quantityUnit,
          rate: Number(item.rate) || 0,
          oneTimeQuantity: Number(item.oneTimeQuantity) || undefined,
          oneTimeComponents: item.oneTimeComponents,
          vendorPfUnitCost: item.vendorPfUnitCost,
          vendorDisplayUnitCostPerDay: item.vendorDisplayUnitCostPerDay,
          total: Number(item.total) || 0,
          city: item.city,
        })),
        clientName: client.name,
        clientPhoneNumber: client.phone,
        downloadedBy,
        companyName: company.name,
        companyLogo: company.logo,
        date: new Date().toLocaleDateString('en-GB', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
        }),
      },
      headers: {
        'Content-Type': 'application/json',
        ...(authService.getSessionToken()
          ? { Authorization: `Bearer ${authService.getSessionToken()}` }
          : {}),
      },
    });

    if (error) {
      console.error('Error invoking Edge Function:', error);
      return { success: false, message: error.message };
    }

    // Supabase Edge Functions always return a 'data' field, even for errors
    // The actual error from the function will be in data.error
    if (data && data.error) {
      console.error('Edge Function returned an error:', data.error);
      return { success: false, message: data.error };
    }

    return { success: true, message: data.message || 'Email sent successfully.' };
  } catch (error: any) {
    console.error('sendQuoteEmail service failed:', error);
    return {
      success: false,
      message: `Failed to send email: ${error.message || 'Unknown error'}`,
    };
  }
};
