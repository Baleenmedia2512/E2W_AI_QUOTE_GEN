/**
 * Temporary debug helper — delete when test gate is green.
 * Run: npx vite-node src/utils/progressiveChat.debugFailures.ts
 */
const { loadProgressiveTestCatalog } = await import('./progressiveChat.testCatalog');
const {
  resolveProgressiveText,
  detectDirectionInText,
  filterPoolBySession,
} = await import('../chat/index');
const { canonicalizeServiceName } = await import('./serviceNameUtils');

const catalog = await loadProgressiveTestCatalog();
const DB = catalog.services;
const F = catalog.labels;

const semiRows = DB.filter((s) =>
  canonicalizeServiceName(s.metadata?.medium || s.service_name || '').includes('semi')
  && canonicalizeServiceName(s.metadata?.medium || s.service_name || '').includes('bus'),
);
console.log('bus semi rows:', semiRows.map((s) => ({
  id: s.service_id,
  medium: s.metadata?.medium,
  city: s.metadata?.city,
  area: s.metadata?.area_name,
})));

for (const q of ['bus semi in madurai', 'bus semi in madurai and chennai', 'bus semi']) {
  const r = resolveProgressiveText(q, DB);
  console.log('\nQ:', q);
  console.log(' step:', r.step, 'city:', r.session.city);
  console.log(' bot:', (r.botText || '').slice(0, 100));
}

const prior = {
  originalText: 'hoarding chennai omr',
  medium: 'hoarding',
  browseToken: 'hoarding',
  mediumType: 'frontlit',
  typesResolved: true,
  city: F.chennai,
  area: F.omr,
  placeHint: F.omr,
};
const pool = filterPoolBySession(DB, { ...prior, directionHint: undefined });
const dirHit = detectDirectionInText('navalur', pool, { preferArea: F.omr });
console.log('\nnavalur dir in OMR pool:', dirHit?.phrase);
console.log('OMR area label:', F.omr);

const r28 = resolveProgressiveText('give me a quote for navalur', DB, prior);
console.log('\nTEST28 step:', r28.step);
console.log(' area:', r28.session.area, 'dir:', r28.session.directionHint);
console.log(' bot:', r28.botText);
