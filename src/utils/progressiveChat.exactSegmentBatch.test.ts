/**
 * Exact multi-word batch tokens must stay specific:
 * - lamp post sun pack with reeper → that medium (no re-ask)
 * - bus semi wrap → wrap (not branding)
 * - sole DB city auto-lock only (no invented Madurai)
 *
 * Run: npx vite-node src/utils/progressiveChat.exactSegmentBatch.test.ts
 */

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => {
    memoryStore[k] = String(v);
  },
  removeItem: (k: string) => {
    delete memoryStore[k];
  },
  clear: () => {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  get length() {
    return Object.keys(memoryStore).length;
  },
} as Storage;

const { resolveProgressiveText, parseServiceSegments } = await import('../chat/index');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type DbService = import('./serviceResolver').DbService;

function svc(
  id: string,
  medium: string,
  city: string,
  display_price = 1000,
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
      pricing: { display_price, structure: 'display' },
    },
  } as DbService;
}

const DB: DbService[] = [
  svc('mv-non', 'Mobile Van Non LED', 'Chennai', 5000),
  svc('np-fix', 'No Parking Boards - Fixing', 'Chennai', 100),
  svc('np-print', 'No Parking Boards - Printing', 'Chennai', 100),
  svc('lp-with', 'Lamp Post Boards (Sun Pack) - With Reeper', 'Chennai', 200),
  svc('lp-with-blr', 'Lamp Post Boards (Sun Pack) - With Reeper', 'Bangalore', 200),
  svc('lp-without', 'Lamp Post Boards (Sun Pack) - Without Reeper', 'Chennai', 180),
  svc('lp-signal', 'Signal Post', 'Chennai', 150),
  svc('auto-semi', 'Auto Semi Top', 'Any City In Tamilnadu', 50),
  svc('auto-semi-blr', 'Auto Semi Top', 'Bangalore', 50),
  svc('bus-wrap', 'Bus Semi Wrap', 'Chennai', 300),
  svc('bus-brand', 'Bus Semi Branding', 'Chennai', 300),
  // Unpriced Madurai row must never invent Madurai for a city-less ask
  {
    service_id: 'bus-wrap-mad',
    service_name: 'Bus Semi Wrap',
    content: 'Bus Semi Wrap',
    document_id: 'test',
    document_name: 'madurai.pdf',
    metadata: {
      medium: 'Bus Semi Wrap',
      city: 'Madurai',
      currency: 'INR',
      pricing: { display_price: 0, structure: 'display' },
    },
  } as DbService,
];

