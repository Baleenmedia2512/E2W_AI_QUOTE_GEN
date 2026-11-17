/**
 * City-package LED (no real site direction) must appear beside street sites.
 *
 * Run:
 *   npx vite-node src/utils/progressiveChat.cityPackage.test.ts
 */

/** Node has no localStorage; chatbot import chain needs a stub. */
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
  advanceFunnel,
  continueProgressiveAction,
  hasRealSiteDirection,
} = await import('./progressiveChatEngine');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type ProgressiveSession = import('./progressiveChatEngine').ProgressiveSession;
type DbService = import('./serviceResolver').DbService;

function svc(
  id: string,
  meta: Record<string, unknown>,
): DbService {
  return {
    service_id: id,
    service_name: String(meta.medium || 'LED HOARDINGS'),
    content: String(meta.medium || 'LED HOARDINGS'),
    document_name: 'test',
    metadata: {
      ...meta,
      pricing: {
        display_unit_price_per_day: meta.display_unit_price_per_day ?? 2000,
        display_price: meta.display_price ?? 2000,
        ...(typeof meta.pricing === 'object' && meta.pricing ? meta.pricing as object : {}),
      },
      locations: meta.city ? [String(meta.city)] : [],
    },
  };
}

const packageRow = svc('led-pkg-chennai', {
  medium: 'LED HOARDINGS',
  city: 'Chennai',
  area: 'chennai',
  area_name: 'NA',
  direction_remarks: 'chennai',
  display_unit_price_per_day: 1833.3,
  min_days: 10,
});

// Real LED inventory often has blank area_name — only direction_remarks.
const siteA = svc('led-site-gemini', {
  medium: 'LED HOARDINGS',
  city: 'Chennai',
  area_name: 'NA',
  direction_remarks: 'Gemini Flyover Towards Teynampet/Guindy',
  display_unit_price_per_day: 2500,
  min_days: 10,
});

const siteB = svc('led-site-vadapalani', {
  medium: 'LED HOARDINGS',
  city: 'Chennai',
  area_name: 'NA',
  direction_remarks: 'Vadapalani Signal Near Forum Mall Towards Kodambakkam',
  display_unit_price_per_day: 2200,
  min_days: 10,
});

const DB = [packageRow, siteA, siteB];

let failed = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

check(!hasRealSiteDirection(packageRow), 'package row is not a real site direction');
check(hasRealSiteDirection(siteA), 'Gemini row is a real site');
check(hasRealSiteDirection(siteB), 'Vadapalani row is a real site');

// Real bug: candidateServiceIds lists only street sites — package id omitted.
const session: ProgressiveSession = {
  originalText: 'led hoarding chennai',
  medium: canonicalizeServiceName('LED HOARDINGS'),
  browseToken: canonicalizeServiceName('LED HOARDINGS'),
  typesResolved: true,
  city: 'Chennai',
  qty: null,
  candidateServiceIds: [siteA.service_id, siteB.service_id],
};

const turn = advanceFunnel(session, DB);
check(turn.step === 'pick_direction', `step pick_direction, got ${turn.step}`);
check((turn.options || []).length >= 3, `options >= 3 (pkg + 2 sites), got ${(turn.options || []).length}`);

const labels = (turn.options || []).map((o) => o.label);
const hasPkg = labels.some((l) => {
  const k = canonicalizeServiceName(l);
  return k.includes('led hoarding') && k.includes('chennai');
});
check(hasPkg, `city package chip present among: ${labels.join(' | ')}`);
check(
  labels.some((l) => /gemini/i.test(l)),
  'Gemini site chip present',
);
check(
  labels.some((l) => /vadapalani/i.test(l)),
  'Vadapalani site chip present',
);
check(
  !labels.some((l) => canonicalizeServiceName(l) === 'chennai'),
  'raw "chennai" fake direction chip must not appear',
);

const pkgOpt = (turn.options || []).find((o) => o.serviceId === packageRow.service_id);
check(!!pkgOpt, 'package option has package service_id');

if (pkgOpt) {
  const quoted = continueProgressiveAction(
    `direction:${packageRow.service_id}`,
    turn.session,
    DB,
    [pkgOpt.id],
  );
  check(
    quoted.step === 'quote_ready'
      || quoted.step === 'min_qty_confirm'
      || quoted.step === 'confirm_selection',
    `picking package advances to quote-ish step, got ${quoted.step}`,
  );
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll city-package checks passed.');
