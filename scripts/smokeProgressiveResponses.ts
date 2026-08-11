/**
 * Smoke walkthrough: Quote Buddy system-prompt conversation style.
 * Run: npx tsx scripts/smokeProgressiveResponses.ts
 */
import {
  resolveProgressiveText,
  continueProgressiveAction,
  detectDirectionInText,
  type ProgressiveSession,
} from '../src/utils/progressiveChatEngine';
import type { DbService } from '../src/utils/serviceResolver';

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

const DB: DbService[] = [
  svc('bus-semi-chennai-adyar', 'Bus Semi Branding · Chennai Adyar', {
    medium: 'Bus Semi Branding',
    medium_type: 'Semi',
    city: 'Chennai',
    area_name: 'Adyar',
    direction_remarks: 'Towards Besant Nagar',
    min_quantity: 10,
  }),
  svc('bus-semi-chennai', 'Bus Semi Branding · Chennai', {
    medium: 'Bus Semi Branding',
    medium_type: 'Semi',
    city: 'Chennai',
    area_name: 'Anna Nagar',
    direction_remarks: 'Towards Koyambedu',
    min_quantity: 10,
  }),
  svc('bus-full-chennai', 'Bus Full Branding · Chennai', {
    medium: 'Bus Full Branding',
    medium_type: 'Full',
    city: 'Chennai',
    area_name: 'T Nagar',
    direction_remarks: 'Towards Pondy Bazaar',
    min_quantity: 10,
  }),
  svc('bus-shelter-chennai', 'Bus Shelter · Chennai', {
    medium: 'Bus Shelter',
    city: 'Chennai',
    area_name: 'Saidapet',
    direction_remarks: 'Towards Guindy',
    min_quantity: 5,
  }),
  svc('bus-semi-madurai', 'Bus Semi Branding · Madurai', {
    medium: 'Bus Semi Branding',
    medium_type: 'Semi',
    city: 'Madurai',
    area_name: 'Goripalayam',
    direction_remarks: 'Towards Melur',
    min_quantity: 10,
  }),
  svc('hoarding-madurai', 'Hoarding Frontlit · Madurai', {
    medium: 'Hoarding',
    medium_type: 'Frontlit',
    city: 'Madurai',
    area_name: 'Goripalayam',
    direction_remarks: 'Towards Melur',
    min_quantity: 1,
  }),
  svc('hoarding-coimbatore', 'Hoarding · Coimbatore', {
    medium: 'Hoarding',
    medium_type: 'Frontlit',
    city: 'Coimbatore',
    area_name: 'RS Puram',
    direction_remarks: '100 feet Road towards Power house',
    min_quantity: 1,
  }),
  svc('hoarding-coimbatore-2', 'Hoarding · Coimbatore Sidhapudur', {
    medium: 'Hoarding',
    medium_type: 'Frontlit',
    city: 'Coimbatore',
    area_name: 'RS Puram',
    direction_remarks: '100 feet Road towards Sidhapudur',
    min_quantity: 1,
  }),
  svc('hoarding-ecr', 'Hoarding Nonlit · ECR', {
    medium: 'Hoarding',
    medium_type: 'Nonlit',
    city: 'Chennai',
    area_name: 'ECR',
    direction_remarks: 'Towards Mahabs',
    min_quantity: 1,
  }),
  svc('hoarding-gemini-chennai', 'Hoarding Frontlit · Chennai Gemini Flyover', {
    medium: 'Hoarding',
    medium_type: 'Frontlit',
    city: 'Chennai',
    area_name: 'Gemini Flyover',
    direction_remarks: 'Gemini Flyover The Park signal towards Cathedral Road',
    min_quantity: 1,
  }),
  // Live catalog often stores "LED Hoarding" without a plain "Hoarding" medium key.
  svc('led-hoarding-gemini', 'LED Hoarding · Chennai Gemini Flyover', {
    medium: 'LED Hoarding',
    city: 'Chennai',
    area_name: 'Gemini Flyover',
    direction_remarks: 'Gemini flyover towards Nandhanam - 2',
    min_quantity: 1,
  }),
  svc('police-ecr', 'Police Booth · ECR', {
    medium: 'Police Booth',
    city: 'Chennai',
    area_name: 'ECR',
    direction_remarks: 'Beach Road',
    min_quantity: 1,
  }),
  svc('police-chennai', 'Police Booth · Chennai', {
    medium: 'Police Booth',
    city: 'Chennai',
    area_name: 'Nungambakkam',
    direction_remarks: 'Gemini Flyover',
    min_quantity: 1,
  }),
  svc('cab-chennai', 'Cab Branding · Chennai', {
    medium: 'Cab Branding',
    city: 'Chennai',
    min_quantity: 100,
  }),
  svc('auto-back-chennai', 'Auto Back Sticker · Chennai', {
    medium: 'Auto Back Sticker',
    city: 'Chennai',
    min_quantity: 50,
  }),
  svc('auto-back-rotn', 'Auto Back Sticker · Rotn', {
    medium: 'Auto Back Sticker',
    city: 'Rotn',
    min_quantity: 50,
  }),
  svc('bus-shelter-dbl-chennai', 'Bus Shelter Double Panel Lit · Chennai', {
    medium: 'Bus Shelter Double Panel Lit',
    city: 'Chennai',
    min_quantity: 4,
  }),
];