let failed = 0;
function check(cond: boolean, name: string, detail = ''): void {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n=== Exact segment batch retention ===\n');

{
  const segs = parseServiceSegments(
    'mobile van non led for 30 days and 1000 no parking board and 200 lamp post sun pack with reeper and 100 auto semi top and 3 bus semi wrap',
    DB,
  );
  const tokens = segs.map((s) => canonicalizeServiceName(s.token));
  check(
    tokens.some((t) => t.includes('lamp') && t.includes('reeper')),
    'segment token keeps lamp post … with reeper',
    `tokens=${tokens.join(' | ')}`,
  );
  check(
    tokens.some((t) => t.includes('bus') && t.includes('wrap')),
    'segment token keeps bus semi wrap',
    `tokens=${tokens.join(' | ')}`,
  );
  check(
    !tokens.some((t) => t === 'bus semi' || t === 'lamp post'),
    'does not collapse wrap/reeper phrases to bare family',
    `tokens=${tokens.join(' | ')}`,
  );
}

{
  const r = resolveProgressiveText(
    '200 lamp post sun pack with reeper and 3 bus semi wrap',
    DB,
    null,
    null,
  );
  const med = canonicalizeServiceName(r.session.medium || r.session.browseToken || '');
  const queue = (r.session.workQueue || []).map((w) =>
    canonicalizeServiceName(w.medium || w.browseToken || ''),
  );
  const askingLampOptions =
    r.step === 'pick_type'
    && /lamp/i.test(r.botText || '')
    && (r.options || []).length > 1;
  check(
    !askingLampOptions,
    'fully specified lamp post sun pack with reeper does not re-ask lamp options',
    `step=${r.step} bot=${(r.botText || '').slice(0, 100)} opts=${(r.options || []).map((o) => o.label).join('|')}`,
  );
  check(
    med.includes('reeper')
    || queue.some((t) => t.includes('reeper'))
    || /reeper/i.test(r.botText || ''),
    'keeps with-reeper medium in session/queue',
    `medium=${med} queue=${queue.join('|')}`,
  );
  check(
    queue.some((t) => t.includes('wrap'))
    || med.includes('wrap')
    || /wrap/i.test(r.botText || ''),
    'keeps bus semi wrap on queue (not branding)',
    `medium=${med} queue=${queue.join('|')}`,
  );
  check(
    !/madurai/i.test(r.botText || '')
    && canonicalizeServiceName(r.session.city || '') !== 'madurai',
    'does not invent Madurai when user named no city',
    `city=${r.session.city || '(none)'} bot=${(r.botText || '').slice(0, 120)}`,
  );
}

{
  // Full user transcript batch — Mobile Van Non LED may auto-lock sole city and
  // hand off; bot text must match the chips' current ask (never MV copy + NP chips).
  const r = resolveProgressiveText(
    'mobile van non led for 30 days and 1000 no parking board and 200 lamp post sun pack with reeper and 100 auto semi top and 3 bus semi wrap',
    DB,
    null,
    null,
  );
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  const med = canonicalizeServiceName(r.session.medium || r.session.browseToken || '');
  const queue = (r.session.workQueue || []).map((w) =>
    canonicalizeServiceName(w.medium || w.browseToken || ''),
  );
  const bot = r.botText || '';
  const chipsAreNoParking = labels.some((l) => l.includes('no parking'));
  const chipsAreMobileVan = labels.some((l) => l.includes('mobile van') || l.includes('chennai'));
  const botAsksNoParking = /no parking/i.test(bot) && !/starting mobile van/i.test(bot);
  const botAsksMobileVan = /mobile van/i.test(bot) && !chipsAreNoParking;
  check(
    (chipsAreNoParking && botAsksNoParking)
    || (chipsAreMobileVan && botAsksMobileVan)
    || (!chipsAreNoParking && /mobile van/i.test(bot)),
    'bot text matches current chips (no Mobile Van copy + No Parking chips)',
    `bot=${bot.slice(0, 160)} chips=${labels.join('|')} medium=${med}`,
  );
  check(
    queue.some((t) => t.includes('reeper')),
    'lamp post with reeper stays specific on queue',
    `queue=${queue.join('|')}`,
  );
  check(
    queue.some((t) => t.includes('wrap')) && !queue.some((t) => t.includes('branding')),
    'bus semi wrap stays wrap on queue',
    `queue=${queue.join('|')}`,
  );
  check(
    !/madurai/i.test(bot)
    && canonicalizeServiceName(r.session.city || '') !== 'madurai',
    'full batch does not invent Madurai',
    `city=${r.session.city || '(none)'} bot=${bot.slice(0, 120)}`,
  );
}

{
  // Statewide TN inventory covers Puliyangudi when Nominatim resolves state
  const r = resolveProgressiveText(
    'bus semi in puliyangudi',
    [
      svc('bus-semi-tn', 'Bus Semi Branding', 'Any City In Tamilnadu', 300),
      svc('bus-wrap-tn', 'Bus Semi Wrap', 'Any City In Tamilnadu', 300),
    ],
    {
      originalText: 'bus semi in puliyangudi',
      qty: null,
      resolvedLocation: {
        town: 'Puliyangudi',
        district: 'Tenkasi',
        state: 'Tamil Nadu',
        country: 'India',
        confidence: 0.9,
      },
    },
    {
      resolvedLocation: {
        town: 'Puliyangudi',
        district: 'Tenkasi',
        state: 'Tamil Nadu',
        country: 'India',
        confidence: 0.9,
      },
    },
  );
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  const uniq = [...new Set(labels)];
  check(
    !/not providing/i.test(r.botText || ''),
    'Puliyangudi + TN statewide does not say Not providing',
    `bot=${(r.botText || '').slice(0, 140)}`,
  );
  check(
    uniq.filter((l) => l.includes('any city')).length <= 1,
    'no duplicate Any City In Tamilnadu chips',
    `chips=${labels.join('|')}`,
  );
  check(
    r.step !== 'pick_type' || labels.some((l) => l.includes('bus semi')),
    'asks Bus Semi options or continues funnel (not empty option ask)',
    `step=${r.step} chips=${labels.join('|')}`,
  );
}

{
  // Kudiri / Venadu outside TN — library says not Tamil Nadu → never silent quote
  const outsideTn = {
    town: 'Kudiri',
    district: null,
    state: 'Andhra Pradesh',
    country: 'India',
    confidence: 0.9,
  };
  const tnDb = [
    svc('bus-semi-tn', 'Bus Semi Branding', 'Any City In Tamilnadu', 300),
    svc('bus-wrap-tn', 'Bus Semi Wrap', 'Any City In Tamilnadu', 300),
  ];
  const r = resolveProgressiveText(
    'bus semi in kudiri',
    tnDb,
    { originalText: 'bus semi in kudiri', qty: null, resolvedLocation: outsideTn },
    { resolvedLocation: outsideTn },
  );
  check(
    r.step !== 'quote_ready' && !(r.quoteRows && r.quoteRows.length > 0),
    'Kudiri outside TN does not silent-quote',
    `step=${r.step} rows=${(r.quoteRows || []).length}`,
  );
  check(
    /not providing/i.test(r.botText || ''),
    'Kudiri outside TN says Not providing',
    `bot=${(r.botText || '').slice(0, 140)}`,
  );
  check(
    canonicalizeServiceName(r.session.city || '') !== 'any city in tamilnadu'
    || r.step === 'pick_city',
    'does not auto-lock Any City In Tamilnadu into active city without ask',
    `step=${r.step} city=${r.session.city || '(none)'}`,
  );

  const venadu = {
    town: 'Venadu',
    district: null,
    state: 'Kerala',
    country: 'India',
    confidence: 0.85,
  };
  const r2 = resolveProgressiveText(
    'can you give me a quote for bus semi in venadu',
    tnDb,
    { originalText: 'can you give me a quote for bus semi in venadu', qty: null, resolvedLocation: venadu },
    { resolvedLocation: venadu },
  );
  check(
    r2.step !== 'quote_ready' && !(r2.quoteRows && r2.quoteRows.length > 0),
    'Venadu outside TN does not silent-quote',
    `step=${r2.step} rows=${(r2.quoteRows || []).length}`,
  );
  check(
    /not providing/i.test(r2.botText || ''),
    'Venadu outside TN says Not providing',
    `bot=${(r2.botText || '').slice(0, 140)}`,
  );
}

if (failed) {
  console.log(`\n${failed} failed\n`);
  process.exit(1);
}
console.log('\nAll exact-segment batch checks passed.\n');
