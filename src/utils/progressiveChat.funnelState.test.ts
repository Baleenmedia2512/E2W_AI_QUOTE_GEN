/**
 * Progressive chat funnel state suite (Tests 1–27).
 *
 * Inventory labels come from the real vendor_rate_chunks catalog (no hardcoded fixture DB).
 *
 * Run (manually):
 *   npx vite-node src/utils/progressiveChat.funnelState.test.ts
 *
 * Multi-service / multi-city batch suite:
 *   npx vite-node src/utils/progressiveChat.multiServiceCity.test.ts
 */

const { loadProgressiveTestCatalog } = await import('./progressiveChat.testCatalog');
const {
  resolveProgressiveText,
  continueProgressiveAction,
  matchFreeTextToProgressiveOption,
  detectLocalityInText,
  detectDirectionInText,
  getMediumKey,
} = await import('./progressiveChatEngine');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type ProgressiveSession = import('./progressiveChatEngine').ProgressiveSession;
type ProgressiveTurnResult = import('./progressiveChatEngine').ProgressiveTurnResult;
type ProgressiveOption = import('./progressiveChatEngine').ProgressiveOption;
type DbService = import('./serviceResolver').DbService;

const catalog = await loadProgressiveTestCatalog();
const DB: DbService[] = catalog.services;
const L = catalog.labels;

function needDb(value: string | null | undefined, what: string): string {
  const v = (value || '').trim();
  if (!v) throw new Error(`funnelState tests: required DB label missing: ${what}`);
  return v;
}

