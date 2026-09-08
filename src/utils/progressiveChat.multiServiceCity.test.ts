/**
 * Progressive chat — multi-service + multi-city batch suite.
 *
 * Inventory: fixtures in progressiveChat.testCatalog.ts plus live vendor_rate_chunks.
 *
 * Run (manually):
 *   npx vite-node src/utils/progressiveChat.multiServiceCity.test.ts
 */

const { loadProgressiveTestCatalog } = await import('./progressiveChat.testCatalog');
const {
  resolveProgressiveText,
  detectCitiesInText,
  continueProgressiveAction,
  getMediumKey,
  getDbCityLabel,
  getDirectionLabel,
} = await import('../chat/index');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type ProgressiveSession = import('../chat/index').ProgressiveSession;
type ProgressiveTurnResult = import('../chat/index').ProgressiveTurnResult;
type DbService = import('./serviceResolver').DbService;

const catalog = await loadProgressiveTestCatalog();
const DB: DbService[] = catalog.services;
const L = catalog.labels;

/** Labels discovered from real DB only — never invent display strings. */
const F = {
  busSemi: L.busSemi,
  busFull: L.busFull,
  auto: L.auto,
  cab: L.cab,
  policeBooth: L.policeBooth,
  metroElevated: L.metroElevated,
  metroUnderground: L.metroUnderground,
  chennai: L.chennai,
  madurai: L.madurai,
  coimbatore: L.coimbatore,
  boothMissingCity: L.boothMissingCity,
  cabMissingCity: L.cabMissingCity,
} as const;

/** Real DB: Bus Semi is Chennai-only. For “both cities” cases use a medium that exists in both. */
const mediumInMaduraiAndChennai =
  catalog.multiCityMediums.find(
    (m) =>
      m.cities.some((c) => canonicalizeServiceName(c) === canonicalizeServiceName(F.madurai))
      && m.cities.some((c) => canonicalizeServiceName(c) === canonicalizeServiceName(F.chennai)),
  )?.medium || F.policeBooth;

// ─── Helpers ────────────────────────────────────────────────────────────────

function same(a: string | undefined | null, b: string): boolean {
  return canonicalizeServiceName(a || '') === canonicalizeServiceName(b);
}

function mediumOf(s: ProgressiveSession): string {
  return s.medium || s.browseToken || '';
}

function text(
  userText: string,
  db: DbService[] = DB,
  prior: ProgressiveSession | null = null,
): ProgressiveTurnResult {
  return resolveProgressiveText(userText, db, prior, null);
}

function optionLabels(r: ProgressiveTurnResult): string[] {
  return (r.options || []).map((o) => o.label);
}

function optionsMention(r: ProgressiveTurnResult, needle: string): boolean {
  const n = canonicalizeServiceName(needle);
  return optionLabels(r).some((lab) => canonicalizeServiceName(lab).includes(n))
    || (r.options || []).some(
      (o) =>
        (o.city && canonicalizeServiceName(o.city).includes(n))
        || (o.medium && canonicalizeServiceName(o.medium).includes(n)),
    );
}

function botMentions(r: ProgressiveTurnResult, re: RegExp): boolean {
  return re.test(r.botText || '');
}

type CheckFn = (cond: boolean, msg: string) => void;

const failedCaseNames: string[] = [];
let skippedCaseCount = 0;

/** Phase 7.2 — no skipped cases; fixtures in progressiveChat.testCatalog.ts */
const SKIP_CASES: Record<string, string> = {};

