import { Quote } from '../types/quote';
import { ClientInfo } from '../types/client';
import { CompanyInfo } from '../types/company';
import { toCampaignDays } from '../utils/durationUtils';
import { authService } from './authService';
import { buildPdfAttachmentPayload } from '../utils/quoteEmailPayload';
import { apiFetch } from './apiClient';

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

    if (!authService.hasValidSessionToken()) {
      return {
        success: false,
        message: 'Session expired. Please log in again, then retry sending the email.',
      };
    }

    const encodedAttachments = buildPdfAttachmentPayload(
      await Promise.all(
        pdfAttachments.map(async ({ pdfBlob, filename }) => ({
          base64Pdf: await blobToBase64(pdfBlob),
          filename,
        })),
      ),
    );

    const { data, error } = await apiFetch<{ success?: boolean; message?: string; error?: string }>(
      '/api/quotes/email',
      {
        method: 'POST',
        body: JSON.stringify({
          pdfAttachments: encodedAttachments,
          quoteNumber: quote.quoteNumber,
          quoteItems: quote.items.map((item) => ({
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
        }),
      },
    );

    if (error || !data?.success) {
      return {
        success: false,
        message: data?.message || data?.error || error || 'Failed to send quote email.',
      };
    }

    return { success: true, message: data.message || 'Quote emailed successfully.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send quote email.',
    };
  }
};