/** Labels discovered from real DB only — never invent display strings. */
const F = {
  hoarding: L.hoarding,
  frontlit: L.frontlit,
  nonlit: L.nonlit,
  busFamily: L.busFamily,
  busSemi: L.busSemi,
  policeBooth: L.policeBooth,
  apartmentLift: L.apartmentLift,
  apartmentLobby: L.apartmentLobby,
  chennai: L.chennai,
  tirupathi: needDb(L.tirupathi, 'city Tirupathi/Tirupati for hoarding'),
  chittoor: needDb(L.chittoor, 'city Chittoor for hoarding'),
  ecrRoad: L.ecrRoad,
  omr: L.omr,
  locEcr: L.locEcr,
  locOmrA: L.locOmrA,
  locOmrB: L.locOmrB,
  locOmrC: L.locOmrC,
  locPoliceOmr: L.locPoliceOmr,
  locBusChennai: L.locBusChennai,
  locTirupathi: L.locTirupathi,
  locChittoor: L.locChittoor,
  geminiFlyOver: L.geminiLabel,
  geminiArea: L.geminiIsArea ? L.geminiLabel : L.multiSiteArea,
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function same(a: string | undefined | null, b: string): boolean {
  return canonicalizeServiceName(a || '') === canonicalizeServiceName(b);
}

function mediumOf(s: ProgressiveSession): string {
  return s.medium || s.browseToken || '';
}

function sessionHoardingAt(
  area: string,
  location: string | null,
  extras?: Partial<ProgressiveSession>,
): ProgressiveSession {
  return {
    originalText: `${F.hoarding} ${F.chennai} ${area}`,
    medium: canonicalizeServiceName(F.hoarding),
    browseToken: canonicalizeServiceName(F.hoarding),
    mediumType: canonicalizeServiceName(F.frontlit),
    typesResolved: true,
    city: F.chennai,
    area,
    placeHint: area,
    directionHint: location || undefined,
    qty: null,
    candidateServiceIds: location
      ? DB.filter(
        (r) =>
          same(String((r.metadata as { direction_remarks?: string })?.direction_remarks || ''), location),
      ).map((r) => r.service_id)
      : undefined,
    ...extras,
  };
}

function text(
  userText: string,
  prior: ProgressiveSession | null,
): ProgressiveTurnResult {
  return resolveProgressiveText(userText, DB, prior, null);
}

function optionLabels(r: ProgressiveTurnResult): string[] {
  return (r.options || []).map((o) => o.label);
}

function optionsMention(r: ProgressiveTurnResult, needle: string): boolean {
  const n = canonicalizeServiceName(needle);
  return optionLabels(r).some((lab) => canonicalizeServiceName(lab).includes(n))
    || (r.options || []).some(
      (o) =>
        (o.medium && canonicalizeServiceName(o.medium).includes(n))
        || (o.mediumType && canonicalizeServiceName(o.mediumType).includes(n)),
    );
}

type CheckFn = (cond: boolean, msg: string) => void;

const failedCaseNames: string[] = [];

function runCase(name: string, body: (check: CheckFn) => void): boolean {
  const failures: string[] = [];
  const check: CheckFn = (cond, msg) => {
    if (!cond) failures.push(msg);
  };
  try {
    body(check);
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
  }
  if (failures.length) {
    console.log(`FAIL  ${name}`);
    for (const f of failures) console.log(`  ASSERT: ${f}`);
    failedCaseNames.push(name);
    return false;
  }
  console.log(`PASS  ${name}`);
  return true;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

const results: boolean[] = [];

results.push(runCase(
  'TEST 1 — Area change inside active service (OMR keeps Hoarding)',
  (check) => {
    const prior = sessionHoardingAt(F.ecrRoad, F.locEcr);
    const r = text(F.omr, prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept: got ${mediumOf(s)}`);
    check(same(s.mediumType, F.frontlit), `mediumType kept: got ${s.mediumType}`);
    check(same(s.city, F.chennai), `city kept: got ${s.city}`);
    check(same(s.area || s.placeHint, F.omr), `area → OMR: got ${s.area}/${s.placeHint}`);
    check(!s.directionHint, `location cleared: got ${s.directionHint}`);
    check(r.step === 'pick_direction', `next step pick_direction: got ${r.step}`);
    check(!optionsMention(r, F.policeBooth), `must not show Police Booth; opts=${optionLabels(r).join('|')}`);
    check(
      (r.options?.length || 0) >= 1
      && optionLabels(r).some((l) => /omr/i.test(l)),
      `Hoarding OMR locations expected; opts=${optionLabels(r).join('|')}`,
    );
  },
));

results.push(runCase(
  'TEST 2 — Change area with ecr / near ecr (not stuck on OMR)',
  (check) => {
    const prior = sessionHoardingAt(F.omr, F.locOmrA);

    // Bare shorthand
    const aliasHit = detectLocalityInText('ecr', DB);
    const nearHit = detectLocalityInText('near ecr', DB);
    check(
      !!aliasHit && same(aliasHit, F.ecrRoad),
      `detectLocality "ecr" → ECR Road: got ${aliasHit}`,
    );
    check(
      !!nearHit && same(nearHit, F.ecrRoad),
      `detectLocality "near ecr" → ECR Road: got ${nearHit}`,
    );

    const rNear = text('near ecr', prior);
    const sNear = rNear.session;
    check(same(mediumOf(sNear), F.hoarding), `near ecr: service kept`);
    check(same(sNear.mediumType, F.frontlit), `near ecr: type kept`);
    check(same(sNear.city, F.chennai), `near ecr: city kept`);
    check(
      same(sNear.area || sNear.placeHint, F.ecrRoad),
      `near ecr: area → ECR Road: got ${sNear.area}/${sNear.placeHint}`,
    );
    check(!sNear.directionHint, `near ecr: old OMR direction cleared`);
    check(
      rNear.step === 'pick_direction'
      || rNear.step === 'quote_ready'
      || rNear.step === 'min_qty_confirm',
      `near ecr: stay in Hoarding ECR funnel; step=${rNear.step}`,
    );
    check(
      !optionLabels(rNear).some((l) => /sholinganallur|siruseri/i.test(l)),
      `near ecr: must not keep OMR site chips; opts=${optionLabels(rNear).join('|')}`,
    );

    // Also bare ecr from OMR
    const r = text('ecr', sessionHoardingAt(F.omr, F.locOmrA));
    const s = r.session;
    check(same(s.area || s.placeHint, F.ecrRoad), `ecr: area → ECR Road: got ${s.area}`);
    check(!s.directionHint, `ecr: direction cleared`);
  },
));

results.push(runCase(
  'TEST 3 — Switch from Hoarding to Bus clears dependent state',
  (check) => {
    const prior = sessionHoardingAt(F.ecrRoad, F.locEcr);
    const r = text('bus', prior);
    const s = r.session;
    const med = mediumOf(s);
    check(
      canonicalizeServiceName(med).includes('bus'),
      `service → bus family: got ${med}`,
    );
    check(!same(med, F.hoarding), `must not stay hoarding`);
    check(!s.mediumType || !same(s.mediumType, F.frontlit), `old Frontlit cleared: got ${s.mediumType}`);
    check(!s.city, `city cleared: got ${s.city}`);
    check(!s.area && !s.placeHint, `area cleared: got ${s.area}/${s.placeHint}`);
    check(!s.directionHint, `location cleared: got ${s.directionHint}`);
  },
));

results.push(runCase(
  'TEST 4 — Same service echo continues (city step + mid-funnel)',
  (check) => {
    // Phase A: Frontlit locked, city NOT chosen — typing "hoarding" must re-ask cities
    const priorAtCity: ProgressiveSession = {
      originalText: F.hoarding,
      medium: canonicalizeServiceName(F.hoarding),
      browseToken: canonicalizeServiceName(F.hoarding),
      mediumType: canonicalizeServiceName(F.frontlit),
      typesResolved: true,
      city: undefined,
      area: undefined,
      placeHint: undefined,
      directionHint: undefined,
      qty: null,
    };
    const rCity = text('hoarding', priorAtCity);
    const sCity = rCity.session;
    check(same(mediumOf(sCity), F.hoarding), `A: service kept: got ${mediumOf(sCity)}`);
    check(same(sCity.mediumType, F.frontlit), `A: Frontlit kept: got ${sCity.mediumType}`);
    check(
      rCity.step === 'pick_city',
      `A: must ask city again (not areas); step=${rCity.step} text=${rCity.botText}`,
    );
    check(rCity.step !== 'pick_area', `A: must not jump to area chips`);
    check(rCity.step !== 'pick_type', `A: must not re-ask Frontlit/Nonlit`);
    check(
      !sCity.city
      || optionLabels(rCity).some((l) => same(l, F.chennai)),
      `A: city still open or city chips include Chennai; city=${sCity.city} opts=${optionLabels(rCity).join('|')}`,
    );
    check(
      optionsMention(rCity, F.chennai)
      && optionsMention(rCity, F.tirupathi)
      && optionsMention(rCity, F.chittoor),
      `A: city chips must list all Frontlit cities; opts=${optionLabels(rCity).join('|')}`,
    );

    // Phase B: mid-funnel with area locked — typing "hoarding" keeps locks, goes to sites
    const priorOmr = sessionHoardingAt(F.omr, null);
    const rOmr = text('hoarding', priorOmr);
    const sOmr = rOmr.session;
    check(same(sOmr.mediumType, F.frontlit), `B: Frontlit kept: got ${sOmr.mediumType}`);
    check(same(sOmr.city, F.chennai), `B: city kept: got ${sOmr.city}`);
    check(same(sOmr.area || sOmr.placeHint, F.omr), `B: area kept: got ${sOmr.area}`);
    check(
      rOmr.step === 'pick_direction'
      || rOmr.step === 'quote_ready'
      || rOmr.step === 'min_qty_confirm',
      `B: continue site/quote step; step=${rOmr.step}`,
    );
    check(rOmr.step !== 'pick_type', `B: must not re-ask type`);
  },
));

results.push(runCase(
  'TEST 5 — Change Hoarding type Frontlit → Nonlit',
  (check) => {
    const prior = sessionHoardingAt(F.ecrRoad, F.locEcr);
    // Typed type label path = chip match → continueProgressiveAction (ChatInterface)
    const typeOpts: ProgressiveOption[] = [
      {
        id: `medium:${canonicalizeServiceName(F.hoarding)}|${canonicalizeServiceName(F.frontlit)}`,
        label: F.frontlit,
        medium: F.hoarding,
        mediumType: F.frontlit,
      },
      {
        id: `medium:${canonicalizeServiceName(F.hoarding)}|${canonicalizeServiceName(F.nonlit)}`,
        label: F.nonlit,
        medium: F.hoarding,
        mediumType: F.nonlit,
      },
    ];
    const matched = matchFreeTextToProgressiveOption(F.nonlit, typeOpts);
    check(!!matched, `Nonlit must match a type chip`);
    const r = continueProgressiveAction(matched!.id, prior, DB);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept hoarding`);
    check(same(s.mediumType, F.nonlit), `mediumType → nonlit: got ${s.mediumType}`);
    check(same(s.city, F.chennai), `city kept: got ${s.city}`);
    check(
      !s.directionHint || !same(s.directionHint, F.locEcr),
      `old Frontlit ECR location must not remain: got ${s.directionHint}`,
    );
  },
));

results.push(runCase(
  'TEST 6 — Change city to Tirupathi clears area/location',
  (check) => {
    const prior = sessionHoardingAt(F.ecrRoad, F.locEcr);
    const r = text(F.tirupathi, prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept: got ${mediumOf(s)}`);
    check(same(s.mediumType, F.frontlit), `mediumType kept: got ${s.mediumType}`);
    check(same(s.city, F.tirupathi), `city → Tirupathi: got ${s.city}`);
    // Old Chennai area/direction must not remain. Live DB may auto-lock sole Tirupathi area
    // (sometimes stored as the city label itself).
    check(!same(s.area, F.ecrRoad) && !same(s.placeHint, F.ecrRoad), `must not keep ECR Road`);
    const tirAreas = catalog.areasForMediumCity(F.hoarding, F.tirupathi);
    check(
      !s.area && !s.placeHint
      || tirAreas.some((a) => same(s.area || s.placeHint || '', a))
      || same(s.area || s.placeHint || '', F.tirupathi),
      `area cleared or Tirupathi catalog area auto-lock: got ${s.area}/${s.placeHint}`,
    );
    check(!s.directionHint, `location cleared: got ${s.directionHint}`);
    check(!same(s.directionHint, F.locEcr), `old ECR direction must not remain`);
  },
));

results.push(runCase(
  'TEST 7 — Change city to Chittoor clears area/location',
  (check) => {
    const prior = sessionHoardingAt(F.omr, F.locOmrA);
    const r = text(F.chittoor, prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept: got ${mediumOf(s)}`);
    check(same(s.mediumType, F.frontlit), `mediumType kept: got ${s.mediumType}`);
    check(same(s.city, F.chittoor), `city → Chittoor: got ${s.city}`);
    // Old Chennai OMR must not remain. Live DB may auto-lock sole Chittoor area.
    check(!same(s.area, F.omr) && !same(s.placeHint, F.omr), `must not keep OMR`);
    const chiAreas = catalog.areasForMediumCity(F.hoarding, F.chittoor);
    check(
      !s.area && !s.placeHint
      || chiAreas.some((a) => same(s.area || s.placeHint || '', a))
      || same(s.area || s.placeHint || '', F.chittoor),
      `area cleared or Chittoor catalog area auto-lock: got ${s.area}/${s.placeHint}`,
    );
    check(!s.directionHint, `location cleared: got ${s.directionHint}`);
    check(!same(s.directionHint, F.locOmrA), `old OMR direction must not remain`);
  },
));

results.push(runCase(
  'TEST 8 — Area entered without an active service (general area search)',
  (check) => {
    const r = text(F.omr, null);
    const s = r.session;
    check(!s.medium && !s.browseToken, `no service lock yet: got ${mediumOf(s)}`);
    check(
      r.step === 'pick_type' || (r.options?.length || 0) >= 1,
      `should list services near OMR; step=${r.step} opts=${optionLabels(r).join('|')}`,
    );
    check(optionsMention(r, F.hoarding), `Hoarding available near OMR`);
    check(optionsMention(r, F.policeBooth), `Police Booth available near OMR`);
  },
));

results.push(runCase(
  'TEST 9 — Area change while Hoarding is active (no general services browse)',
  (check) => {
    const prior = sessionHoardingAt(F.ecrRoad, null);
    const r = text(F.omr, prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept`);
    check(same(s.mediumType, F.frontlit), `mediumType kept`);
    check(same(s.city, F.chennai), `city kept`);
    check(same(s.area || s.placeHint, F.omr), `area → OMR`);
    check(!optionsMention(r, F.policeBooth), `must not return Police Booth service chips`);
    check(
      r.step === 'pick_direction' || r.step === 'pick_area' || r.step === 'quote_ready' || r.step === 'min_qty_confirm',
      `stay in Hoarding funnel (not place service browse); step=${r.step}`,
    );
    check(
      r.step !== 'pick_type' || !optionsMention(r, F.policeBooth),
      `must not be general OMR service picker with Police Booth`,
    );
  },
));

results.push(runCase(
  'TEST 10 — Switch to Police Booth is a new service',
  (check) => {
    const prior = sessionHoardingAt(F.omr, F.locOmrA);
    const r = text(F.policeBooth, prior);
    const s = r.session;
    check(same(mediumOf(s), F.policeBooth), `service → Police Booth: got ${mediumOf(s)}`);
    check(!same(mediumOf(s), F.hoarding), `must leave Hoarding`);
    check(
      !s.mediumType || !same(s.mediumType, F.frontlit),
      `old Frontlit must not remain: got ${s.mediumType}`,
    );
    check(
      !s.directionHint || !same(s.directionHint, F.locOmrA),
      `old Hoarding location cleared: got ${s.directionHint}`,
    );
    // New service: keep city only when message supplied it, or single-city auto-lock
    // (Police Booth only in Chennai). Never require city to be null after switch.
    check(
      !s.city
      || same(s.city, F.chennai),
      `city cleared or single-city auto-lock Chennai: got ${s.city}`,
    );
    check(
      !s.area || !same(s.area, F.omr),
      `old Hoarding OMR area must not remain: got ${s.area}/${s.placeHint}`,
    );
  },
));

results.push(runCase(
  'TEST 11 — Switch from Hoarding to Bus using sentence clears dependents',
  (check) => {
    const prior = sessionHoardingAt(F.omr, null);
    const r = text('I need bus advertising', prior);
    const s = r.session;
    check(
      canonicalizeServiceName(mediumOf(s)).includes('bus'),
      `service → bus: got ${mediumOf(s)}`,
    );
    check(!same(mediumOf(s), F.hoarding), `Hoarding must not remain active`);
    check(
      !s.mediumType || !same(s.mediumType, F.frontlit),
      `old Frontlit cleared: got ${s.mediumType}`,
    );
    check(!s.city, `city cleared on service switch: got ${s.city}`);
    check(!s.area && !s.placeHint, `area cleared on service switch: got ${s.area}/${s.placeHint}`);
    check(!s.directionHint, `direction cleared on service switch: got ${s.directionHint}`);
  },
));

results.push(runCase(
  'TEST 12 — Combined message extracts service + city + area and skips those asks',
  (check) => {
    const r = text('I need hoarding in Chennai OMR', null);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service = hoarding: got ${mediumOf(s)}`);
    check(same(s.city, F.chennai), `city = Chennai: got ${s.city}`);
    check(same(s.area || s.placeHint, F.omr), `area = OMR: got ${s.area}/${s.placeHint}`);
    const ask = (r.botText || '').toLowerCase();
    check(!/which (advertising )?service/i.test(ask), `must not re-ask service: ${r.botText}`);
    check(!/which city/i.test(ask), `must not re-ask city: ${r.botText}`);
    check(!/which area/i.test(ask), `must not re-ask area: ${r.botText}`);
    check(
      r.step === 'pick_type'
      || r.step === 'pick_direction'
      || r.step === 'quote_ready'
      || r.step === 'min_qty_confirm'
      || r.step === 'did_you_mean',
      `continue from next missing step; step=${r.step}`,
    );
    check(r.step !== 'pick_city', `city already known — not pick_city; step=${r.step}`);
  },
));

results.push(runCase(
  'TEST 13 — Combined message extracts service + type + city + area',
  (check) => {
    const r = text('I need frontlit hoarding in Chennai OMR', null);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service = hoarding: got ${mediumOf(s)}`);
    check(same(s.city, F.chennai), `city = Chennai: got ${s.city}`);
    check(same(s.area || s.placeHint, F.omr), `area = OMR: got ${s.area}/${s.placeHint}`);
    check(
      same(s.mediumType, F.frontlit) || s.typesResolved === true,
      `mediumType frontlit locked or types resolved: mediumType=${s.mediumType} typesResolved=${s.typesResolved}`,
    );
    const ask = (r.botText || '').toLowerCase();
    check(!/which (advertising )?service/i.test(ask), `must not re-ask service`);
    check(!/which city/i.test(ask), `must not re-ask city`);
    check(r.step !== 'pick_city', `should not ask city again; step=${r.step}`);
    check(!optionsMention(r, F.policeBooth), `must not browse unrelated services`);
  },
));

results.push(runCase(
  'TEST 14 — Direction remark is not an area (Gemini Fly Over)',
  (check) => {
    if (!F.geminiFlyOver) {
      check(true, 'skip — no Gemini label in DB');
      return;
    }
    const gemini = F.geminiFlyOver;
    const r = text('I need hoarding in Chennai near Gemini Fly Over', null);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service = hoarding: got ${mediumOf(s)}`);
    check(same(s.city, F.chennai), `city = Chennai: got ${s.city}`);

    // Live catalog: Gemini Flyover is area_name → area lock is correct.
    // If it were only direction_remarks → must NOT become area.
    if (L.geminiIsArea) {
      check(
        same(s.area || s.placeHint || '', gemini)
        || /gemini/i.test(s.area || s.placeHint || ''),
        `DB area_name Gemini may lock as area; got ${s.area}/${s.placeHint}`,
      );
    } else {
      check(
        !same(s.area, gemini) && !same(s.placeHint, gemini),
        `Gemini must not be stored as area; area=${s.area} placeHint=${s.placeHint}`,
      );
    }
    check(
      !same(s.area, 'gemini') && !same(s.placeHint, 'gemini'),
      `must not invent partial area "gemini" alone`,
    );

    // When catalog direction matching supports the phrase, preserve it as location/direction
    const catalogDir = detectDirectionInText(gemini, DB)
      || detectDirectionInText('near Gemini Fly Over', DB);
    if (!L.geminiIsArea && catalogDir?.phrase) {
      const dirKey = canonicalizeServiceName(s.directionHint || '');
      const expectKey = canonicalizeServiceName(catalogDir.phrase);
      check(
        !!s.directionHint
        && (dirKey.includes(expectKey)
          || expectKey.includes(dirKey)
          || dirKey.includes('gemini')),
        `direction/remarks must preserve catalog match "${catalogDir.phrase}"; got ${s.directionHint}`,
      );
    } else if (!L.geminiIsArea) {
      check(
        !same(s.area, gemini),
        `without direction match, still must not invent Gemini as area`,
      );
    }

    const ask = (r.botText || '').toLowerCase();
    check(!/which (advertising )?service/i.test(ask), `must not re-ask service: ${r.botText}`);
    check(!/which city/i.test(ask), `must not re-ask city: ${r.botText}`);
    check(
      r.step !== 'quote_ready' || !!s.directionHint,
      `only quote when direction resolved; step=${r.step} direction=${s.directionHint}`,
    );
    check(!optionsMention(r, F.policeBooth), `must not return Police Booth for this Hoarding ask`);
  },
));

results.push(runCase(
  'TEST 15 — Invalid service xyz123',
  (check) => {
    const r = text('xyz123', null);
    const s = r.session;
    check(
      !same(mediumOf(s), 'xyz123'),
      `must not store xyz123 as medium: got ${mediumOf(s)}`,
    );
    check(
      r.step === 'no_match' || r.step === 'small_talk' || r.step === 'pick_type' || r.step === 'did_you_mean',
      `fallback/clarify step expected: got ${r.step}`,
    );
  },
));

results.push(runCase(
  'TEST 16 — Invalid area during active Hoarding flow',
  (check) => {
    const prior = sessionHoardingAt(F.ecrRoad, null);
    const r = text('abcdef123', prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept`);
    check(same(s.mediumType, F.frontlit), `mediumType kept`);
    check(same(s.city, F.chennai), `city kept`);
    check(
      same(s.area || s.placeHint, F.ecrRoad),
      `must not replace ECR Road with invalid area: got ${s.area}/${s.placeHint}`,
    );
    check(!same(s.area, 'abcdef123'), `invalid area not stored`);
  },
));

results.push(runCase(
  'TEST 17 — Empty / whitespace input does not reset session',
  (check) => {
    const prior = sessionHoardingAt(F.omr, null);
    const r = text('   ', prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept after blank: got ${mediumOf(s)}`);
    check(same(s.mediumType, F.frontlit), `mediumType kept: got ${s.mediumType}`);
    check(same(s.city, F.chennai), `city kept: got ${s.city}`);
    check(same(s.area || s.placeHint, F.omr), `area kept: got ${s.area}/${s.placeHint}`);
  },
));

results.push(runCase(
  'TEST 18 — Same area / short token must not steal direction chips',
  (check) => {
    if (!F.locOmrB) {
      check(true, 'skip — need 2+ OMR directions in DB');
      return;
    }
    const prior = sessionHoardingAt(F.omr, F.locOmrA);
    // Direction chips open (simulate OMR site list) — typing "omr" is area refine, not site pick
    const directionOpts: ProgressiveOption[] = [
      {
        id: `svc:h-omr-a`,
        label: F.locOmrA,
        serviceId: 'h-omr-a',
        medium: F.hoarding,
      },
      {
        id: `svc:h-omr-b`,
        label: F.locOmrB,
        serviceId: 'h-omr-b',
        medium: F.hoarding,
      },
    ];
    const matched = matchFreeTextToProgressiveOption(F.omr, directionOpts);
    check(
      !matched,
      `short "OMR" must not match long direction chip: got ${matched?.label}`,
    );

    // Same area again via text path keeps parent state, does not auto-quote away
    const r = text(F.omr, prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept`);
    check(same(s.mediumType, F.frontlit), `mediumType kept`);
    check(same(s.city, F.chennai), `city kept`);
    check(same(s.area || s.placeHint, F.omr), `area remains OMR`);
    check(!optionsMention(r, F.policeBooth), `must not general-search services near OMR`);
    check(
      r.step !== 'quote_ready' || !!s.directionHint,
      `must not auto-quote from bare OMR without site; step=${r.step}`,
    );
  },
));

results.push(runCase(
  'TEST 19 — Repeated area switching never leaks previous location',
  (check) => {
    let s = sessionHoardingAt(F.ecrRoad, F.locEcr);

    let r = text(F.omr, s);
    s = r.session;
    check(same(mediumOf(s), F.hoarding), `after OMR: service`);
    check(same(s.mediumType, F.frontlit), `after OMR: type`);
    check(same(s.city, F.chennai), `after OMR: city`);
    check(same(s.area || s.placeHint, F.omr), `after OMR: area`);
    check(!s.directionHint, `after OMR: location cleared (was ECR)`);
    check(!same(s.directionHint, F.locEcr), `ECR location must not leak`);

    r = text(F.ecrRoad, s);
    s = r.session;
    check(same(mediumOf(s), F.hoarding), `after ECR Road: service`);
    check(same(s.mediumType, F.frontlit), `after ECR Road: type`);
    check(same(s.city, F.chennai), `after ECR Road: city`);
    check(same(s.area || s.placeHint, F.ecrRoad), `after ECR Road: area`);
    check(!s.directionHint, `after ECR Road: location cleared (was OMR)`);
    check(!same(s.directionHint, F.locOmrA), `OMR location must not leak`);

    r = text(F.omr, s);
    s = r.session;
    check(same(mediumOf(s), F.hoarding), `final OMR: service`);
    check(same(s.mediumType, F.frontlit), `final OMR: type`);
    check(same(s.city, F.chennai), `final OMR: city`);
    check(same(s.area || s.placeHint, F.omr), `final OMR: area`);
    check(!s.directionHint, `final OMR: location null until selected`);
    check(!same(s.directionHint, F.locEcr), `final: no ECR location leak`);
  },
));

results.push(runCase(
  'TEST 20 — Switch service after location stage clears Hoarding state',
  (check) => {
    const prior = sessionHoardingAt(F.omr, F.locOmrA);
    const r = text('Bus', prior);
    const s = r.session;
    check(
      canonicalizeServiceName(mediumOf(s)).includes('bus'),
      `service → bus: got ${mediumOf(s)}`,
    );
    check(!same(mediumOf(s), F.hoarding), `left Hoarding`);
    check(
      !s.mediumType || !same(s.mediumType, F.frontlit),
      `old mediumType cleared: got ${s.mediumType}`,
    );
    check(
      !s.area || !same(s.area, F.omr),
      `old Hoarding area cleared: got ${s.area}`,
    );
    check(
      !s.directionHint || !same(s.directionHint, F.locOmrA),
      `old Hoarding location cleared: got ${s.directionHint}`,
    );
    check(!s.city, `city cleared on new service: got ${s.city}`);
  },
));

results.push(runCase(
  'TEST 21 — Same service echo at area step stays on areas (not first area sites)',
  (check) => {
    // Frontlit · Chennai locked; area chips open (no area chosen yet)
    const priorAtArea: ProgressiveSession = {
      originalText: `${F.hoarding} ${F.frontlit} ${F.chennai}`,
      medium: canonicalizeServiceName(F.hoarding),
      browseToken: canonicalizeServiceName(F.hoarding),
      mediumType: canonicalizeServiceName(F.frontlit),
      typesResolved: true,
      city: F.chennai,
      area: undefined,
      placeHint: undefined,
      directionHint: undefined,
      qty: null,
    };

    // Area chips all carry medium=hoarding — typing "hoarding" must NOT pick first area
    const areaOpts: ProgressiveOption[] = [
      {
        id: `area:arumbakkam`,
        label: 'Arumbakkam',
        city: F.chennai,
        medium: F.hoarding,
      },
      {
        id: `area:${canonicalizeServiceName(F.omr)}`,
        label: F.omr,
        city: F.chennai,
        medium: F.hoarding,
      },
      {
        id: `area:${canonicalizeServiceName(F.ecrRoad)}`,
        label: F.ecrRoad,
        city: F.chennai,
        medium: F.hoarding,
      },
    ];
    const matched = matchFreeTextToProgressiveOption('hoarding', areaOpts);
    check(
      !matched,
      `typing "hoarding" must not match area chip via medium; got ${matched?.label}`,
    );

    const r = text('hoarding', priorAtArea);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept: got ${mediumOf(s)}`);
    check(same(s.mediumType, F.frontlit), `Frontlit kept: got ${s.mediumType}`);
    check(same(s.city, F.chennai), `Chennai kept: got ${s.city}`);
    check(
      r.step === 'pick_area',
      `must re-ask area (not sites/quote); step=${r.step} text=${r.botText}`,
    );
    check(r.step !== 'pick_direction', `must not jump to direction/sites`);
    check(r.step !== 'pick_type', `must not re-ask Frontlit/Nonlit`);
    check(r.step !== 'quote_ready', `must not auto-quote`);
    check(
      !s.area && !s.placeHint,
      `must not auto-lock first area (e.g. Arumbakkam); area=${s.area}/${s.placeHint}`,
    );
    check(
      optionsMention(r, F.omr) && optionsMention(r, F.ecrRoad),
      `area chips should still list OMR + ECR Road; opts=${optionLabels(r).join('|')}`,
    );
    check(
      !/arumbakkam has a few sites/i.test(r.botText || ''),
      `must not open Arumbakkam sites; text=${r.botText}`,
    );
  },
));

results.push(runCase(
  'TEST 22 — Same service echo at direction step does not auto-quote',
  (check) => {
    // ECR sites open — user has not picked a direction yet
    const prior = sessionHoardingAt(F.ecrRoad, null);
    const r = text('hoarding', prior);
    const s = r.session;
    check(same(mediumOf(s), F.hoarding), `service kept`);
    check(same(s.mediumType, F.frontlit), `Frontlit kept`);
    check(same(s.city, F.chennai), `Chennai kept`);
    check(same(s.area || s.placeHint, F.ecrRoad), `ECR Road area kept`);
    check(!s.directionHint, `direction not auto-locked: got ${s.directionHint}`);
    check(
      r.step === 'pick_direction',
      `must stay on ECR site chips; step=${r.step} text=${r.botText}`,
    );
    check(r.step !== 'quote_ready', `must not auto-quote on service echo`);
    check(r.step !== 'min_qty_confirm', `must not jump to min-qty`);
    check(
      optionLabels(r).some((l) => /ecr|mahabalipuram|kovalam|muttukadu/i.test(l))
      || (r.options?.length || 0) >= 1,
      `ECR direction chips expected; opts=${optionLabels(r).join('|')}`,
    );
  },
));

results.push(runCase(
  'TEST 23 — Active apartment family + near omr stays apartment',
  (check) => {
    const start = text('apartment');
    check(
      optionsMention(start, 'lift') || optionsMention(start, 'lobby')
      || optionLabels(start).length >= 2,
      `apartment family chips; opts=${optionLabels(start).join('|')}`,
    );
    const browse = canonicalizeServiceName(
      start.session.browseToken || start.session.medium || '',
    );
    check(
      browse.includes('apartment'),
      `browseToken/medium stays apartment family: got ${browse}`,
    );

    const r = text('near omr', start.session);
    const s = r.session;
    check(
      canonicalizeServiceName(s.browseToken || s.medium || '').includes('apartment'),
      `must keep apartment after near omr: got ${s.browseToken}/${s.medium}`,
    );
    check(
      !optionsMention(r, F.hoarding) && !optionsMention(r, F.policeBooth),
      `must not general-browse Hoarding/Police Booth; opts=${optionLabels(r).join('|')} text=${r.botText}`,
    );
    check(
      !/following services near omr/i.test(r.botText || ''),
      `must not use general place-services copy; text=${r.botText}`,
    );
    // Either apartment options near OMR, or not-offering apartment near OMR (+ where available)
    check(
      /apartment/i.test(r.botText || '')
      || optionsMention(r, 'lift')
      || optionsMention(r, 'lobby')
      || /not (providing|offering)/i.test(r.botText || ''),
      `apartment-scoped reply; step=${r.step} text=${r.botText}`,
    );
  },
));

results.push(runCase(
  'TEST 24 — Auto family + Bangalore keeps type ask (no direction auto-quote)',
  (check) => {
    const start = text('auto');
    check(
      optionLabels(start).length >= 2,
      `auto family chips; opts=${optionLabels(start).join('|')}`,
    );
    const r = text('bangalore', start.session);
    const s = r.session;
    check(
      canonicalizeServiceName(s.browseToken || s.medium || '').includes('auto'),
      `keep auto family/medium: got ${s.browseToken}/${s.medium}`,
    );
    check(
      same(s.city, 'Bangalore') || /bangalore/i.test(s.city || ''),
      `city → Bangalore: got ${s.city}`,
    );
    // Must not steal Bangalore(inside City) as a direction while type still open
    if (r.step === 'pick_type' || optionLabels(r).length >= 2) {
      check(
        !s.directionHint || !/bangalore/i.test(s.directionHint),
        `no Bangalore direction lock before type pick: got ${s.directionHint}`,
      );
    }
    // Instant quote only OK if inventory truly collapsed to one resolvable Auto row
    if (r.step === 'quote_ready') {
      check(
        !!s.medium && isExactAutoMedium(s.medium),
        `quote only with exact Auto medium: got ${s.medium}`,
      );
    } else {
      check(
        r.step === 'pick_type'
        || r.step === 'pick_city'
        || r.step === 'pick_area'
        || r.step === 'pick_direction'
        || r.step === 'min_qty_confirm'
        || /not (providing|offering)/i.test(r.botText || ''),
        `stay in Auto funnel; step=${r.step} text=${r.botText}`,
      );
    }
  },
));

results.push(runCase(
  'TEST 25 — Typed Auto Full matches open family chip (not re-ask family)',
  (check) => {
    const start = text('auto');
    const opts = start.options || [];
    check(opts.length >= 2, `setup auto chips`);
    const fullOpt = opts.find((o) => /auto\s*full/i.test(o.label));
    check(!!fullOpt, `Auto Full chip present; opts=${optionLabels(start).join('|')}`);
    if (!fullOpt) return;

    // Mirrors ChatInterface: more-specific "auto full" must match the chip
    const matched = matchFreeTextToProgressiveOption('auto full', opts);
    check(!!matched && same(matched.label, fullOpt.label), `typed auto full matches chip`);

    const r = continueProgressiveAction(matched!.id, start.session, DB);
    const s = r.session;
    check(
      same(s.medium || '', fullOpt.medium || fullOpt.label)
      || canonicalizeServiceName(s.medium || '').includes('auto full'),
      `locks Auto Full: got ${s.medium}`,
    );
    check(
      r.step !== 'pick_type'
      || !optionLabels(r).some((l) => /auto\s*semi/i.test(l)),
      `must not re-show full Auto family list; step=${r.step} opts=${optionLabels(r).join('|')}`,
    );
  },
));

results.push(runCase(
  'TEST 26 — Hoarding·Chittoor + typed omr must not glue Chittoor · Omr',
  (check) => {
    // Live bug: city chips → Chittoor sites → user typed "omr" →
    // "Hoarding in Chittoor · Omr" + Chennai OMR site chips.
    const prior = sessionHoardingAt(F.locChittoor || F.chittoor, F.locChittoor, {
      city: F.chittoor,
      area: F.locChittoor ? undefined : F.chittoor,
      placeHint: F.locChittoor ? undefined : F.chittoor,
      directionHint: F.locChittoor || undefined,
      originalText: `${F.hoarding} ${F.chittoor}`,
    });
    // After city pick, often only city is locked (site list open)
    const atCity = {
      ...prior,
      area: undefined,
      placeHint: undefined,
      directionHint: undefined,
      candidateServiceIds: undefined,
    };

    const r = text(F.omr, atCity);
    const s = r.session;
    const bot = r.botText || '';
    const whereHybrid = new RegExp(
      `${F.chittoor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*·\\s*${F.omr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i',
    );

    check(same(mediumOf(s), F.hoarding), `service kept: got ${mediumOf(s)}`);
    check(same(s.area || s.placeHint, F.omr), `area → OMR: got ${s.area}/${s.placeHint}`);
    check(
      !same(s.city, F.chittoor),
      `must clear Chittoor when OMR is outside it: got city=${s.city}`,
    );
    check(
      !whereHybrid.test(bot),
      `must not say Chittoor · Omr; text=${bot}`,
    );
    check(
      !bot.includes(`${F.chittoor} ·`) || !/omr/i.test(bot),
      `no Chittoor·OMR hybrid copy; text=${bot}`,
    );
    // Should land on OMR sites (or sole-site quote), not Chittoor inventory
    check(
      r.step === 'pick_direction'
      || r.step === 'quote_ready'
      || r.step === 'min_qty_confirm'
      || r.step === 'pick_area'
      || r.step === 'pick_city',
      `continue Hoarding near OMR; step=${r.step} text=${bot}`,
    );
    if (r.step === 'pick_direction' || (r.options && r.options.length)) {
      check(
        optionLabels(r).some((l) => /omr|padur|perungudi|sholinganallur/i.test(l))
        || same(s.city, F.chennai)
        || same(s.city, F.omr)
        || same(s.area || s.placeHint, F.omr),
        `OMR-scoped sites/city; city=${s.city} opts=${optionLabels(r).join('|')}`,
      );
    }
  },
));

results.push(runCase(
  'TEST 27 — Sole Bus Semi (no direction) quotes on cold start and same-service echo',
  (check) => {
    const busSemiKey = canonicalizeServiceName(F.busSemi);
    const semiRows = DB.filter((s) => {
      const mk = canonicalizeServiceName(getMediumKey(s) || '');
      return mk === busSemiKey || (mk.includes('bus') && mk.includes('semi'));
    });
    // Use engine helpers via a cold resolve to discover city lock
    const cold = text('bus semi');
    check(
      canonicalizeServiceName(mediumOf(cold.session)).includes('semi'),
      `cold locks Bus Semi; got ${mediumOf(cold.session)}`,
    );
    check(
      cold.step === 'quote_ready'
      || cold.step === 'min_qty_confirm'
      || !!(cold.quoteRows && cold.quoteRows.length),
      `cold: sole site must quote (not fake location ask); step=${cold.step} text=${cold.botText} opts=${optionLabels(cold).join('|')}`,
    );
    check(
      !/few sites available/i.test(cold.botText || ''),
      `cold: must not say few sites; text=${cold.botText}`,
    );

    // Same-service echo with city already locked (the live bug path)
    const prior: ProgressiveSession = {
      originalText: 'bus semi',
      medium: canonicalizeServiceName(F.busSemi),
      browseToken: canonicalizeServiceName(F.busSemi),
      city: F.chennai,
      qty: null,
      typesResolved: true,
    };
    const echo = text('bus semi', prior);
    check(
      echo.step === 'quote_ready'
      || echo.step === 'min_qty_confirm'
      || !!(echo.quoteRows && echo.quoteRows.length),
      `echo: must quote; step=${echo.step} text=${echo.botText} opts=${optionLabels(echo).join('|')}`,
    );
    check(
      !/few sites available/i.test(echo.botText || ''),
      `echo: must not fake direction ask; text=${echo.botText}`,
    );
    check(
      !optionLabels(echo).some((l) => same(l, F.busSemi) || /bus\s*semi/i.test(l)),
      `echo: must not show medium-name as location chip; opts=${optionLabels(echo).join('|')}`,
    );
    // Inventory sanity: if DB still has only one Bus Semi row, city should be Chennai
    if (semiRows.length <= 1) {
      check(
        same(echo.session.city, F.chennai) || same(cold.session.city, F.chennai),
        `sole row city Chennai; cold=${cold.session.city} echo=${echo.session.city}`,
      );
    }
  },
));

results.push(runCase(
  'TEST 28 — Quote request matches Navallur direction inside OMR',
  (check) => {
    const prior = sessionHoardingAt(F.omr, null);
    const navallur = DB.find((row) =>
      /navall?ur/i.test(
        String((row.metadata as { direction_remarks?: string } | undefined)?.direction_remarks || ''),
      ),
    );
    if (!navallur) {
      check(true, 'skip — catalog has no Navallur direction');
      return;
    }

    const expectedDirection = String(
      (navallur.metadata as { direction_remarks?: string }).direction_remarks || '',
    );
    const r = text('give me a quote for navalur', prior);
    const s = r.session;

    check(same(mediumOf(s), F.hoarding), `service kept: got ${mediumOf(s)}`);
    check(same(s.city, F.chennai), `city kept: got ${s.city}`);
    check(same(s.area || s.placeHint, F.omr), `OMR kept: got ${s.area}/${s.placeHint}`);
    check(
      !!s.directionHint
      && canonicalizeServiceName(s.directionHint).includes(
        canonicalizeServiceName(expectedDirection).split('towards').pop()?.trim() || 'navallur',
      ),
      `Navallur direction matched: got ${s.directionHint}; expected ${expectedDirection}`,
    );
    check(r.step !== 'no_match', `must not claim Hoarding unavailable: ${r.botText}`);
    check(
      r.step === 'quote_ready'
      || r.step === 'min_qty_confirm'
      || !!(r.quoteRows && r.quoteRows.length),
      `Navallur selection should quote; step=${r.step} text=${r.botText}`,
    );
  },
));

function isExactAutoMedium(medium: string): boolean {
  const k = canonicalizeServiceName(medium);
  return k.includes('auto') && k !== 'auto';
}

// ─── Summary ────────────────────────────────────────────────────────────────

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log('\n────────────────────────────────────────');
console.log(`Suite: ${passed} PASS / ${failed} FAIL / ${results.length} total`);
if (failed > 0) {
  console.log('Failed cases:');
  for (const name of failedCaseNames) {
    console.log(`  - ${name}`);
  }
  process.exit(1);
}