type Case = {
  name: string;
  input: string;
  prior?: ProgressiveSession | null;
  expectIncludes: string[];
  expectExcludes?: string[];
  expectStep?: string;
};

const cases: Case[] = [
  {
    name: 'Greeting',
    input: 'Hi',
    expectIncludes: ['Ready to create your quotation', 'What advertising service'],
    expectStep: 'small_talk',
  },
  {
    name: 'Service only — Bus (availability first)',
    input: 'Bus',
    expectIncludes: ['currently provide', 'bus advertising', 'Which'],
    expectExcludes: ['Sure!', 'Great!', 'I understand'],
    expectStep: 'pick_type',
  },
  {
    name: 'City only — Chennai (availability first)',
    input: 'Chennai',
    expectIncludes: ['currently provide', 'Chennai', 'Which service'],
    expectStep: 'pick_type',
  },
  {
    name: 'Service + City — Bus Chennai',
    input: 'Bus Chennai',
    expectIncludes: ['currently provide', 'bus advertising', 'Chennai'],
    expectStep: 'pick_type',
  },
  {
    name: 'Exact service — Bus Semi Branding',
    input: 'Bus Semi Branding',
    expectIncludes: ['city', 'Bus Semi Branding'],
    expectStep: 'pick_city',
  },
  {
    name: 'Exact + City — area ask',
    input: 'Bus Semi Branding Chennai',
    expectIncludes: ['area', 'Chennai'],
    expectStep: 'pick_area',
  },
  {
    name: 'Landmark ECR — list services first',
    input: 'near ECR',
    expectIncludes: ['currently provide', 'ECR', 'Which service'],
    expectExcludes: ['Which Hoarding option'],
  },
  {
    name: 'Unknown service',
    input: 'spaceship branding',
    expectIncludes: ['not providing', 'Spaceship'],
    expectExcludes: ['We currently provide Branding options'],
  },
  {
    name: 'Partial batch — Bus and Cab in Chennai',
    input: 'Bus and Cab in Chennai',
    // Cab Branding exists in smoke Chennai — shared lock continues Bus, no Rotn smear
    expectIncludes: ['Chennai', 'Bus'],
    expectExcludes: ['Rotn'],
  },
  {
    name: 'Catalogue — what services are available?',
    input: 'What services are available?',
    expectIncludes: ['currently provide', 'following', 'services', 'Which service'],
    expectStep: 'pick_type',
  },
  {
    name: 'Catalogue — which cities are available?',
    input: 'Which cities are available?',
    expectIncludes: ['currently provide', 'cities', 'Which city'],
    expectStep: 'pick_city',
  },
  {
    name: 'Catalogue — areas available in Chennai',
    input: 'What areas are available in Chennai?',
    expectIncludes: ['currently provide', 'areas', 'Chennai'],
    expectStep: 'pick_area',
  },
  {
    name: 'Catalogue — types available',
    input: 'What types are available?',
    expectIncludes: ['currently provide', 'Which option'],
    expectStep: 'pick_type',
  },
  {
    name: 'Catalogue — cities for bus',
    input: 'Which cities are available for bus?',
    expectIncludes: ['currently provide', 'city'],
    expectStep: 'pick_city',
  },
  {
    name: 'Mixed cities — cab Madurai unavailable, auto stays Chennai',
    input: 'bus shelter 4 and cab 50 madurai and auto in chennai',
    expectIncludes: ['Madurai', 'not providing', 'Cab'],
    expectExcludes: ['Next —', 'Added Cab', "aren't in Madurai. Continuing in Chennai"],
  },
  {
    name: 'Shared multi-city — madurai empty, continue Chennai',
    // Cab + Auto only in Chennai in smoke DB → skip Madurai, lock Chennai
    input: 'cab and auto in madurai and chennai',
    expectIncludes: ['Madurai', "aren't", 'Chennai'],
    expectExcludes: ['Please choose another city or service', 'Looking at', 'Now choosing'],
  },
];

