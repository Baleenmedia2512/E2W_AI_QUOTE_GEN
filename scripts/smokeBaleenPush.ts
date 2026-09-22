/**
 * Smoke: payload shape + server-side POST to Baleen (simulates Edge Function).
 * Run: npx tsx scripts/smokeBaleenPush.ts
 * Loads BALEEN_MEDIA_URL / QUOTE_BUDDY_API_KEY from .env (never prints secrets).
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { buildBaleenQuotePayload } from '../src/utils/baleenQuotePayload';
import type { Quote } from '../src/types/quote';
import type { ClientInfo } from '../src/types/client';

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) {
    console.log('No .env at', path);
    return;
  }
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  let loaded = 0;
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
    if (
      process.env[key] == null
      || process.env[key] === ''
      || key === 'BALEEN_MEDIA_URL'
      || key === 'QUOTE_BUDDY_API_KEY'
    ) {
      process.env[key] = val;
      loaded += 1;
    }
  }
  console.log(
    'Env loaded from .env:',
    loaded,
    'keys; BALEEN set=',
    !!process.env.BALEEN_MEDIA_URL,
    'API key set=',
    !!process.env.QUOTE_BUDDY_API_KEY,
  );
}

loadDotEnv();

const quote: Quote = {
  id: 'q-test',
  quoteNumber: 'QT-SMOKE-001',
  date: new Date(),
  validUntil: new Date(),
  items: [
    {
      id: '1',
      description: 'Auto Full - Printing & Fixing',
      quantity: 50,
      quantityUnit: 'Auto',
      rate: 999,
      total: 49950,
      serviceId: 'auto-full-chennai',
      serviceName: 'Auto Full',
      city: 'Chennai',
      vendorName: 'TOI OOH',
      medium: 'AUTO FULL',
      adType: 'Auto Branding',
      vendorCostExclGst: 850,
      vendorPfUnitCost: 850,
    },
  ],
  subtotal: 49950,
  gstEnabled: true,
  gstPercentage: 18,
  gstAmount: 8991,
  total: 58941,
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
  console.log('Payload keys:', Object.keys(payload).join(', '));
  console.log('Line count:', payload.lines.length);

  assert(payload.quoteId === 'QT-SMOKE-001', 'quoteId');
  assert(payload.clientName === 'Acme Traders', 'clientName');
  assert(payload.mobile === '9876543210', 'mobile');
  assert(payload.lines.length === 1, 'lines');
  assert(payload.lines[0].serviceId === 'auto-full-chennai', 'serviceId');
  // P&M-only: cost 850 × 50 × 1.18 = 50150; price 999 × 50 × 1.18 = 58941
  assert(
    payload.lines[0].vendorCostExclGst === 50150,
    `vendorCost (incl GST) got ${payload.lines[0].vendorCostExclGst}`,
  );
  assert(
    payload.lines[0].priceInclGst === 58941,
    `priceInclGst got ${payload.lines[0].priceInclGst}`,
  );
  console.log('OK Payload builder (server-side shape, GST-incl line totals)');

  const base = (process.env.BALEEN_MEDIA_URL || '').replace(/\/$/, '');
  const key = process.env.QUOTE_BUDDY_API_KEY || '';
  if (!base || !key) {
    console.log('Skip live inbox POST — missing BALEEN_MEDIA_URL or QUOTE_BUDDY_API_KEY in .env');
    return;
  }

  const inboxUrl = `${base}/api/integrations/quote-buddy/inbox`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
  if (/ngrok/i.test(base)) {
    headers['ngrok-skip-browser-warning'] = 'true';
  }

  console.log('POST (Node/server only, not browser) → inbox');
  const res = await fetch(inboxUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body preview:', text.slice(0, 300));

  if (!res.ok) {
    throw new Error(`Inbox POST failed: ${res.status}`);
  }
  const parsed = JSON.parse(text) as { ok?: boolean; id?: string | number };
  assert(parsed.id != null && String(parsed.id) !== '', 'response id');
  console.log('OK Live inbox — id=', String(parsed.id));
  console.log('Open path: /orders/from-quote?id=' + String(parsed.id));
}

main().catch((err) => {
  console.error('FAIL', err instanceof Error ? err.message : err);
  process.exit(1);
});
