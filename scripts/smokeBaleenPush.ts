/**
 * Smoke: payload shape for Baleen inbox (no live POST unless env set).
 * Run: npx tsx scripts/smokeBaleenPush.ts
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { buildBaleenQuotePayload } from '../src/utils/baleenQuotePayload';
import type { Quote, QuoteItem } from '../src/types/quote';
import type { ClientInfo } from '../src/types/client';

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

/**
 * qty 5, days 30 — amounts from metadata only:
 * cost excl  = 400×5×30 + 3000×5 = 75000 → ×1.18 = 88500
 * price excl = 500×5×30 + 2500×5 = 87500 → ×1.18 = 103250
 * Two quote rows (Display + P&M) → one Baleen line.
 * Item rate / vendorCost* must be ignored.
 */
const sharedMeta = {
  display_unit_price_per_day: 500,
  display_unit_cost_per_day: 400,
  printing_and_mounting_cost: 3000,
  pricing: {
    printing_and_mounting_price: 2500,
  },
};

type ItemWithMeta = QuoteItem & { metadata?: Record<string, unknown> };

const quote: Quote = {
  id: 'q-test',
  quoteNumber: 'QT-SMOKE-001',
  date: new Date(),
  validUntil: new Date(),
  items: [
    {
      id: '1',
      description: 'Hoarding Frontlit - Display Price',
      quantity: 5,
      quantityUnit: 'Hoarding',
      // Decoy rates — must NOT affect Baleen money fields
      rate: 999999,
      total: 75000,
      duration: 30,
      durationUnit: 'days',
      serviceId: 'hoarding-frontlit-chennai',
      serviceName: 'Hoarding Frontlit',
      city: 'Chennai',
      vendorName: 'TOI OOH',
      medium: 'HOARDING',
      adType: 'Frontlit',
      vendorDisplayUnitCostPerDay: 1,
      metadata: sharedMeta,
    } as ItemWithMeta,
    {
      id: '2',
      description: 'Hoarding Frontlit - Printing & Fixing',
      quantity: 5,
      quantityUnit: 'Hoarding',
      rate: 888888,
      total: 12500,
      serviceId: 'hoarding-frontlit-chennai',
      serviceName: 'Hoarding Frontlit',
      city: 'Chennai',
      vendorName: 'TOI OOH',
      medium: 'HOARDING',
      adType: 'Frontlit',
      vendorPfUnitCost: 1,
      vendorCostExclGst: 1,
      metadata: sharedMeta,
    } as ItemWithMeta,
  ],
  subtotal: 87500,
  gstEnabled: true,
  gstPercentage: 18,
  gstAmount: 15750,
  total: 103250,
  deliveryTimeline: '',
  termsAndConditions: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const client: ClientInfo = {
  name: 'Acme Traders',
  company: 'Acme',
  address: '',
  gst: '',
  phone: '9876543210',
  email: '',
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const payload = buildBaleenQuotePayload(quote, client);
  console.log('Line count:', payload.lines.length);
  console.log('Line 0:', JSON.stringify(payload.lines[0], null, 2));

  assert(payload.quoteId === 'QT-SMOKE-001', 'quoteId');
  assert(payload.lines.length === 1, `expected 1 merged line, got ${payload.lines.length}`);
  assert(payload.lines[0].serviceId === 'hoarding-frontlit-chennai', 'serviceId');
  assert(
    !('costInclGst' in payload.lines[0]),
    'must not send costInclGst (Baleen ignores it)',
  );
  assert(
    payload.lines[0].vendorCostExclGst === 88500,
    `vendorCostExclGst got ${payload.lines[0].vendorCostExclGst}`,
  );
  assert(
    payload.lines[0].priceInclGst === 103250,
    `priceInclGst got ${payload.lines[0].priceInclGst}`,
  );
  assert(payload.lines[0].qty === 5, 'qty');
  console.log('OK: one service → one line; vendorCostExclGst=88500 priceInclGst=103250');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
