import { Quote, QuoteItem } from '../../src/types/quote';

export const singleLineItem: QuoteItem = {
  id: 'item-001',
  description: 'Bus Semi Branding - Rental Price (per Bus month)',
  quantity: 5,
  rate: 2000,
  total: 10000,
  duration: 1,
  durationUnit: 'months',
};

export const multipleLineItems: QuoteItem[] = [
  {
    id: 'item-001',
    description: 'Bus Semi Branding - Rental Price (per Bus month)',
    quantity: 5,
    rate: 2000,
    total: 10000,
    duration: 1,
    durationUnit: 'months',
  },
  {
    id: 'item-002',
    description: 'Auto Full Branding - Printing & Fixing Price',
    quantity: 10,
    rate: 1500,
    total: 15000,
  },
  {
    id: 'item-003',
    description: 'Bus Shelter Panel - Lit - Display Price (for 30 days)',
    quantity: 3,
    rate: 5000,
    total: 15000,
    duration: 30,
    durationUnit: 'days',
  },
];

export const simpleQuote: Quote = {
  id: 'quote-001',
  quoteNumber: 'QT-2026-001',
  date: '2026-05-18',
  validUntil: '2026-06-18',
  items: [singleLineItem],
  subtotal: 10000,
  gstEnabled: false,
  gstPercentage: 18,
  gstAmount: 0,
  total: 10000,
  deliveryTimeline: '7 working days',
  termsAndConditions: '• Prices are exclusive of GST\n• 100% Upfront payment required',
  notes: '',
  createdAt: new Date('2026-05-18'),
  updatedAt: new Date('2026-05-18'),
};

export const quoteWithGST: Quote = {
  id: 'quote-002',
  quoteNumber: 'QT-2026-002',
  date: '2026-05-18',
  validUntil: '2026-06-18',
  items: multipleLineItems,
  subtotal: 40000,
  gstEnabled: true,
  gstPercentage: 18,
  gstAmount: 7200,
  total: 47200,
  deliveryTimeline: '10 working days',
  termsAndConditions: '• Prices are exclusive of GST\n• Payment within 7 days',
  createdAt: new Date('2026-05-18'),
  updatedAt: new Date('2026-05-18'),
};

export const emptyQuote: Quote = {
  id: 'quote-empty',
  quoteNumber: 'QT-2026-000',
  date: '2026-05-18',
  validUntil: '2026-06-18',
  items: [],
  subtotal: 0,
  gstEnabled: false,
  gstPercentage: 18,
  gstAmount: 0,
  total: 0,
  deliveryTimeline: '',
  termsAndConditions: '',
  createdAt: new Date('2026-05-18'),
  updatedAt: new Date('2026-05-18'),
};
