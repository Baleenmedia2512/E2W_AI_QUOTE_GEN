/**
 * Shared-city batch must treat statewide TN rows as covering Chennai when
 * Nominatim resolvedLocation is present — else Bus Semi is wrongly "Skipped".
 *
 * Run: npx vite-node src/utils/progressiveChat.chennaiStatewideBatch.test.ts
 */

export {};

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k, v) => {
    memoryStore[k] = String(v);
  },
  removeItem: (k) => {
    delete memoryStore[k];
  },
  clear: () => {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  },
  key: (i) => Object.keys(memoryStore)[i] ?? null,
  get length() {
    return Object.keys(memoryStore).length;
  },
} as Storage;

const { resolveProgressiveText } = await import('../chat/index');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type DbService = import('./serviceResolver').DbService;

function svc(
  id: string,
  medium: string,
  city: string,
  qtyMin = 1,
): DbService {
  return {
    service_id: id,
    service_name: medium,
    content: medium,
    document_id: 'test',
    document_name: 'test.pdf',
    metadata: {
      medium,
      city,
      currency: 'INR',
      min_quantity: qtyMin,
      pricing: { display_price: 1000, structure: 'display' },
    },
  } as DbService;
}

const DB: DbService[] = [
  svc('van-non', 'Mobile Van Non LED', 'Chennai'),
  svc('np-fix', 'No Parking Boards - Fixing', 'Chennai'),
  svc('np-print', 'No Parking Boards - Printing', 'Chennai'),
  svc('lamp', 'Lamp Post Sun Pack with Reeper', 'Chennai'),
  svc('auto', 'Auto Semi Top', 'Chennai'),
  svc('bus-semi-tn', 'Bus Semi Branding', 'Any City In Tamilnadu'),
];

const chennaiResolved = {
  town: 'Chennai',
  district: 'Chennai',
  state: 'Tamil Nadu',
  country: 'India',
  confidence: 0.95,
};

let failed = 0;
function check(cond: boolean, name: string, detail = ''): void {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n=== Chennai shared-city batch + statewide Bus Semi ===\n');

{
  const q =
    '1 mobile van non-led 30 days and 1000 no parking board and 200 lamp post sun pack with reeper and 100 auto semi top and 3 bus semi in chennai';
  const r = resolveProgressiveText(
    q,
    DB,
    { originalText: q, qty: null, resolvedLocation: chennaiResolved },
    { resolvedLocation: chennaiResolved },
  );

  const labels = (r.session.batchUnavailableLabels || []).map((l) =>
    canonicalizeServiceName(l),
  );
  const queue = (r.session.workQueue || []).map((w) =>
    canonicalizeServiceName(w.medium || w.browseToken || ''),
  );
  const active = canonicalizeServiceName(
    r.session.medium || r.session.browseToken || '',
  );
  const allMedia = [active, ...queue].filter(Boolean);

  check(
    !labels.some((l) => l.includes('bus') && l.includes('semi')),
    'Bus Semi must NOT be skipped as unavailable in Chennai',
    `unavailable=${labels.join('|')} bot=${(r.botText || '').slice(0, 140)}`,
  );
  check(
    !/not providing bus semi/i.test(r.botText || ''),
    'bot must not say Not providing Bus Semi in Chennai',
    `bot=${(r.botText || '').slice(0, 160)}`,
  );
  check(
    allMedia.some((m) => m.includes('bus') && m.includes('semi'))
    || /bus semi/i.test(r.botText || ''),
    'Bus Semi stays in the batch (active or queue)',
    `active=${active} queue=${queue.join('|')}`,
  );
  check(
    canonicalizeServiceName(r.session.city || '') === 'chennai',
    'city locked to Chennai',
    `city=${r.session.city}`,
  );
}

if (failed) {
  console.log(`\n${failed} failed\n`);
  process.exit(1);
}
console.log('\nAll Chennai statewide batch checks passed.\n');