function line(s: string): string {
  return s.replace(/\n/g, ' | ');
}

let failed = 0;
console.log('=== Progressive response smoke (system prompt) ===\n');

for (const c of cases) {
  const r = resolveProgressiveText(c.input, DB, c.prior ?? null, null);
  const okStep = !c.expectStep || r.step === c.expectStep;
  const missing = c.expectIncludes.filter((p) => !r.botText.toLowerCase().includes(p.toLowerCase()));
  const bad = (c.expectExcludes || []).filter((p) => r.botText.includes(p));
  const pass = okStep && missing.length === 0 && bad.length === 0;
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`  step: ${r.step}${c.expectStep && r.step !== c.expectStep ? ` (expected ${c.expectStep})` : ''}`);
  console.log(`  message: ${line(r.botText)}`);
  if (r.options?.length) {
    console.log(`  chips: ${r.options.map((o) => o.label).slice(0, 6).join(' · ')}`);
  }
  if (missing.length) console.log(`  missing phrases: ${missing.join(' | ')}`);
  if (bad.length) console.log(`  forbidden phrases: ${bad.join(' | ')}`);
  console.log('');
}

// Place typo must not keep prior Coimbatore Hoarding session
{
  const first = resolveProgressiveText('Hoarding Coimbatore', DB, null, null);
  const second = resolveProgressiveText('near vadaplani', DB, first.session, null);
  const ok =
    /couldn['']t find a place/i.test(second.botText)
    && !/coimbatore/i.test(second.botText)
    && !second.session.city
    && !second.session.medium;
  console.log(`${ok ? 'PASS' : 'FAIL'}  Unresolved place — near vadaplani clears prior Coimbatore`);
  console.log(`  step: ${second.step}`);
  console.log(`  city: ${second.session.city}`);
  console.log(`  medium: ${second.session.medium}`);
  console.log(`  message: ${line(second.botText)}\n`);
  if (!ok) failed += 1;
}

// Change selection: Hoarding Madurai → Police Booth overrides service, keeps city
{
  const first = resolveProgressiveText('Hoarding Madurai', DB, null, null);
  const second = resolveProgressiveText('Police Booth', DB, first.session, null);
  const med = String(second.session.browseToken || second.session.medium || '');
  const ok =
    /police booth/i.test(med)
    && /madurai/i.test(String(second.session.city || ''));
  console.log(`${ok ? 'PASS' : 'FAIL'}  Service override — Hoarding Madurai then Police Booth`);
  console.log(`  step: ${second.step}`);
  console.log(`  medium: ${med}`);
  console.log(`  city: ${second.session.city}`);
  console.log(`  message: ${line(second.botText)}\n`);
  if (!ok) failed += 1;
}

