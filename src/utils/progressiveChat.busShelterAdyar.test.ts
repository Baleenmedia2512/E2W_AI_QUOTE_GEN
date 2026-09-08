/**
 * bus shelter must stay shelter-only (no Bus Semi), chips deduped,
 * Adyar → parent Chennai when library resolves under Chennai/TN.
 *
 * Run: npx vite-node src/utils/progressiveChat.busShelterAdyar.test.ts
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
  extras?: { area_name?: string; display_price?: number },
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
      ...(extras?.area_name ? { area_name: extras.area_name } : {}),
      currency: 'INR',
      pricing: {
        display_price: extras?.display_price ?? 1000,
        structure: 'display',
      },
    },
  } as DbService;
}

const DB: DbService[] = [
  svc('semi-chn', 'Bus Semi Branding', 'Chennai'),
  svc('semi-chn-2', 'Bus Semi Branding', 'Chennai'),
  svc('sh-dbl', 'Bus Shelter – double panel – lit', 'Chennai'),
  svc('sh-dbl-ascii', 'Bus Shelter - double panel - lit', 'Chennai'),
  svc('sh-sgl', 'Bus Shelter – single panel – non lit', 'Chennai'),
  svc('sh-sgl-2', 'Bus Shelter – single panel – non lit', 'Chennai'),
  svc('semi-tn', 'Bus Semi Branding', 'Any City In Tamilnadu'),
];

const adyarResolved = {
  town: 'Adyar',
  district: 'Chennai',
  state: 'Tamil Nadu',
  country: 'India',
  confidence: 0.9,
};

let failed = 0;
function check(cond: boolean, name: string, detail = ''): void {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n=== Bus shelter + Adyar scope ===\n');

{
  const r = resolveProgressiveText(
    'bus shelter in adyar',
    DB,
    {
      originalText: 'bus shelter in adyar',
      qty: null,
      resolvedLocation: adyarResolved,
    },
    { resolvedLocation: adyarResolved },
  );
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  const uniq = [...new Set(labels)];
  check(
    r.step === 'pick_type' || r.step === 'pick_city',
    'asks options (not silent quote)',
    `step=${r.step}`,
  );
  check(
    !labels.some((l) => l.includes('semi')),
    'no Bus Semi chips for bus shelter ask',
    `chips=${labels.join('|')}`,
  );
  check(
    labels.some((l) => l.includes('shelter') && l.includes('double')),
    'includes double-panel shelter',
    `chips=${labels.join('|')}`,
  );
  check(
    labels.some((l) => l.includes('shelter') && l.includes('single')),
    'includes single-panel shelter',
    `chips=${labels.join('|')}`,
  );
  check(
    labels.length === uniq.length,
    'no duplicate shelter chips',
    `chips=${(r.options || []).map((o) => o.label).join('|')}`,
  );
  check(
    /chennai/i.test(r.botText || '')
    || canonicalizeServiceName(r.session.city || '') === 'chennai',
    'scopes Adyar to Chennai',
    `city=${r.session.city || '(none)'} bot=${(r.botText || '').slice(0, 120)}`,
  );
  check(
    /bus shelter/i.test(r.botText || ''),
    'copy names Bus Shelter (not bare Bus)',
    `bot=${(r.botText || '').slice(0, 120)}`,
  );
}

{
  // Bare bus still shows Semi + Shelter
  const r = resolveProgressiveText('bus in chennai', DB, null, null);
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  check(
    labels.some((l) => l.includes('semi')),
    'bare bus still includes Bus Semi',
    `chips=${labels.join('|')}`,
  );
  check(
    labels.some((l) => l.includes('shelter')),
    'bare bus still includes Bus Shelter',
    `chips=${labels.join('|')}`,
  );
}

{
  const r = resolveProgressiveText(
    'bus semi in adyar',
    DB,
    {
      originalText: 'bus semi in adyar',
      qty: null,
      resolvedLocation: adyarResolved,
    },
    { resolvedLocation: adyarResolved },
  );
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  const med = canonicalizeServiceName(r.session.medium || r.session.browseToken || '');
  check(
    !labels.some((l) => l.includes('shelter'))
    || med.includes('semi'),
    'bus semi ask does not require shelter chips',
    `step=${r.step} chips=${labels.join('|')} med=${med}`,
  );
  check(
    !labels.some((l) => l.includes('shelter')),
    'bus semi in adyar has no shelter chips',
    `chips=${labels.join('|')}`,
  );
}

if (failed) {
  console.log(`\n${failed} failed\n`);
  process.exit(1);
}
console.log('\nAll bus-shelter Adyar checks passed.\n');