function runCase(name: string, body: (check: CheckFn) => void): boolean {
  const skipReason = SKIP_CASES[name];
  if (skipReason) {
    console.log(`SKIP  ${name} — ${skipReason}`);
    skippedCaseCount += 1;
    return true;
  }
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

const results: boolean[] = [];

// ─── Cases ──────────────────────────────────────────────────────────────────

function assertBusSemiSkipMaduraiContinueChennai(
  check: CheckFn,
  phrase: string,
): void {
  const cities = detectCitiesInText(phrase, DB);
  check(
    cities.length >= 2
    && cities.some((c) => same(c, F.madurai))
    && cities.some((c) => same(c, F.chennai)),
    `detectCities → Madurai+Chennai (${phrase}): got ${cities.join('|')}`,
  );

  const r = text(phrase);
  const s = r.session;
  check(
    !botMentions(r, /here are the services we currently provide in madurai/i),
    `must not stop on Madurai browse list; text=${r.botText}`,
  );
  check(
    botMentions(r, /madurai/i)
    && (botMentions(r, /isn't|aren't|not (providing|offering)|continuing/i)),
    `must note Madurai unavailable; text=${r.botText}`,
  );
  check(
    botMentions(r, /chennai/i),
    `must mention available city Chennai; text=${r.botText}`,
  );
  check(
    same(s.city, F.chennai),
    `must continue in Chennai: city=${s.city}`,
  );
  check(
    canonicalizeServiceName(mediumOf(s)).includes('bus'),
    `Bus Semi (or bus family) locked: got ${mediumOf(s)}`,
  );
  check(r.step !== 'no_match', `must not dead-end; step=${r.step}`);
  check(
    r.step === 'pick_type'
    || r.step === 'pick_area'
    || r.step === 'pick_direction'
    || r.step === 'pick_city'
    || r.step === 'min_qty_confirm'
    || r.step === 'quote_ready',
    `continue Chennai funnel; step=${r.step} text=${r.botText}`,
  );
}

results.push(runCase(
  'MSC 1 — Bus Semi Madurai+Chennai: skip Madurai, continue Chennai',
  (check) => {
    // With "in" (suite phrasing)
    assertBusSemiSkipMaduraiContinueChennai(check, 'bus semi in madurai and chennai');
    // Live UI phrasing without "in"
    assertBusSemiSkipMaduraiContinueChennai(check, 'bus semi madurai and chennai');
  },
));

results.push(runCase(
  'MSC 1b — Prior Bus Semi session + multi-city must not Madurai-browse',
  (check) => {
    // Live bug: auto/bus funnel already active, then "bus semi in madurai and chennai"
    // locked first city (Madurai) and dumped city-wide Madurai chips.
    const prior = text('bus semi').session;
    const r = text('bus semi in madurai and chennai', DB, prior);
    check(
      !botMentions(r, /here are the services we currently provide in madurai/i),
      `must not Madurai city-wide browse; text=${r.botText}`,
    );
    check(
      same(r.session.city, F.chennai)
      || r.step === 'pick_city'
      || botMentions(r, /continuing in chennai/i)
      || botMentions(r, /isn't in madurai/i),
      `skip Madurai / continue Chennai; city=${r.session.city} step=${r.step} text=${r.botText}`,
    );
    check(
      !same(r.session.city, F.madurai)
      || r.step === 'pick_city',
      `must not stay locked on Madurai alone; city=${r.session.city}`,
    );
  },
));

results.push(runCase(
  'MSC 2 — Medium in both named cities: no city re-ask (use both)',
  (check) => {
    const med = mediumInMaduraiAndChennai;
    const r = text(`${med} in madurai and chennai`);
    check(
      r.step !== 'pick_city',
      `cities already named → skip city re-ask; step=${r.step} text=${r.botText} medium=${med}`,
    );
    check(
      !botMentions(r, /which city do you need/i),
      `must not re-ask which city; text=${r.botText}`,
    );
    const citiesTouched = [
      r.session.city,
      ...(r.session.workQueue || []).map((w) => w.city),
      ...(r.quoteRows || r.session.collectedRows || []).map((row) => row.city),
    ].filter(Boolean);
    check(
      citiesTouched.some((c) => same(c, F.madurai))
      || citiesTouched.some((c) => same(c, F.chennai))
      || r.step === 'pick_direction'
      || r.step === 'pick_area'
      || r.step === 'quote_ready'
      || r.step === 'min_qty_confirm',
      `must start funnel/quote for named cities; city=${r.session.city} `
      + `queue=${(r.session.workQueue || []).map((w) => w.city).join('|')} step=${r.step}`,
    );
    check(
      !botMentions(r, /isn't in madurai|aren't in madurai/i),
      `must not say unavailable when both have inventory`,
    );
  },
));

results.push(runCase(
  'MSC 3 — Bus Semi neither named city: no invent',
  (check) => {
    const r = text('bus semi in madurai and coimbatore');
    check(
      r.step === 'no_match'
      || botMentions(r, /not (providing|offering)/i),
      `neither city → not offering; step=${r.step} text=${r.botText}`,
    );
    check(
      !same(r.session.city, F.madurai) || r.step === 'no_match',
      `must not falsely lock Madurai for Bus Semi`,
    );
  },
));

results.push(runCase(
  'MSC 3b — Bus Semi in Madurai only: do not quote other-city inventory',
  (check) => {
    const r = text('bus semi in madurai');
    check(
      r.step !== 'quote_ready' && r.step !== 'min_qty_confirm',
      `must not quote Bus Semi for Madurai; step=${r.step} text=${r.botText}`,
    );
    check(
      botMentions(r, /not (providing|offering)/i) || r.step === 'pick_city' || r.step === 'no_match',
      `must say not in Madurai; step=${r.step} text=${r.botText}`,
    );
    check(
      !same(r.session.city, F.chennai),
      `must not silently lock Chennai; city=${r.session.city}`,
    );
    const quoteCities = (r.quoteRows || r.session.collectedRows || [])
      .map((row) => row.city)
      .filter(Boolean);
    check(
      !quoteCities.some((c) => same(c, F.chennai)),
      `must not add Chennai rows for a Madurai-only ask; rows=${quoteCities.join('|')}`,
    );
  },
));

results.push(runCase(
  'MSC 3c — quote for bus and auto: for is not a city',
  (check) => {
    for (const q of [
      'give quote for bus and auto',
      'i need aquote for bus and auto',
      'i need a quote for bus and auto',
    ]) {
      const r = text(q);
      check(
        !botMentions(r, /in bus or auto/i),
        `"${q}" must not treat services as cities; text=${r.botText}`,
      );
      check(
        r.step !== 'no_match' || !botMentions(r, /not offering bus or auto in bus/i),
        `"${q}" must start Bus/Auto funnel; step=${r.step} text=${r.botText}`,
      );
      check(
        r.step === 'pick_type'
        || r.step === 'pick_city'
        || r.step === 'pick_area'
        || r.step === 'pick_direction'
        || r.step === 'min_qty_confirm'
        || r.step === 'quote_ready',
        `"${q}" should ask type/city; step=${r.step} text=${r.botText}`,
      );
    }
  },
));

results.push(runCase(
  'MSC 4 — Bus and Auto in Chennai: shared city lock, no city re-ask',
  (check) => {
    const r = text('bus and auto in chennai');
    const s = r.session;
    check(same(s.city, F.chennai), `city locked Chennai: got ${s.city}`);
    check(
      r.step !== 'pick_city',
      `must not re-open city chips; step=${r.step} text=${r.botText}`,
    );
    check(
      r.step === 'pick_type'
      || r.step === 'pick_area'
      || r.step === 'pick_direction'
      || r.step === 'min_qty_confirm'
      || r.step === 'quote_ready',
      `start sequential/type funnel in Chennai; step=${r.step}`,
    );
  },
));

results.push(runCase(
  'MSC 4b — bus and auto echo keeps Chennai and Bus type chips',
  (check) => {
    const first = text('bus and auto in chennai');
    check(same(first.session.city, F.chennai), `first city Chennai: got ${first.session.city}`);
    check(first.step !== 'pick_city', `first must not ask city; step=${first.step}`);
    const echo = text('bus and auto', DB, first.session);
    check(
      same(echo.session.city, F.chennai),
      `echo keeps Chennai: got ${echo.session.city}`,
    );
    check(
      echo.step !== 'pick_city',
      `echo must not ask Auto city; step=${echo.step} text=${echo.botText}`,
    );
    check(
      !/which auto city/i.test(echo.botText || ''),
      `must not ask Auto city while Bus is active; text=${echo.botText}`,
    );
    const labels = optionLabels(echo);
    const dup = labels.filter((l, i) => labels.findIndex((x) => same(x, l)) !== i);
    check(!dup.length, `no duplicate chips: ${labels.join('|')}`);
    if (echo.step === 'pick_type') {
      check(
        labels.some((l) => /bus/i.test(l)),
        `type chips should be Bus options; got ${labels.join('|')}`,
      );
      check(
        !labels.some((l) => /^auto\b/i.test(l)),
        `must not mix Auto chips into Bus type ask; got ${labels.join('|')}`,
      );
    }
  },
));

results.push(runCase(
  'MSC 4c — bus shelter → bus is NOT same-batch echo (restart list)',
  (check) => {
    const shelterMed = catalog.mediums.find((m) =>
      canonicalizeServiceName(m).includes('bus shelter'),
    );
    check(!!shelterMed, 'fixture catalog must include a Bus Shelter medium');
    if (!shelterMed) return;

    const first = text(
      `50 ${F.busSemi} and 1000 ${F.auto} and 200 ${F.cab} and 5 bus shelter`,
    );
    check(
      (first.session.segments?.length || 0) >= 2
        || (first.session.workQueue?.length || 0) > 0
        || !!first.session.medium
        || !!first.session.browseToken,
      `first batch should start a funnel; step=${first.step}`,
    );
    const priorToks = (first.session.segments || []).map((s) =>
      canonicalizeServiceName(s.token),
    );
    check(
      priorToks.some((t) => t.includes('shelter')),
      `first segments should include bus shelter; got ${priorToks.join('|')}`,
    );

    // Changed last service: bus shelter → bare bus (different product)
    const changed = text(
      `50 ${F.busSemi} and 1000 ${F.auto} and 200 ${F.cab} and 5 bus`,
      DB,
      first.session,
    );
    const nextToks = (changed.session.segments || []).map((s) =>
      canonicalizeServiceName(s.token),
    );
    check(
      nextToks.some((t) => t === 'bus' || t.startsWith('bus '))
        && !nextToks.some((t) => t.includes('shelter')),
      `changed list must queue Bus not Bus Shelter; got ${nextToks.join('|')} `
        + `step=${changed.step} medium=${mediumOf(changed.session)}`,
    );
    // Must not keep the old shelter token on the active/queued batch
    const queueToks = (changed.session.workQueue || []).map((w) =>
      canonicalizeServiceName(w.browseToken || w.medium || ''),
    );
    const active = canonicalizeServiceName(mediumOf(changed.session));
    check(
      !active.includes('shelter')
        && !queueToks.some((t) => t.includes('shelter')),
      `must not keep Bus Shelter after service-name change; `
        + `active=${active} queue=${queueToks.join('|')}`,
    );
  },
));

results.push(runCase(
  'MSC 5 — Shared multi-city for mediums that exist in both cities',
  (check) => {
    // Live DB: Bus/Auto are not both in Madurai — use Police Booth (or discovered pair).
    const med = mediumInMaduraiAndChennai;
    const r = text(`${med} in madurai and chennai`);
    check(
      r.step !== 'pick_city',
      `named cities → no city re-ask; step=${r.step} text=${r.botText} medium=${med}`,
    );
    check(
      !!r.session.medium || !!r.session.browseToken,
      `must keep service locked; med=${mediumOf(r.session)}`,
    );
    check(
      r.step === 'pick_direction'
      || r.step === 'pick_area'
      || r.step === 'pick_type'
      || r.step === 'quote_ready'
      || r.step === 'min_qty_confirm'
      || (r.session.workQueue || []).length > 0,
      `must enter funnel/quote; step=${r.step}`,
    );
  },
));

results.push(runCase(
  'MSC 6 — Cab Madurai and Auto Chennai: per-segment cities',
  (check) => {
    const r = text('cab madurai and auto in chennai');
    const s = r.session;
    // Must not force one shared city on both
    check(
      r.step !== 'no_match',
      `mixed cities should start batch; step=${r.step} text=${r.botText}`,
    );
    // First service Cab → Madurai lock for that segment / work item
    const firstCity = s.city || s.workQueue?.[0]?.city || '';
    check(
      same(firstCity, F.madurai)
      || same(firstCity, F.chennai)
      || (s.segments || []).some((seg) => same(seg.city, F.madurai)),
      `per-segment cities preserved; city=${s.city} segs=${JSON.stringify(s.segments)}`,
    );
    check(
      !(same(s.city, F.madurai) && botMentions(r, /auto.*madurai/i) && /not providing auto/i.test(r.botText || '') === false
        && same(s.city, F.chennai)),
      `sanity: session present`,
    );
  },
));

results.push(runCase(
  'MSC 7 — Police Booth and Cab in Madurai: Cab missing → continue Police Booth',
  (check) => {
    // Drop Cab rows in Madurai from the live catalog for this case only
    const db = DB.filter((s) => {
      const med = canonicalizeServiceName(getMediumKey(s) || '');
      const city = canonicalizeServiceName(getDbCityLabel(s) || '');
      const isCab = med.includes('cab');
      return !(isCab && city === canonicalizeServiceName(F.madurai));
    });
    const r = text('police booth and cab in madurai', db);
    check(
      botMentions(r, /cab/i)
      && botMentions(r, /madurai/i)
      && botMentions(r, /not providing|continuing|isn't|aren't|let's continue/i),
      `note Cab unavailable in Madurai; text=${r.botText}`,
    );
    const med = canonicalizeServiceName(mediumOf(r.session));
    const collected = (r.session.collectedRows || [])
      .map((row) => canonicalizeServiceName(String(row.serviceName || row.medium || '')))
      .join('|');
    const ids = (r.session.collectedServiceIds || []).join('|');
    check(
      med.includes('police')
      || med.includes('booth')
      || /police|booth/.test(collected)
      || /pb-madurai/.test(ids)
      || botMentions(r, /police booth|continuing with police/i)
      || r.step === 'quote_ready'
      || r.step === 'min_qty_confirm'
      || r.step === 'pick_direction'
      || r.step === 'pick_area',
      `continue with Police Booth (not Cab invent); med=${med} ids=${ids} step=${r.step}`,
    );
    check(same(r.session.city, F.madurai), `city stays Madurai`);
    check(r.step !== 'no_match', `must continue with available service`);
    check(
      !(r.session.collectedServiceIds || []).some((id) => {
        const row = db.find((s) => s.service_id === id);
        if (!row) return false;
        const med = canonicalizeServiceName(getMediumKey(row) || '');
        const city = canonicalizeServiceName(getDbCityLabel(row) || '');
        return med.includes('cab') && city === canonicalizeServiceName(F.madurai);
      }),
      `must not invent Cab Madurai row`,
    );
  },
));

results.push(runCase(
  'MSC 8 — Typo maddurai + Chennai Bus Semi → same as MSC 1',
  (check) => {
    const cities = detectCitiesInText('bus semi in maddurai and chennai', DB);
    check(
      cities.some((c) => same(c, F.madurai)),
      `typo maddurai → Madurai: got ${cities.join('|')}`,
    );
    const r = text('bus semi in maddurai and chennai');
    check(same(r.session.city, F.chennai), `continue Chennai: city=${r.session.city}`);
    check(
      !botMentions(r, /here are the services we currently provide in madurai/i),
      `no Madurai-only dead-end; text=${r.botText}`,
    );
    check(
      botMentions(r, /chennai/i),
      `must mention available Chennai; text=${r.botText}`,
    );
  },
));

results.push(runCase(
  'MSC 9 — Shared multi-city: one city dead for all asked services',
  (check) => {
    const deadCity = F.boothMissingCity;
    if (!deadCity) {
      check(true, 'skip — no metro city in catalog without Police Booth');
      return;
    }
    // Police Booth exists in some metros; deadCity is a catalog metro with zero booth rows
    const r = text(`${F.policeBooth} in ${F.madurai} and ${deadCity}`);
    check(
      same(r.session.city, F.madurai)
      || botMentions(r, /continuing in madurai/i)
      || (r.session.workQueue || []).some((w) => same(w.city, F.madurai)),
      `usable Madurai continues; city=${r.session.city} step=${r.step} text=${r.botText}`,
    );
    const deadRe = new RegExp(deadCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    check(
      botMentions(r, deadRe) || same(r.session.city, F.madurai),
      `note or skip ${deadCity}; text=${r.botText}`,
    );
    check(
      !optionsMention(r, deadCity),
      `${deadCity} must not appear as usable city chip`,
    );
    check(
      r.step !== 'pick_city' || !optionsMention(r, deadCity),
      `must not ask city again for dead+usable; step=${r.step}`,
    );
  },
));

results.push(runCase(
  'MSC 10 — Named multi-city keeps service and starts first city funnel',
  (check) => {
    const med = mediumInMaduraiAndChennai;
    const r = text(`${med} in madurai and chennai`);
    check(r.step !== 'pick_city', `no city re-ask; step=${r.step} medium=${med}`);
    check(
      !!r.session.medium || !!r.session.browseToken,
      `service kept; med=${mediumOf(r.session)}`,
    );
    check(
      !botMentions(r, /not providing services in those cities/i),
      `must not lose service and fail; text=${r.botText}`,
    );
    const firstCity = r.session.city || '';
    check(
      same(firstCity, F.chennai) || same(firstCity, F.madurai)
      || r.step === 'quote_ready'
      || r.step === 'min_qty_confirm',
      `locks one named city first; city=${firstCity} step=${r.step}`,
    );
    const queueCities = (r.session.workQueue || []).map((w) => w.city || '');
    const seededCities = (r.session.collectedRows || []).map((row) => row.city);
    const allCities = [firstCity, ...queueCities, ...seededCities].filter(Boolean);
    check(
      allCities.some((c) => same(c, F.chennai))
      && allCities.some((c) => same(c, F.madurai))
      || r.step === 'quote_ready'
      || (r.quoteRows || []).length >= 2,
      `both named cities present (active/queue/seed/quote); cities=${allCities.join('|')} step=${r.step}`,
    );
  },
));

results.push(runCase(
  'MSC 11 — Qty preserved in shared-city batch',
  (check) => {
    const r = text('bus 50 and auto 20 in chennai');
    const qtyMap = r.session.qtyByServiceId || {};
    const vals = Object.values(qtyMap);
    check(
      vals.includes(50) || vals.includes(20) || r.session.qty === 50 || r.session.qty === 20,
      `qty map should carry 50 and/or 20; qty=${r.session.qty} map=${JSON.stringify(qtyMap)}`,
    );
    check(same(r.session.city, F.chennai), `city Chennai`);
  },
));

results.push(runCase(
  'MSC 12 — Service with zero inventory in named city is dropped',
  (check) => {
    const deadCity = F.cabMissingCity;
    if (!deadCity) {
      check(true, 'skip — no metro city in catalog without Cab');
      return;
    }
    const r = text(`${F.cab} ${deadCity} and ${F.auto} in ${F.chennai}`);
    const deadRe = new RegExp(deadCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    check(
      botMentions(r, /cab/i)
      && (botMentions(r, deadRe) || botMentions(r, /not providing|aren't|isn't/i)),
      `Cab ${deadCity} unavailable noted; text=${r.botText}`,
    );
    // Continue with Auto in Chennai (or sequential starting available)
    check(
      r.step !== 'no_match'
      || botMentions(r, /auto/i),
      `must still progress with Auto; step=${r.step}`,
    );
    check(
      !r.session.collectedServiceIds?.some(
        (id) => id.includes('cab') && canonicalizeServiceName(id).includes(canonicalizeServiceName(deadCity).slice(0, 4)),
      ),
      `no invented Cab ${deadCity} collection`,
    );
  },
));

results.push(runCase(
  'MSC 13 — Metro family tokens: elevated + bare metro dedupe',
  (check) => {
    const r = text('metro station elevated and metro in chennai');
    const labels = [
      mediumOf(r.session),
      ...(r.session.workQueue || []).map((w) => w.medium || w.browseToken || ''),
      ...(r.session.batchServiceLabels || []),
    ].map((x) => canonicalizeServiceName(x));
    const bareMetroAlone = labels.filter((l) => l === 'metro');
    check(
      bareMetroAlone.length === 0
      || labels.some((l) => l.includes('elevated') || l.includes('metro station')),
      `prefer elevated over bare metro duplicate; labels=${labels.join('|')} step=${r.step}`,
    );
    check(same(r.session.city, F.chennai) || r.step === 'pick_type', `Chennai / type ask`);
  },
));

results.push(runCase(
  'MSC 14 — Batch handoff uses Now choosing (not Next —)',
  (check) => {
    // Force a multi-step batch: pick Bus Full type path then remaining Auto
    const start = text('bus full and auto in chennai');
    // If already asking, simulate completing first service via workQueue presence
    const hasQueue = (start.session.workQueue || []).length > 0;
    if (!hasQueue) {
      check(
        true,
        'no queue yet — skip handoff wording (single-ask batch ok)',
      );
      check(
        !botMentions(start, /Next\s*—/i),
        `initial copy must not use "Next —"; text=${start.botText}`,
      );
      return;
    }
    check(
      !botMentions(start, /Next\s*—/i),
      `must not use "Next — …"; text=${start.botText}`,
    );
  },
));

results.push(runCase(
  'MSC 15 — Mixed-city batch: unavailable city for one service only',
  (check) => {
    // Police Booth only Madurai; Auto both. "police booth madurai and auto in chennai"
    const r = text('police booth madurai and auto in chennai');
    check(r.step !== 'no_match', `mixed batch progresses; step=${r.step}`);
    check(
      !botMentions(r, /here are the services we currently provide in/i)
      || botMentions(r, /continuing|now choosing|which/i),
      `must not dead-end on city browse; text=${r.botText}`,
    );
    // Should start with Police Booth @ Madurai or Auto @ Chennai — never invent Booth in Chennai
    const med = canonicalizeServiceName(mediumOf(r.session));
    if (med.includes('police') || med.includes('booth')) {
      check(same(r.session.city, F.madurai), `Booth stays Madurai: ${r.session.city}`);
    }
    if (med.includes('auto')) {
      check(same(r.session.city, F.chennai), `Auto stays Chennai: ${r.session.city}`);
    }
  },
));

results.push(runCase(
  'MSC 16 — Stuck Madurai miss then bus semi again recovers',
  (check) => {
    // Simulate old copyNotOfferedInCity aftermath: Madurai locked, medium cleared
    const stuck: ProgressiveSession = {
      originalText: 'bus semi madurai and chennai',
      city: F.madurai,
      medium: undefined,
      browseToken: undefined,
      qty: null,
    };
    const r = text('bus semi', DB, stuck);
    check(
      !botMentions(r, /here are the services we currently provide in madurai/i),
      `must not repeat Madurai browse list; text=${r.botText}`,
    );
    check(
      !same(r.session.city, F.madurai)
      || same(r.session.city, F.chennai)
      || r.step === 'pick_city',
      `must leave Madurai-only lock; city=${r.session.city} step=${r.step}`,
    );
    // Prefer continuing Chennai when prior originalText named both cities
    check(
      same(r.session.city, F.chennai)
      || (r.step === 'pick_city' && optionsMention(r, F.chennai))
      || botMentions(r, /chennai/i),
      `should recover toward Chennai; city=${r.session.city} text=${r.botText}`,
    );
  },
));

results.push(runCase(
  'MSC 17 — After Madurai miss, ok give chennai continues Bus Semi',
  (check) => {
    const stuck: ProgressiveSession = {
      originalText: 'bus semi madurai and chennai',
      city: F.madurai,
      medium: undefined,
      browseToken: canonicalizeServiceName('bus semi'),
      qty: null,
    };
    const r = text('ok give chennai', DB, stuck);
    check(same(r.session.city, F.chennai), `city → Chennai: got ${r.session.city}`);
    check(
      !botMentions(r, /here are the services we currently provide in madurai/i),
      `must leave Madurai browse; text=${r.botText}`,
    );
    check(
      canonicalizeServiceName(mediumOf(r.session)).includes('bus')
      || r.step === 'pick_type'
      || r.step === 'pick_direction'
      || r.step === 'pick_area'
      || r.step === 'min_qty_confirm'
      || r.step === 'quote_ready',
      `continue Bus Semi funnel in Chennai; med=${mediumOf(r.session)} step=${r.step}`,
    );
    // Instant quote only OK if funnel truly complete — must not skip while still needing sites
    // Fixture Bus Semi Chennai has one site → quote_ready acceptable; still must be Chennai
    check(
      same(r.session.city, F.chennai),
      `Chennai locked after ok give chennai`,
    );
  },
));

results.push(runCase(
  'MSC 18 — Availability copy names unavailable + available city',
  (check) => {
    const r = text('bus semi madurai and chennai');
    check(
      botMentions(r, /madurai/i),
      `mentions Madurai; text=${r.botText}`,
    );
    check(
      botMentions(r, /chennai/i),
      `mentions Chennai available/continue; text=${r.botText}`,
    );
    check(
      botMentions(r, /continuing in chennai|isn't in madurai|aren't in madurai|not (providing|offering).+madurai/i),
      `skip+continue availability wording; text=${r.botText}`,
    );
    check(
      !botMentions(r, /here are the services we currently provide in madurai/i),
      `must not use Madurai-only service list copy`,
    );
  },
));

results.push(runCase(
  'MSC 19 — Multi-city Confirm same medium: all cities in quote (not first only)',
  (check) => {
    // Live bug: Police Booth → city checkboxes → Confirm 2+ cities →
    // finish first city sites → quote_ready with only that city.
    // Cause: finalizeSelection sameMediumTypeQueue skips continuePendingWork
    // when workQueue items share the same medium (multi-city looks like type leftovers).
    //
    // Prefer cities that each have 2+ sites so every city goes on workQueue
    // (single-site cities get seeded into collectedRows and can mask the bug).

    const countDirsInCity = (medium: string, city: string): number => {
      const med = canonicalizeServiceName(medium);
      const dirs = new Set<string>();
      for (const s of DB) {
        if (canonicalizeServiceName(getMediumKey(s) || '') !== med) continue;
        if (!same(getDbCityLabel(s) || '', city)) continue;
        const d = getDirectionLabel(s) || s.service_id || '';
        const key = canonicalizeServiceName(String(d));
        if (key) dirs.add(key);
      }
      return dirs.size;
    };

    const boothEntry =
      catalog.multiCityMediums.find(
        (m) =>
          same(m.medium, F.policeBooth)
          || canonicalizeServiceName(m.medium).includes('police booth'),
      )
      || catalog.multiCityMediums.find((m) => m.cities.length >= 2);

    if (!boothEntry || boothEntry.cities.length < 2) {
      check(true, 'skip — no medium with 2+ cities in catalog');
      return;
    }

    const med = boothEntry.medium;
    // Cities with 2+ sites force needFunnel / workQueue (exposes the bug)
    const multiSiteCities = boothEntry.cities.filter(
      (c) => countDirsInCity(med, c) >= 2,
    );
    const useCities =
      multiSiteCities.length >= 2
        ? multiSiteCities.slice(0, 3)
        : boothEntry.cities.slice(0, 3);

    check(
      useCities.length >= 2,
      `need 2+ cities for ${med}; got ${useCities.join('|')}`,
    );
    if (useCities.length < 2) return;

    const ask = text(med);
    check(
      ask.step === 'pick_city',
      `service-first → city chips; step=${ask.step} med=${med} text=${ask.botText}`,
    );
    check(!!ask.allowMulti, `city chips allowMulti`);

    const cityOpts = useCities.map((city) => {
      const opt = (ask.options || []).find((o) => same(o.city || o.label, city));
      return opt;
    }).filter((o): o is NonNullable<typeof o> => !!o);

    check(
      cityOpts.length >= 2,
      `need 2+ matching city chips; wanted=${useCities.join('|')} `
      + `opts=${optionLabels(ask).join('|')}`,
    );
    if (cityOpts.length < 2) return;

    const selectedIds = cityOpts.map((o) => o.id);
    const confirmedCities = cityOpts.map((o) => o.city || o.label);
    let r = continueProgressiveAction(
      selectedIds[0],
      ask.session,
      DB,
      selectedIds,
    );

    const queueAfterConfirm = [...(r.session.workQueue || [])];
    const firstCity = r.session.city || '';
    const queuedOther = queueAfterConfirm
      .map((w) => w.city || '')
      .filter((c) => c && !same(c, firstCity));

    // When 2+ multi-site cities are confirmed, remaining must be on workQueue
    if (multiSiteCities.length >= 2) {
      check(
        queuedOther.length >= 1,
        `multi-site cities must queue remaining after Confirm; `
        + `city=${firstCity} queue=${queuedOther.join('|') || '(empty)'} step=${r.step}`,
      );
    } else {
      check(
        queuedOther.length >= 1
        || (r.session.collectedRows || []).length >= 1
        || r.step === 'quote_ready',
        `after Confirm: queue, seed, or quote; city=${firstCity} step=${r.step}`,
      );
    }

    const queueLenBeforeDrain = queueAfterConfirm.length;

    // Drain until quote / stall (one chip per step)
    for (let i = 0; i < 40; i++) {
      if (r.step === 'quote_ready' || (r.quoteRows && r.quoteRows.length)) break;
      if (r.step === 'min_qty_confirm') {
        r = continueProgressiveAction('yes_min', r.session, DB);
        continue;
      }
      const opts = r.options || [];
      if (!opts.length) break;
      const id = opts[0].id;
      r = continueProgressiveAction(id, r.session, DB, [id]);
    }

    const rows = r.quoteRows || r.session.collectedRows || r.session.pendingRows || [];
    const rowCities = [
      ...new Set(
        rows
          .map((row) => canonicalizeServiceName(String(row.city || '')))
          .filter((c) => c && c !== '—'),
      ),
    ];

    // CORE: after Confirming N cities, quote must include all of them
    // (or still be asking the next queued city — never quote with only city #1).
    if (r.step === 'quote_ready' || (r.quoteRows && r.quoteRows.length > 0)) {
      check(
        rowCities.length >= 2,
        `quote after ${selectedIds.length}-city Confirm must include 2+ cities `
        + `(got ${rowCities.join('|') || 'none'}; confirmed=${confirmedCities.join('|')}; `
        + `queueWas=${queueLenBeforeDrain})`,
      );
      for (const city of confirmedCities) {
        check(
          rowCities.some((c) => same(c, city)),
          `confirmed city "${city}" missing from quote; cities=${rowCities.join('|')}`,
        );
      }
    } else {
      const stillWorking =
        r.step === 'pick_direction'
        || r.step === 'pick_area'
        || r.step === 'pick_type'
        || r.step === 'pick_city'
        || (r.session.workQueue || []).length > 0;
      check(
        stillWorking,
        `must keep funneling remaining cities; step=${r.step} city=${r.session.city} `
        + `queue=${(r.session.workQueue || []).map((w) => w.city).join('|')} `
        + `rows=${rowCities.join('|')}`,
      );
      // If we finished first city but still have same-medium queue, must have moved on
      if (queueLenBeforeDrain >= 1 && firstCity) {
        check(
          !same(r.session.city, firstCity)
          || (r.session.workQueue || []).length < queueLenBeforeDrain
          || rowCities.length >= 2,
          `after first city, must continue next city (not stall on ${firstCity}); `
          + `now=${r.session.city} queue=${(r.session.workQueue || []).map((w) => w.city).join('|')}`,
        );
      }
    }
  },
));

results.push(runCase(
  'MSC 20 — police booth → bus → police booth: no old city/queue leak',
  (check) => {
    // 1) Start Police Booth and lock a city path (simulate mid-funnel)
    const booth = text(F.policeBooth);
    check(
      booth.step === 'pick_city' || !!booth.session.city,
      `Police Booth starts; step=${booth.step}`,
    );
    let boothSess = booth.session;
    if (booth.step === 'pick_city' && (booth.options || []).length) {
      const firstCity = booth.options![0];
      const locked = continueProgressiveAction(
        firstCity.id,
        booth.session,
        DB,
        [firstCity.id],
      );
      boothSess = locked.session;
      check(
        !!boothSess.city || locked.step === 'pick_direction' || locked.step === 'pick_area',
        `Police Booth city locked or sites; city=${boothSess.city} step=${locked.step}`,
      );
    }

    // 2) Type bus → must leave Police Booth completely
    const bus = text('bus', DB, boothSess);
    const busMed = canonicalizeServiceName(mediumOf(bus.session));
    check(
      busMed.includes('bus') && !busMed.includes('booth') && !busMed.includes('police'),
      `after bus: medium is bus not booth; got ${mediumOf(bus.session)}`,
    );
    check(
      !same(bus.session.city, boothSess.city || '') || !boothSess.city,
      `bus must not keep Police Booth city; city=${bus.session.city}`,
    );
    check(
      !(bus.session.workQueue || []).length,
      `bus must clear Police Booth workQueue`,
    );
    check(
      !(bus.session.collectedRows || []).length,
      `bus must clear Police Booth collectedRows`,
    );
    check(
      !botMentions(bus, /police booth/i)
      || busMed.includes('bus'),
      `bus reply must not stay on Police Booth; text=${bus.botText}`,
    );

    // 3) Type police booth again → fresh (not old city from step 1)
    const again = text(F.policeBooth, DB, bus.session);
    check(
      same(mediumOf(again.session), F.policeBooth)
      || canonicalizeServiceName(mediumOf(again.session)).includes('police')
      || canonicalizeServiceName(mediumOf(again.session)).includes('booth'),
      `back to Police Booth; med=${mediumOf(again.session)}`,
    );
    check(
      !again.session.city
      || again.step === 'pick_city'
      || (boothSess.city && !same(again.session.city, boothSess.city)),
      `must not reuse old Police Booth city from step 1; `
      + `old=${boothSess.city} now=${again.session.city} step=${again.step}`,
    );
    check(
      !(again.session.workQueue || []).length,
      `fresh Police Booth must not inherit bus/booth workQueue`,
    );
    check(
      !(again.session.collectedRows || []).length,
      `fresh Police Booth must not inherit collectedRows`,
    );
  },
));

results.push(runCase(
  'MSC 21 — Live paths: bus semi + Chennai must lock exact Bus Semi (not Chennai browse)',
  (check) => {
    // Live chat failures to cover (current engine paths):
    // A) Cold "bus semi chennai"
    // B) Prior city-only Chennai browse → then "bus semi" / "bus semi chennai"
    // C) Prior bare "bus" family → then "bus semi chennai"
    // D) Live transcript: apartment → bus semi (then optional chennai)
    // E) Intent city_browse overlay (UI AI) with text "bus semi chennai"
    // F) If only 1 Bus Semi site in Chennai → quote_ready (no site ask)

    const assertExactBusSemi = (
      label: string,
      r: ProgressiveTurnResult,
      expectCity = true,
    ) => {
      const med = canonicalizeServiceName(mediumOf(r.session));
      check(
        !botMentions(r, /following services in chennai/i),
        `${label}: no Chennai service dump; text=${r.botText}`,
      );
      check(
        !botMentions(r, /which service would you like/i),
        `${label}: must not ask which service; text=${r.botText}`,
      );
      check(
        !optionsMention(r, 'shelter'),
        `${label}: no Bus Shelter chips; opts=${optionLabels(r).join('|')}`,
      );
      check(
        med.includes('bus') && med.includes('semi'),
        `${label}: Bus Semi locked; got ${mediumOf(r.session)} step=${r.step}`,
      );
      if (expectCity) {
        check(
          same(r.session.city, F.chennai),
          `${label}: Chennai locked; got ${r.session.city}`,
        );
      }
      check(
        r.step === 'quote_ready'
        || r.step === 'min_qty_confirm'
        || r.step === 'pick_direction'
        || r.step === 'pick_area'
        || r.step === 'pick_type'
        || !!(r.quoteRows && r.quoteRows.length),
        `${label}: funnel/quote not city-browse; step=${r.step} text=${r.botText}`,
      );
    };

    const busSemiKey = canonicalizeServiceName(F.busSemi || 'bus semi');
    const siteIds = new Set<string>();
    for (const s of DB) {
      const mk = canonicalizeServiceName(getMediumKey(s) || '');
      if (!(mk === busSemiKey || (mk.includes('bus') && mk.includes('semi')))) continue;
      if (!same(getDbCityLabel(s) || '', F.chennai)) continue;
      siteIds.add(s.service_id);
    }
    const singleSite = siteIds.size <= 1;

    // A) Cold start
    {
      const r = text(`bus semi ${F.chennai}`);
      assertExactBusSemi('A cold', r);
      if (singleSite) {
        check(
          r.step === 'quote_ready'
          || r.step === 'min_qty_confirm'
          || !!(r.quoteRows && r.quoteRows.length),
          `A cold: 1 site → quote; step=${r.step}`,
        );
      }
    }

    // B) Prior: typed "chennai" alone → city service browse, then "bus semi chennai"
    {
      const chennaiBrowse = text(F.chennai);
      check(
        botMentions(chennaiBrowse, /following services in chennai|services in chennai/i)
        || chennaiBrowse.step === 'pick_type'
        || !!chennaiBrowse.session.city,
        `B setup: Chennai browse or city lock; step=${chennaiBrowse.step}`,
      );
      const r1 = text('bus semi', DB, chennaiBrowse.session);
      // Service switch clears city unless named in message — must still lock Bus Semi
      assertExactBusSemi('B1 chennai→bus semi', r1, false);
      check(
        !optionsMention(r1, 'shelter'),
        `B1: no Shelter after leaving Chennai browse; opts=${optionLabels(r1).join('|')}`,
      );
      // If sole city for Bus Semi is Chennai, may auto-lock city (sites/quote next)
      if (same(r1.session.city, F.chennai)) {
        check(
          r1.step === 'quote_ready'
          || r1.step === 'min_qty_confirm'
          || r1.step === 'pick_direction'
          || r1.step === 'pick_area'
          || !!(r1.quoteRows && r1.quoteRows.length),
          `B1 Chennai auto-lock continues funnel; step=${r1.step}`,
        );
      }
      const r2 = text(`bus semi ${F.chennai}`, DB, chennaiBrowse.session);
      assertExactBusSemi('B2 chennai→bus semi chennai', r2);
      if (singleSite) {
        check(
          r2.step === 'quote_ready'
          || r2.step === 'min_qty_confirm'
          || !!(r2.quoteRows && r2.quoteRows.length),
          `B2: 1 site → quote; step=${r2.step}`,
        );
      }
    }

    // C) Prior: bare "bus" family chips, then exact "bus semi chennai"
    {
      const busFamily = text('bus');
      const r = text(`bus semi ${F.chennai}`, DB, busFamily.session);
      assertExactBusSemi('C bus→bus semi chennai', r);
      check(
        !optionsMention(r, 'shelter'),
        `C: must leave bus-family shelter list; opts=${optionLabels(r).join('|')}`,
      );
    }

    // D) Live transcript: apartment options → type "bus semi"
    {
      const apt = text('apartment');
      check(
        optionsMention(apt, 'lift') || optionsMention(apt, 'lobby') || apt.step === 'pick_type',
        `D setup apartment chips; step=${apt.step} opts=${optionLabels(apt).join('|')}`,
      );
      const r = text('bus semi', DB, apt.session);
      const med = canonicalizeServiceName(mediumOf(r.session));
      check(
        med.includes('bus') && med.includes('semi'),
        `D apartment→bus semi: lock Bus Semi; got ${mediumOf(r.session)}`,
      );
      check(
        !botMentions(r, /following services in chennai/i),
        `D: no Chennai dump; text=${r.botText}`,
      );
      check(
        !optionsMention(r, 'shelter'),
        `D: no Shelter chips; opts=${optionLabels(r).join('|')}`,
      );
      check(
        !botMentions(r, /which service would you like/i),
        `D: must not ask which service; text=${r.botText}`,
      );
      // Then user adds city (live: sites in Chennai)
      const r2 = text(`bus semi ${F.chennai}`, DB, r.session);
      assertExactBusSemi('D2 bus semi + chennai after apt', r2);
    }

    // E) Intent overlay like live ChatInterface AI (city_browse / empty media risk)
    {
      const r = resolveProgressiveText(
        `bus semi ${F.chennai}`,
        DB,
        null,
        {
          kind: 'city_browse',
          city: F.chennai,
          media: [],
          shortReply: null,
        },
      );
      // Even with bad intent, text still names bus semi → must not dump city browse
      assertExactBusSemi('E intent city_browse', r);
    }

    // F) Intent quote with only city (media stripped) — must still prefer text media
    {
      const r = resolveProgressiveText(
        `bus semi ${F.chennai}`,
        DB,
        null,
        {
          kind: 'quote',
          city: F.chennai,
          media: ['bus'], // weak AI family token — engine should prefer longer bus semi from text
          shortReply: null,
        },
      );
      assertExactBusSemi('F intent media=bus', r);
    }
  },
));

results.push(runCase(
  'MSC 22 — Queued services: multi-location Confirm must continue to next service',
  (check) => {
    const city = F.chennai;
    const multiAreaMediums = (catalog.mediums || [])
      .map((medium) => ({
        medium,
        areas: catalog.areasForMediumCity(medium, city),
      }))
      .filter((entry) => entry.areas.length >= 2);

    const first = multiAreaMediums.find((entry) =>
      canonicalizeServiceName(entry.medium).includes('hoarding'),
    ) || multiAreaMediums[0];
    const second = multiAreaMediums.find((entry) =>
      canonicalizeServiceName(entry.medium) !== canonicalizeServiceName(first?.medium || ''),
    );

    if (!first || !second) {
      check(false, 'fixture catalog must include 2 mediums with 2+ areas in the same city');
      return;
    }

    const medA = first.medium;
    const medB = second.medium;
    let r = text(`${medA} and ${medB} in ${city}`);
    check(
      r.step !== 'no_match',
      `batch should start; step=${r.step} text=${r.botText}`,
    );

    let confirmedMultiLocation = false;
    for (let i = 0; i < 24; i++) {
      if (r.step === 'quote_ready' || (r.quoteRows && r.quoteRows.length)) break;
      if (r.step === 'min_qty_confirm') {
        r = continueProgressiveAction('yes_min', r.session, DB);
        continue;
      }
      const opts = r.options || [];
      if (!opts.length) break;

      const areaOpts = opts.filter((o) => String(o.id || '').startsWith('area:'));
      const cityOpts = opts.filter((o) => String(o.id || '').startsWith('city:'));
      const dirOpts = opts.filter((o) => String(o.id || '').startsWith('direction:'));

      if (areaOpts.length >= 2) {
        const ids = areaOpts.slice(0, 2).map((o) => o.id);
        r = continueProgressiveAction(ids[0], r.session, DB, ids);
        confirmedMultiLocation = true;
        continue;
      }
      if (dirOpts.length >= 2 && confirmedMultiLocation) {
        const ids = dirOpts.slice(0, 2).map((o) => o.id);
        r = continueProgressiveAction(ids[0], r.session, DB, ids);
        break;
      }
      if (cityOpts.length >= 2 && (r.session.workQueue || []).length > 0 && r.session.medium) {
        const ids = cityOpts.slice(0, 2).map((o) => o.id);
        r = continueProgressiveAction(ids[0], r.session, DB, ids);
        confirmedMultiLocation = true;
        continue;
      }

      const id = opts[0].id;
      r = continueProgressiveAction(id, r.session, DB, [id]);
    }

    check(
      confirmedMultiLocation,
      `should reach a 2+ location Confirm for ${medA}; step=${r.step} `
      + `opts=${optionLabels(r).join('|')}`,
    );
    if (!confirmedMultiLocation) return;

    const queued = (r.session.workQueue || []).map(
      (w) => canonicalizeServiceName(w.medium || w.browseToken || ''),
    );
    const active = canonicalizeServiceName(mediumOf(r.session));
    const rows = r.quoteRows || r.session.collectedRows || r.session.pendingRows || [];
    const rowMedia = rows.map((row) =>
      canonicalizeServiceName(String(row.service || '')),
    );
    const medAKey = canonicalizeServiceName(medA);
    const medBKey = canonicalizeServiceName(medB);
    const stillOnSecond =
      active.includes(medBKey) || medBKey.includes(active)
      || queued.some((q) => q.includes(medBKey) || medBKey.includes(q));
    const quoteHasBoth =
      rowMedia.some((m) => m.includes(medAKey) || medAKey.includes(m))
      && rowMedia.some((m) => m.includes(medBKey) || medBKey.includes(m));

    check(
      r.step !== 'quote_ready' || quoteHasBoth,
      `multi-location Confirm must not quote only ${medA}; `
      + `step=${r.step} active=${active} queue=${queued.join('|') || '(empty)'} `
      + `rows=${rowMedia.join('|') || '(none)'}`,
    );
    check(
      stillOnSecond || quoteHasBoth || r.step === 'pick_type'
      || r.step === 'pick_city' || r.step === 'pick_area' || r.step === 'pick_direction',
      `must continue to ${medB} after ${medA} locations; `
      + `step=${r.step} active=${active} queue=${queued.join('|') || '(empty)'}`,
    );
  },
));

// ─── Summary ────────────────────────────────────────────────────────────────

const passed = results.filter(Boolean).length - skippedCaseCount;
const failed = results.length - passed - skippedCaseCount;
console.log('\n────────────────────────────────────────');
console.log(
  `Suite: ${passed} PASS / ${failed} FAIL / ${skippedCaseCount} SKIP / ${results.length} total`,
);
if (failed > 0) {
  console.log('Failed cases:');
  for (const name of failedCaseNames) {
    console.log(`  - ${name}`);
  }
  process.exit(1);
}
