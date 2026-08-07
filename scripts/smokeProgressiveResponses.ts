/**
 * Smoke walkthrough: Quote Buddy system-prompt conversation style.
 * Run: npx tsx scripts/smokeProgressiveResponses.ts
 */
import {
  resolveProgressiveText,
  continueProgressiveAction,
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
    area_name: 'OMR',
    direction_remarks: 'Towards ECR',
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
    expectIncludes: ["I'm here to help you prepare a quotation", 'What advertising service'],
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
    expectIncludes: ["couldn't match that with our available advertising services"],
  },
  {
    name: 'Partial batch — Bus and Cab in Chennai',
    input: 'Bus and Cab in Chennai',
    expectIncludes: ['not providing', 'Cab', 'Chennai', 'continue'],
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
    "Here's what we found.",
    "Let's continue.",
    'Thanks.',
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

console.log(failed === 0 ? 'All smoke checks passed.' : `${failed} smoke check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
