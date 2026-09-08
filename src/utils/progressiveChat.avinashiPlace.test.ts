/**
 * Service+town (bus shelter in avinasi) and place-only (services in avinasi):
 * library resolves → prefer parent-city inventory (Coimbatore), no Chennai dump,
 * no duplicate city chips, shelter-only when asked.
 *
 * Does not replace Adyar / Kudiri / Puliyangudi suites — those stay untouched.
 *
 * Run: npx vite-node src/utils/progressiveChat.avinashiPlace.test.ts
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

const { resolveProgressiveText, extractGeocodePlaceHint } = await import(
  '../chat/index'
);
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
  svc('sh-chn-dbl', 'Bus Shelter – double panel – lit', 'Chennai'),
  svc('sh-chn-sgl', 'Bus Shelter – single panel – non lit', 'Chennai'),
  svc('semi-cbe', 'Bus Semi Branding', 'Coimbatore'),
  svc('sh-cbe-dbl', 'Bus Shelter – double panel – lit', 'Coimbatore'),
  svc('sh-cbe-sgl', 'Bus Shelter – single panel – non lit', 'Coimbatore'),
  svc('sh-cbe-dbl-2', 'Bus Shelter - double panel - lit', 'Coimbatore'),
  svc('cab-cbe', 'Cab Branding', 'Coimbatore'),
  svc('auto-tn', 'Auto Semi Top', 'Any City In Tamilnadu'),
  svc('semi-tn', 'Bus Semi Branding', 'Any City In Tamilnadu'),
];

const avinashiResolved = {
  town: 'Avinashi',
  district: 'Coimbatore',
  state: 'Tamil Nadu',
  country: 'India',
  confidence: 0.9,
};

const kudiriResolved = {
  town: 'Kudiri',
  district: 'Anantapur',
  state: 'Andhra Pradesh',
  country: 'India',
  confidence: 0.8,
};

let failed = 0;
function check(cond: boolean, name: string, detail = ''): void {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n=== Avinashi service+place + place-only ===\n');

{
  const hint = extractGeocodePlaceHint('bus shelter in avinasi', DB);
  check(
    !!hint && /avinasi/i.test(hint),
    'geocode hint from bus shelter in avinasi',
    `hint=${hint}`,
  );
}

{
  const hint = extractGeocodePlaceHint('services in avinasi', DB);
  check(
    !!hint && /avinasi/i.test(hint),
    'geocode hint from services in avinasi',
    `hint=${hint}`,
  );
}

{
  const hint = extractGeocodePlaceHint('avinasi', DB);
  check(
    !!hint && /avinasi/i.test(hint),
    'geocode hint from bare avinasi',
    `hint=${hint}`,
  );
}

{
  const r = resolveProgressiveText(
    'bus shelter in avinasi',
    DB,
    {
      originalText: 'bus shelter in avinasi',
      qty: null,
      resolvedLocation: avinashiResolved,
    },
    { resolvedLocation: avinashiResolved },
  );
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  const cityLabels = (r.options || [])
    .map((o) => canonicalizeServiceName(o.city || o.label))
    .filter(Boolean);
  const uniqCities = [...new Set(cityLabels)];

  check(
    !labels.some((l) => l.includes('semi')),
    'shelter ask: no Bus Semi chips',
    `chips=${labels.join('|')}`,
  );
  check(
    labels.some((l) => l.includes('shelter'))
    || canonicalizeServiceName(r.session.city || '') === 'coimbatore'
    || r.step === 'pick_type'
    || r.step === 'pick_city',
    'shelter ask continues funnel',
    `step=${r.step} city=${r.session.city} chips=${labels.join('|')}`,
  );
  check(
    canonicalizeServiceName(r.session.city || '') === 'coimbatore'
    || (
      r.step === 'pick_city'
      && cityLabels.every((c) => c === 'coimbatore')
    ),
    'scopes Avinashi to Coimbatore (not Chennai)',
    `city=${r.session.city || '(none)'} cities=${cityLabels.join('|')} step=${r.step}`,
  );
  check(
    !cityLabels.some((c) => c === 'chennai'),
    'no Chennai city chip for Avinashi shelter',
    `cities=${cityLabels.join('|')}`,
  );
  check(
    cityLabels.length === uniqCities.length,
    'no duplicate city chips',
    `cities=${(r.options || []).map((o) => o.label).join('|')}`,
  );
  check(
    canonicalizeServiceName(r.session.city || '') !== 'avinashi',
    'does not lock city to Nominatim town Avinashi',
    `city=${r.session.city}`,
  );
}

{
  const r = resolveProgressiveText(
    'bus in avinasi',
    DB,
    {
      originalText: 'bus in avinasi',
      qty: null,
      resolvedLocation: avinashiResolved,
    },
    { resolvedLocation: avinashiResolved },
  );
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  check(
    labels.some((l) => l.includes('semi')) || labels.some((l) => l.includes('shelter')),
    'bare bus in avinasi shows bus family options',
    `step=${r.step} chips=${labels.join('|')}`,
  );
  check(
    canonicalizeServiceName(r.session.city || '') === 'coimbatore'
    || !(r.options || []).some((o) => /chennai/i.test(o.city || o.label)),
    'bare bus in avinasi does not offer Chennai',
    `city=${r.session.city} chips=${(r.options || []).map((o) => o.label).join('|')}`,
  );
}

{
  const r = resolveProgressiveText(
    'services in avinasi',
    DB,
    {
      originalText: 'services in avinasi',
      qty: null,
      resolvedLocation: avinashiResolved,
    },
    { resolvedLocation: avinashiResolved },
  );
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  check(
    r.step === 'pick_type' || r.step === 'pick_city',
    'services in avinasi lists options',
    `step=${r.step}`,
  );
  check(
    labels.some((l) => l.includes('shelter') || l.includes('semi') || l.includes('cab') || l.includes('auto')),
    'services in avinasi includes covering media',
    `chips=${labels.join('|')}`,
  );
  check(
    !labels.some((l) => l.includes('chennai')),
    'service list is not a raw city dump',
    `chips=${labels.join('|')}`,
  );
  check(
    canonicalizeServiceName(r.session.city || '') === 'coimbatore'
    || (r.session.candidateServiceIds || []).every((id) =>
      !id.includes('chn') || id.includes('cbe') || id.includes('tn')
    ),
    'services in avinasi scoped toward Coimbatore coverage',
    `city=${r.session.city} cands=${(r.session.candidateServiceIds || []).join(',')}`,
  );
}

{
  const r = resolveProgressiveText(
    'avinasi',
    DB,
    {
      originalText: 'avinasi',
      qty: null,
      resolvedLocation: avinashiResolved,
    },
    { resolvedLocation: avinashiResolved },
  );
  check(
    (r.options || []).length > 0 || r.step === 'pick_type' || r.step === 'pick_city',
    'bare avinasi lists covering services',
    `step=${r.step} chips=${(r.options || []).map((o) => o.label).join('|')}`,
  );
  check(
    !/services in This/i.test(r.botText || '')
    && !/advertising services in This/i.test(r.botText || ''),
    'bare avinasi copy is not "in This"',
    `bot=${(r.botText || '').slice(0, 120)}`,
  );
}

{
  const r = resolveProgressiveText(
    'services in kudiri',
    DB,
    {
      originalText: 'services in kudiri',
      qty: null,
      resolvedLocation: kudiriResolved,
    },
    { resolvedLocation: kudiriResolved },
  );
  check(
    r.step === 'no_match'
    || /not providing/i.test(r.botText || '')
    || (r.options || []).length === 0,
    'services in kudiri (outside TN) is not providing',
    `step=${r.step} bot=${(r.botText || '').slice(0, 120)} opts=${(r.options || []).length}`,
  );
}

if (failed) {
  console.log(`\n${failed} failed\n`);
  process.exit(1);
}
console.log('\nAll Avinashi place checks passed.\n');