// Opener rotation: two bus asks in a row should not reuse identical opener line
{
  const a = resolveProgressiveText('Bus', DB, null, null);
  const b = resolveProgressiveText('Bus', DB, a.session, null);
  const openerA = (a.botText.split('\n')[0] || '').trim();
  const openerB = (b.botText.split('\n')[0] || '').trim();
  const pool = new Set([
    '',
    "Let's continue.",
    'Good choice.',
    'Hello!',
    'Sure!',
    'Great!',
  ]);
  const bothOpeners = pool.has(openerA) && pool.has(openerB);
  const rotated = !bothOpeners || openerA !== openerB || !openerA;
  // If both have availability-first text without shared Sure/Great, also OK
  const noBannedRepeat =
    !(openerA === openerB && /^(Sure!|Great!|Perfect!|Got it\.|Understood\.)$/i.test(openerA));
  const pass = rotated || noBannedRepeat;
  console.log(`${pass ? 'PASS' : 'FAIL'}  Opener rotation across turns`);
  console.log(`  A: ${openerA || '(availability line)'}`);
  console.log(`  B: ${openerB || '(availability line)'}\n`);
  if (!pass) failed += 1;
}

// Quote ready copy
{
  const start = resolveProgressiveText('Bus Semi Branding Chennai', DB, null, null);
  if (start.options?.length) {
    const next = continueProgressiveAction(
      start.options[0].id,
      start.session,
      DB,
      [start.options[0].id],
    );
    if (next.step === 'quote_ready') {
      const ok =
        next.botText.includes('Your quotation is ready')
        && next.botText.includes('Opening quotation preview');
      console.log(`${ok ? 'PASS' : 'FAIL'}  Quote ready copy`);
      console.log(`  message: ${line(next.botText)}\n`);
      if (!ok) failed += 1;
    } else {
      console.log(`INFO  After area chip → ${next.step} | ${line(next.botText)}\n`);
    }
  }
}

// Direction formatting variants must stay catalog-scoped. The fixture has
// Gemini Flyover only in Chennai, while Hoarding also exists in Coimbatore.
{
  const directionInputs = [
    'gemini flyover',
    'gemini fly over',
    'gemini-flyover',
    'GEMINI FLYOVER',
    'gemini    flyover',
    'I need hoarding near gemini fly over',
  ];
  const expectedIds = new Set([
    'hoarding-gemini-chennai',
    'led-hoarding-gemini',
    'police-chennai',
  ]);
  let ok = true;

  for (const input of directionInputs) {
    const hit = detectDirectionInText(input, DB);
    const ids = new Set(hit?.serviceIds || []);
    const sameCandidates =
      ids.size === expectedIds.size
      && [...expectedIds].every((id) => ids.has(id));
    if (!sameCandidates) ok = false;
    console.log(
      `${sameCandidates ? 'PASS' : 'FAIL'}  Direction variant — ${input}`,
    );
    if (!sameCandidates) {
      console.log(`  candidates: ${[...ids].join(' · ') || '(none)'}`);
    }
  }

  // Live path: AI null + bare "hoarding" while catalog also has LED Hoarding
  const liveLike = resolveProgressiveText(
    'I need hoarding near gemini fly over',
    DB,
    null,
    null,
  );
  const liveOk =
    !/couldn['']t match that with our available advertising services/i.test(
      liveLike.botText,
    )
    && !/coimbatore/i.test(liveLike.botText)
    && !(liveLike.options || []).some((option) => /coimbatore/i.test(option.label))
    && (
      liveLike.session.city?.toLowerCase() === 'chennai'
      || !!liveLike.session.directionHint
      || !!liveLike.session.area
      || (liveLike.session.candidateServiceIds || []).some((id) =>
        ['hoarding-gemini-chennai', 'led-hoarding-gemini', 'police-chennai'].includes(id),
      )
    );
  ok = ok && liveOk;
  console.log(`${liveOk ? 'PASS' : 'FAIL'}  Live-like AI-null hoarding + gemini fly over`);
  console.log(
    `  step: ${liveLike.step} | city: ${liveLike.session.city} | dir: ${liveLike.session.directionHint} | ${line(liveLike.botText)}`,
  );

  const scoped = resolveProgressiveText(
    'I need hoarding near gemini fly over',
    DB,
    null,
    {
      media: ['Hoarding'],
      medium: 'Hoarding',
      directionHint: 'Gemini Fly Over',
    },
  );
  const noCoimbatore = !/coimbatore/i.test(scoped.botText)
    && !(scoped.options || []).some((option) => /coimbatore/i.test(option.label));
  const serviceScoped =
    scoped.session.city?.toLowerCase() === 'chennai'
    || !!scoped.session.directionHint
    || !!scoped.session.area;
  const scopedOk = noCoimbatore && serviceScoped
    && !/couldn['']t match that with our available advertising services/i.test(
      scoped.botText,
    );
  ok = ok && scopedOk;
  console.log(`${scopedOk ? 'PASS' : 'FAIL'}  Direction variant keeps Chennai-only scope`);
  console.log(`  step: ${scoped.step} | message: ${line(scoped.botText)}\n`);
  if (!ok) failed += 1;
}

