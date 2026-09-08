/**
 * Phase 2 — parseMessage validates batch segments against DB catalog.
 * Run: npx vite-node src/chat/parseIntent.test.ts
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

const { loadProgressiveTestCatalog } = await import('../utils/progressiveChat.testCatalog');
const { parseMessage } = await import('./parseIntent');
const { canonicalizeServiceName } = await import('../utils/serviceNameUtils');

const catalog = await loadProgressiveTestCatalog();
const services = catalog.services;
const L = catalog.labels;

function same(a: string | null | undefined, b: string): boolean {
  return canonicalizeServiceName(a || '') === canonicalizeServiceName(b);
}

const failures: string[] = [];
function check(cond: boolean, msg: string) {
  if (!cond) failures.push(msg);
}

// Mixed-city batch — local path (skip AI)
const mixed = await parseMessage('cab madurai and auto in chennai', null, services, {
  skipAi: true,
});
check(mixed.segments.length === 2, `expected 2 segments, got ${mixed.segments.length}`);
check(
  mixed.segments.some((s) => same(s.service, 'cab') && same(s.city, L.madurai)),
  `cab→Madurai segment missing: ${JSON.stringify(mixed.segments)}`,
);
check(
  mixed.segments.some((s) => same(s.service, 'auto') && same(s.city, L.chennai)),
  `auto→Chennai segment missing: ${JSON.stringify(mixed.segments)}`,
);

// Greeting — local
const hi = await parseMessage('hi', null, services, { skipAi: true });
check(hi.kind === 'greeting', `hi kind=${hi.kind}`);

// Simple media — local
const bus = await parseMessage('bus', null, services, { skipAi: true });
check(bus.kind === 'quote' && bus.segments.length === 1, `bus segments=${bus.segments.length}`);
check(
  bus.segments[0]?.service != null && canonicalizeServiceName(bus.segments[0].service!).includes('bus'),
  `bus service=${bus.segments[0]?.service}`,
);

if (failures.length) {
  console.log('FAIL parseIntent.test.ts');
  for (const f of failures) console.log(`  ASSERT: ${f}`);
  process.exit(1);
}

console.log('All parseIntent checks passed.');
