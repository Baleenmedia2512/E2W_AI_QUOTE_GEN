export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface QuoteItem {
  id: string;
  title: string;
  lineItems: LineItem[];
  subtotal: number;
}

export interface Quote {
  id: string;
  items: QuoteItem[];
  subtotal: number;
  gstEnabled: boolean;
  gstAmount: number;
  total: number;
  deliveryTimeline: string;
  termsAndConditions: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteState {
  currentQuote: Quote | null;
  quotes: Quote[];
}