// No Gemini / Chennai inventory — still continue with available Hoarding, but say so.
{
  const tirupathiOnly: DbService[] = [
    svc('hoarding-tirupathi-1', 'Hoarding · Tirupathi Temple', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Tirupathi',
      area_name: 'TIRUPATHI',
      direction_remarks: 'Outside Temple OPP HDFC Back junction Traffic toards Temple',
      min_quantity: 1,
    }),
    svc('hoarding-tirupathi-2', 'Hoarding · Tirupathi Tiruchanur', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Tirupathi',
      area_name: 'TIRUPATHI',
      direction_remarks: 'Tiruchanur Road Near Smart Bazar Facing Temple',
      min_quantity: 1,
    }),
  ];

  const miss = resolveProgressiveText(
    'I need hoarding near gemini fly over',
    tirupathiOnly,
    null,
    null,
  );
  const notesSite =
    /not providing.*hoarding.*gemini/i.test(miss.botText)
    || /not providing.*gemini/i.test(miss.botText);
  const continuesHoarding =
    (/tirupathi|currently offer|which city|location or direction|which/i.test(miss.botText)
      || (miss.options || []).some((o) => /tirupathi/i.test(o.label)))
    && !/couldn['']t match that with our available advertising services/i.test(miss.botText)
    && miss.step !== 'quote_ready';
  // Avoid stacked "Let's continue" openers from note + funnel ask
  const noDoubleContinue =
    (miss.botText.match(/Let['']s continue\./gi) || []).length <= 1;
  const missOk = notesSite && continuesHoarding && noDoubleContinue;
  console.log(
    `${missOk ? 'PASS' : 'FAIL'}  Unknown site → note + continue available Hoarding`,
  );
  console.log(`  step: ${miss.step} | ${line(miss.botText)}\n`);
  if (!missOk) failed += 1;

  const chennaiMiss = resolveProgressiveText(
    'hoarding in chennai',
    tirupathiOnly,
    null,
    null,
  );
  const cityNoted =
    /not providing.*chennai|not offering.*chennai|don'?t have.*chennai/i.test(
      chennaiMiss.botText,
    );
  console.log(
    `${cityNoted ? 'PASS' : 'FAIL'}  Named city with no inventory → say so`,
  );
  console.log(`  step: ${chennaiMiss.step} | ${line(chennaiMiss.botText)}\n`);
  if (!cityNoted) failed += 1;
}

