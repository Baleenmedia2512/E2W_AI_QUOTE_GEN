/**
 * Test Case 1 — Changing area must keep current service (Hoarding flow).
 *
 * Funnel so far: Hoarding → Frontlit → Chennai → ECR Road → ECR location selected.
 * User then types an area change: OMR.
 *
 * Run: npx vite-node src/utils/progressiveChat.areaClearsDirection.test.ts
 *
 * Fixture labels come from a fake catalog (same shape as DB metadata).
 * Production chatbot logic is not hardcoded to these strings.
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

const { resolveProgressiveText } = await import('./progressiveChatEngine');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type ProgressiveSession = import('./progressiveChatEngine').ProgressiveSession;
type DbService = import('./serviceResolver').DbService;

function svc(
  id: string,
  name: string,
  meta: Record<string, unknown>,
): DbService {
  return {
    service_id: id,
    service_name: name,
    metadata: meta,
  };
}

/**
 * Catalog fixture — mirrors proposal_chunks metadata fields.
 * Includes a different medium at the new area so the test can assert
 * we do NOT browse all services in that place (e.g. Police Booth).
 */
const FIXTURE = {
  medium: 'Hoarding',
  mediumType: 'Frontlit',
  city: 'Chennai',
  areaBefore: 'ECR Road',
  areaAfter: 'OMR',
  /** Previously selected ECR Road site / direction_remarks */
  locationBefore: 'ECR Road towards Mahabalipuram',
  locationOmrA: 'OMR towards Sholinganallur',
  locationOmrB: 'OMR towards Siruseri',
  /** Unrelated medium also present at OMR — must not appear after area change */
  otherMedium: 'Police Booth',
  otherLocationOmr: 'OMR Kannagi Nagar',
} as const;

const DB: DbService[] = [
  svc('h-ecr-loc', `${FIXTURE.medium} · ${FIXTURE.areaBefore}`, {
    medium: FIXTURE.medium,
    medium_type: FIXTURE.mediumType,
    city: FIXTURE.city,
    area_name: FIXTURE.areaBefore,
    direction_remarks: FIXTURE.locationBefore,
    min_quantity: 1,
  }),
  svc('h-omr-a', `${FIXTURE.medium} · ${FIXTURE.areaAfter} A`, {
    medium: FIXTURE.medium,
    medium_type: FIXTURE.mediumType,
    city: FIXTURE.city,
    area_name: FIXTURE.areaAfter,
    direction_remarks: FIXTURE.locationOmrA,
    min_quantity: 1,
  }),
  svc('h-omr-b', `${FIXTURE.medium} · ${FIXTURE.areaAfter} B`, {
    medium: FIXTURE.medium,
    medium_type: FIXTURE.mediumType,
    city: FIXTURE.city,
    area_name: FIXTURE.areaAfter,
    direction_remarks: FIXTURE.locationOmrB,
    min_quantity: 1,
  }),
  // Trap: another service at OMR — area change must NOT open a place-wide service browse
  svc('pb-omr', `${FIXTURE.otherMedium} · ${FIXTURE.areaAfter}`, {
    medium: FIXTURE.otherMedium,
    city: FIXTURE.city,
    area_name: FIXTURE.areaAfter,
    direction_remarks: FIXTURE.otherLocationOmr,
    min_quantity: 1,
  }),
];

function sameMedium(a: string | undefined, b: string): boolean {
  return canonicalizeServiceName(a || '') === canonicalizeServiceName(b);
}

function sameLabel(a: string | undefined | null, b: string): boolean {
  return canonicalizeServiceName(a || '') === canonicalizeServiceName(b);
}

/** Session after: Hoarding → Frontlit → Chennai → ECR Road → location selected */
const prior: ProgressiveSession = {
  originalText: `${FIXTURE.medium} ${FIXTURE.city} ${FIXTURE.areaBefore}`,
  medium: canonicalizeServiceName(FIXTURE.medium),
  browseToken: canonicalizeServiceName(FIXTURE.medium),
  mediumType: canonicalizeServiceName(FIXTURE.mediumType),
  typesResolved: true,
  city: FIXTURE.city,
  area: FIXTURE.areaBefore,
  placeHint: FIXTURE.areaBefore,
  directionHint: FIXTURE.locationBefore,
  qty: null,
  candidateServiceIds: ['h-ecr-loc'],
};

