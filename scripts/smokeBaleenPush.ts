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

type ItemWithMeta = QuoteItem & { metadata?: Record<string, unknown> };

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

function baseQuote(items: QuoteItem[]): Quote {
  return {
    id: 'q-test',
    quoteNumber: 'QT-SMOKE-001',
    date: new Date(),
    validUntil: new Date(),
    items,
    subtotal: 0,
    gstEnabled: true,
    gstPercentage: 18,
    gstAmount: 0,
    total: 0,
    deliveryTimeline: '',
    termsAndConditions: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function line(partial: ItemWithMeta): ItemWithMeta {
  return {
    id: '1',
    description: 'Service',
    quantity: 5,
    quantityUnit: 'unit',
    rate: 999999,
    total: 0,
    duration: 30,
    durationUnit: 'days',
    serviceId: 'svc-1',
    serviceName: 'Service',
    city: 'Chennai',
    vendorName: 'Vendor',
    medium: 'MEDIUM',
    adType: 'Type',
    ...partial,
  };
}

async function main() {
  // Case A: combined P&M
  // cost excl  = 400×5×30 + 3000×5 = 75000 → ×1.18 = 88500
  // price excl = 500×5×30 + 2500×5 = 87500 → ×1.18 = 103250
  const combinedMeta = {
    display_unit_price_per_day: 500,
    display_unit_cost_per_day: 400,
    printing_and_mounting_cost: 3000,
    pricing: { printing_and_mounting_price: 2500 },
  };
  let payload = buildBaleenQuotePayload(
    baseQuote([line({ metadata: combinedMeta })]),
    client,
  );
  assert(payload.lines.length === 1, 'combined: one line');
  assert(!('costInclGst' in payload.lines[0]), 'must not send costInclGst');
  assert(payload.lines[0].vendorCostExclGst === 88500, `combined cost ${payload.lines[0].vendorCostExclGst}`);
  assert(payload.lines[0].priceInclGst === 103250, `combined price ${payload.lines[0].priceInclGst}`);
  console.log('OK A: combined P&M → vendorCostExclGst=88500 priceInclGst=103250');

  // Case B: split printing + mounting + official + freight + recce
  // oneTime price = 1000+500 + 200 + 100 + 50 = 1850 ×5 = 9250
  // oneTime cost  = 800+400  + 150 + 80  + 40 = 1470 ×5 = 7350
  // unit price    = 500×5×30 = 75000 → price excl = 84250 → ×1.18 = 99415
  // unit cost     = 400×5×30 = 60000 → cost excl  = 67350 → ×1.18 = 79473
  const splitMeta = {
    display_unit_price_per_day: 500,
    display_unit_cost_per_day: 400,
    printing_cost: 800,
    mounting_cost: 400,
    official_and_incidental_cost: 150,
    freight_cost: 80,
    recce_cost: 40,
    pricing: {
      printing_price: 1000,
      mounting_price: 500,
      official_and_incidental_price: 200,
      freight_price: 100,
      recce_price: 50,
    },
  };
  payload = buildBaleenQuotePayload(
    baseQuote([line({ metadata: splitMeta })]),
    client,
  );
  assert(payload.lines[0].vendorCostExclGst === 79473, `split cost ${payload.lines[0].vendorCostExclGst}`);
  assert(payload.lines[0].priceInclGst === 99415, `split price ${payload.lines[0].priceInclGst}`);
  console.log('OK B: split P+F + official/freight/recce → cost=79473 price=99415');

  // Case C: combined present → ignore split parts (no double-count)
  const noDoubleMeta = {
    display_unit_price_per_day: 100,
    display_unit_cost_per_day: 50,
    printing_and_mounting_cost: 1000,
    printing_cost: 9999,
    mounting_cost: 9999,
    pricing: {
      printing_and_mounting_price: 2000,
      printing_price: 9999,
      mounting_price: 9999,
    },
  };
  payload = buildBaleenQuotePayload(
    baseQuote([
      line({
        quantity: 1,
        duration: 1,
        durationUnit: 'days',
        metadata: noDoubleMeta,
      }),
    ]),
    client,
  );
  // price excl = 100×1×1 + 2000 = 2100 → ×1.18 = 2478
  // cost excl  = 50×1×1 + 1000 = 1050 → ×1.18 = 1239
  assert(payload.lines[0].priceInclGst === 2478, `no-double price ${payload.lines[0].priceInclGst}`);
  assert(payload.lines[0].vendorCostExclGst === 1239, `no-double cost ${payload.lines[0].vendorCostExclGst}`);
  console.log('OK C: combined wins over split (no double-count)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