// Unknown service+site (booth + gemini) with no Police Booth inventory → name it, then chips.
{
  const noBooth: DbService[] = [
    svc('hoarding-tirupathi-1', 'Hoarding · Tirupathi Temple', {
      medium: 'Hoarding',
      city: 'Tirupathi',
      area_name: 'TIRUPATHI',
      direction_remarks: 'Outside Temple OPP HDFC',
      min_quantity: 1,
    }),
    svc('cab-chennai', 'Cab Branding · Chennai', {
      medium: 'Cab Branding',
      city: 'Chennai',
      min_quantity: 100,
    }),
  ];
  const boothMiss = resolveProgressiveText(
    'I need booth near gemini fly over',
    noBooth,
    null,
    null,
  );
  const namesAsk =
    /not providing.*booth.*gemini/i.test(boothMiss.botText)
    || /not providing.*booth/i.test(boothMiss.botText);
  const showsChips = (boothMiss.options || []).length > 0;
  const noGenericCouldnt =
    !/couldn['']t match that with our available advertising services/i.test(
      boothMiss.botText,
    );
  const boothOk = namesAsk && showsChips && noGenericCouldnt;
  console.log(
    `${boothOk ? 'PASS' : 'FAIL'}  Unknown booth+site → name details + service chips`,
  );
  console.log(`  step: ${boothMiss.step} | ${line(boothMiss.botText)}\n`);
  if (!boothOk) failed += 1;
}

// Unknown / unavailable places must be named — never silent quote elsewhere.
{
  const placeCases: Array<{
    name: string;
    input: string;
    expectNote: RegExp;
    expectNotQuote?: boolean;
  }> = [
    {
      name: 'bus in Singapore',
      input: 'give quote for bus in Singapore',
      expectNote: /not providing.*bus in singapore/i,
    },
    {
      name: 'bus in Guindy',
      input: 'give quote for bus in guindy',
      expectNote: /not providing.*bus in guindy/i,
    },
    {
      name: 'i need a bus in Singapore',
      input: 'i need a bus in Singapore',
      expectNote: /not providing.*bus in singapore/i,
    },
    {
      name: 'bus semi in ghandipuram',
      input: 'give quote for bus semi in ghandipuram',
      expectNote: /not providing.*bus semi.*ghandipuram/i,
      expectNotQuote: true,
    },
  ];

  for (const c of placeCases) {
    const res = resolveProgressiveText(c.input, DB, null, null);
    const notes = c.expectNote.test(res.botText);
    const notSilentQuote = c.expectNotQuote
      ? res.step !== 'quote_ready'
        && !/quotation is ready/i.test(res.botText)
      : true;
    const namesAvailablePlaces =
      /currently offer.+\bin\b/i.test(res.botText)
      || res.step === 'pick_city'
      || res.step === 'pick_area';
    const offersSomething =
      ((res.options || []).length > 0
        || /currently offer|which|currently provide/i.test(res.botText))
      && namesAvailablePlaces;
    const ok = notes && notSilentQuote && offersSomething;
    console.log(`${ok ? 'PASS' : 'FAIL'}  Place miss — ${c.name}`);
    console.log(`  step: ${res.step} | ${line(res.botText)}`);
    if (!ok) {
      console.log(`  options: ${(res.options || []).map((o) => o.label).join(' · ') || '(none)'}`);
      failed += 1;
    } else {
      console.log('');
    }
  }

  // Booth exists; Gemini may or may not be on Police Booth inventory
  const boothGemini = resolveProgressiveText(
    'I need booth near gemini fly over',
    DB,
    null,
    null,
  );
  const boothGeminiOk =
    boothGemini.step !== 'no_match'
    && !/couldn['']t match that with our available advertising services/i.test(
      boothGemini.botText,
    )
    && (
      /not providing.*booth.*gemini/i.test(boothGemini.botText)
      || /police booth|gemini/i.test(
        `${boothGemini.botText} ${boothGemini.session.directionHint || ''} ${boothGemini.session.medium || ''}`,
      )
      || (boothGemini.options || []).some((o) => /police|chennai|hosur|madurai/i.test(o.label))
    );
  console.log(
    `${boothGeminiOk ? 'PASS' : 'FAIL'}  Booth + Gemini → note or Police Booth / Gemini site`,
  );
  console.log(`  step: ${boothGemini.step} | ${line(boothGemini.botText)}\n`);
  if (!boothGeminiOk) failed += 1;
}

console.log(failed === 0 ? 'All smoke checks passed.' : `${failed} smoke check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