const result = resolveProgressiveText(FIXTURE.areaAfter, DB, prior, null);
const s = result.session;
const optionLabels = (result.options || []).map((o) => o.label);
const optionTextBlob = optionLabels.join(' | ');

const failures: string[] = [];

function check(cond: boolean, msg: string) {
  if (!cond) failures.push(msg);
}

// Keep current Hoarding service
check(
  sameMedium(s.medium || s.browseToken, FIXTURE.medium),
  `service should remain ${FIXTURE.medium}, got medium=${s.medium} browseToken=${s.browseToken}`,
);

// Keep Frontlit
check(
  sameLabel(s.mediumType, FIXTURE.mediumType),
  `medium_type should remain ${FIXTURE.mediumType}, got ${s.mediumType}`,
);

// Keep Chennai
check(
  sameLabel(s.city, FIXTURE.city),
  `city should remain ${FIXTURE.city}, got ${s.city}`,
);

// ECR Road → OMR
check(
  sameLabel(s.area || s.placeHint, FIXTURE.areaAfter),
  `area should be ${FIXTURE.areaAfter}, got area=${s.area} placeHint=${s.placeHint}`,
);
check(
  !sameLabel(s.area, FIXTURE.areaBefore)
    && !sameLabel(s.placeHint, FIXTURE.areaBefore),
  `old area ${FIXTURE.areaBefore} must not remain (area=${s.area}, placeHint=${s.placeHint})`,
);

// Previous ECR Road location cleared
check(
  !s.directionHint,
  `location/direction should be null, got ${JSON.stringify(s.directionHint)}`,
);
check(
  !sameLabel(s.directionHint, FIXTURE.locationBefore),
  `old ECR location must not remain: ${FIXTURE.locationBefore}`,
);

// Do not restart / switch service; do not place-browse all OMR services
check(
  result.step !== 'small_talk',
  `must not restart conversation (step=${result.step})`,
);
check(
  !sameMedium(s.medium || s.browseToken, FIXTURE.otherMedium),
  `must not switch to ${FIXTURE.otherMedium}`,
);

// Next step: Hoarding site/location selection for OMR
check(
  result.step === 'pick_direction',
  `next step should be pick_direction (Hoarding OMR sites), got ${result.step}`,
);
check(
  (result.options?.length || 0) >= 2,
  `Hoarding OMR location chips expected (2+), got ${result.options?.length || 0}`,
);

// Fail if Police Booth (or any other medium) is offered
check(
  !optionLabels.some((lab) =>
    canonicalizeServiceName(lab).includes(
      canonicalizeServiceName(FIXTURE.otherMedium),
    ),
  ),
  `must not return ${FIXTURE.otherMedium}; options=${optionTextBlob}`,
);

// Options should be the OMR Hoarding locations from the catalog (not ECR location)
check(
  optionLabels.every(
    (lab) => !sameLabel(lab, FIXTURE.locationBefore),
  ),
  `options must not include old ECR location; options=${optionTextBlob}`,
);
check(
  optionLabels.some((lab) => sameLabel(lab, FIXTURE.locationOmrA))
    && optionLabels.some((lab) => sameLabel(lab, FIXTURE.locationOmrB)),
  `options should be Hoarding OMR locations; options=${optionTextBlob}`,
);

if (failures.length) {
  console.log('FAIL');
  for (const f of failures) console.log(`  ASSERT: ${f}`);
  console.log('\nActual:', {
    medium: s.medium,
    mediumType: s.mediumType,
    city: s.city,
    area: s.area,
    placeHint: s.placeHint,
    directionHint: s.directionHint,
    step: result.step,
    optionLabels,
  });
  process.exit(1);
}

console.log('PASS');
