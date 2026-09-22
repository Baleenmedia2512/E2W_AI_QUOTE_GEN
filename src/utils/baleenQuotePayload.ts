import type { Quote, QuoteItem } from '../types/quote';
import type { ClientInfo } from '../types/client';

/** One line in the Baleen Media inbox payload. */
export interface BaleenQuoteLine {
  serviceId: string;
  medium: string;
  adType: string;
  city: string;
  vendorName: string;
  vendorCostExclGst: number;
  priceInclGst: number;
  qty: number;
  qtyUnit: string;
}

/** Body POSTed to Baleen Media (via Edge Function). */
export interface BaleenQuotePayload {
  quoteId: string;
  clientName: string;
  mobile: string;
  lines: BaleenQuoteLine[];
}

function digitsOnlyPhone(phone: string | undefined): string {
  return String(phone || '').replace(/\D/g, '');
}

function unitPriceInclGst(item: QuoteItem, quote: Quote): number {
  const rate = Number(item.rate) || 0;
  if (!quote.gstEnabled || !(quote.gstPercentage > 0)) return rate;
  return Math.round(rate * (1 + quote.gstPercentage / 100) * 100) / 100;
}

function vendorCostForLine(item: QuoteItem): number {
  if (item.vendorCostExclGst != null && item.vendorCostExclGst > 0) {
    return item.vendorCostExclGst;
  }
  if (item.vendorPfUnitCost != null && item.vendorPfUnitCost > 0) {
    return item.vendorPfUnitCost;
  }
  if (item.vendorDisplayUnitCostPerDay != null && item.vendorDisplayUnitCostPerDay > 0) {
    return item.vendorDisplayUnitCostPerDay;
  }
  return 0;
}

/**
 * Build Baleen Media inbox JSON from the live quote + client (DB-stamped line fields).
 * Vendor/cost must already be on items from catalog build — never parse the client PDF.
 */
export function buildBaleenQuotePayload(
  quote: Quote,
  client: ClientInfo,
): BaleenQuotePayload {
  const lines: BaleenQuoteLine[] = quote.items.map((item) => {
    const medium = (item.medium || item.serviceName || item.title || item.description || '')
      .trim();
    const adType = (item.adType || item.serviceName || item.title || medium).trim();
    return {
      serviceId: (item.serviceId || item.id || '').trim(),
      medium,
      adType,
      city: (item.city || '').trim(),
      vendorName: (item.vendorName || '').trim(),
      vendorCostExclGst: vendorCostForLine(item),
      priceInclGst: unitPriceInclGst(item, quote),
      qty: Number(item.quantity) || 0,
      qtyUnit: (item.quantityUnit || '').trim(),
    };
  });

  return {
    quoteId: String(quote.quoteNumber || quote.id || '').trim(),
    clientName: String(client.name || client.company || '').trim(),
    mobile: digitsOnlyPhone(client.phone),
    lines,
  };
}
