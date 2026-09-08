/**
 * Mobile Van LED + Non LED in a multi-service batch must:
 * 1) Ask which Mobile Van option(s) when the user says bare "mobile van"
 * 2) Keep BOTH selected variants after Confirm
 * 3) Continue to Awareness (workQueue) — never jump to quote with only LED
 *
 * Run: npx vite-node src/utils/progressiveChat.mobileVanBatch.test.ts
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

const {
  continueProgressiveAction,
  resolveProgressiveText,
} = await import('../chat/index');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type ProgressiveTurnResult = import('../chat/index').ProgressiveTurnResult;
type DbService = import('./serviceResolver').DbService;

function svc(
  id: string,
  medium: string,
  city: string,
  extras?: { display_price?: number; medium_type?: string },
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
      pricing: {
        display_price: extras?.display_price ?? 1000,
        structure: 'display',
      },
      ...(extras?.medium_type ? { medium_type: extras.medium_type } : {}),
    },
  } as DbService;
}

const DB: DbService[] = [
  svc('mv-led', 'Mobile Van – LED', 'Chennai', { display_price: 5000 }),
  svc('mv-led-hyphen', 'Mobile Van - LED', 'Chennai', { display_price: 5000 }),
  svc('mv-non', 'Mobile Van –Non LED', 'Chennai', { display_price: 4000 }),
  svc('mv-non-cbe', 'Mobile Van –Non LED', 'Coimbatore', { display_price: 4000 }),
  svc('mv-led-cbe', 'Mobile Van – LED', 'Coimbatore', { display_price: 5000 }),
  svc('aw-1', 'Awareness', 'Chennai', { display_price: 2000 }),
  svc('aw-2', 'Awareness', 'Coimbatore', { display_price: 2000 }),
];

let failed = 0;
function check(cond: boolean, name: string, detail = ''): void {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function rowKeysOf(r: ProgressiveTurnResult): string[] {
  const rows = r.quoteRows || r.session.collectedRows || r.session.pendingRows || [];
  return rows.map((row) => canonicalizeServiceName(String(row.service || '')));
}

console.log('\n=== Mobile Van batch multi-select ===\n');

{
  const r = resolveProgressiveText('mobile van and awarness', DB, null, null);
  const labels = (r.options || []).map((o) => canonicalizeServiceName(o.label));
  const uniqueCanon = [...new Set(labels)];
  check(r.step === 'pick_type', 'bare mobile van asks which option', `step=${r.step}`);
  check(
    !/\bin\s+chennai\b/i.test(r.botText || ''),
    'does not auto-lock Chennai when Mobile Van has multiple DB cities',
    `bot=${(r.botText || '').slice(0, 120)} city=${r.session.city || '(none)'}`,
  );
  check(!r.session.city, 'city stays unlocked until after type when 2+ DB cities', `city=${r.session.city}`);
  check(
    labels.some((l) => /\bled\b/.test(l) && !/\bnon\s+led\b/.test(l)),
    'options include Mobile Van LED',
    `labels=${labels.join('|')}`,
  );
  check(
    labels.some((l) => /\bnon\s+led\b/.test(l)),
    'options include Mobile Van Non LED',
    `labels=${labels.join('|')}`,
  );
  check(
    labels.length === uniqueCanon.length,
    'no duplicate Mobile Van chips (dash/case variants collapsed)',
    `labels=${(r.options || []).map((o) => o.label).join('|')}`,
  );
  check(uniqueCanon.length === 2, 'exactly two Mobile Van options', `n=${uniqueCanon.length}`);
  check(
    (r.session.workQueue || []).some((w) =>
      canonicalizeServiceName(w.medium || w.browseToken || '').includes('awareness'),
    ),
    'Awareness stays on workQueue while asking Mobile Van',
    `queue=${(r.session.workQueue || []).map((w) => w.medium).join('|')}`,
  );

  const ids = (r.options || [])
    .filter((o) => /van/i.test(o.label) || /van/i.test(o.medium || ''))
    .map((o) => o.id);
  check(ids.length >= 2, 'at least two Mobile Van chips to confirm', `ids=${ids.join(',')}`);

  if (ids.length >= 2) {
    const confirmed = continueProgressiveAction(ids[0]!, r.session, DB, ids);
    const keys = rowKeysOf(confirmed);
    const hasLed = keys.some((k) => /\bled\b/.test(k) && !/\bnon\s+led\b/.test(k));
    const hasNon = keys.some((k) => /\bnon\s+led\b/.test(k));
    const askingCity = confirmed.step === 'pick_city';
    const queueHasAwareness = (confirmed.session.workQueue || []).some((w) =>
      canonicalizeServiceName(w.medium || w.browseToken || '').includes('awareness'),
    );
    const askingAwareness =
      canonicalizeServiceName(
        confirmed.session.medium || confirmed.session.browseToken || '',
      ).includes('awareness')
      || /awareness/i.test(confirmed.botText || '');

    check(hasLed || askingCity, 'confirm both keeps LED (or asks city next)', `step=${confirmed.step} rows=${keys.join('|')}`);
    check(hasNon || askingCity, 'confirm both keeps Non LED (or asks city next)', `step=${confirmed.step} rows=${keys.join('|')}`);
    check(
      askingCity || queueHasAwareness || askingAwareness || confirmed.step !== 'quote_ready',
      'after both vans, ask city or continue Awareness (do not silent quote)',
      `step=${confirmed.step} bot=${(confirmed.botText || '').slice(0, 80)} queue=${(confirmed.session.workQueue || []).map((w) => w.medium).join('|')}`,
    );
  }
}

if (failed) {
  console.log(`\n${failed} failed\n`);
  process.exit(1);
}
console.log('\nAll mobile van batch checks passed.\n');
