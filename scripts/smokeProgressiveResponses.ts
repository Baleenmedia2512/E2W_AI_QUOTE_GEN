/**
 * Smoke walkthrough: Quote Buddy response-style prompt vs progressive engine.
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
    name: 'Service only — Bus',
    input: 'Bus',
    expectIncludes: ['Sure!', 'Which bus advertising service'],
    expectStep: 'pick_type',
  },
  {
    name: 'City only — Chennai',
    input: 'Chennai',
    expectIncludes: ['Sure!', 'Which advertising service do you need in Chennai'],
    expectStep: 'pick_type',
  },
  {
    name: 'Service + City — Bus Chennai',
    input: 'Bus Chennai',
    expectIncludes: ['Great!', 'Which bus advertising service do you need in Chennai'],
    expectStep: 'pick_type',
  },
  {
    name: 'Exact service — Bus Semi Branding',
    input: 'Bus Semi Branding',
    expectIncludes: ['Great!', 'Which city do you need Bus Semi Branding in'],
    expectStep: 'pick_city',
  },
  {
    name: 'Exact + City — Bus Semi Branding Chennai',
    input: 'Bus Semi Branding Chennai',
    expectIncludes: ['Great!', 'Which area in Chennai'],
    expectStep: 'pick_area',
  },
  {
    name: 'Unknown service',
    input: 'spaceship branding',
    expectIncludes: ["couldn't find that service"],
  },
  {
    name: 'Partial batch — Bus and Hoarding in Chennai',
    input: 'Bus and Hoarding in Chennai',
    expectIncludes: ["We're currently not offering", 'Chennai', "I'll continue"],
  },
];

function line(s: string): string {
  return s.replace(/\n/g, ' | ');
}

let failed = 0;
console.log('=== Progressive response smoke ===\n');

for (const c of cases) {
  const r = resolveProgressiveText(c.input, DB, c.prior ?? null, null);
  const okStep = !c.expectStep || r.step === c.expectStep;
  const missing = c.expectIncludes.filter((p) => !r.botText.includes(p));
  const pass = okStep && missing.length === 0;
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`  step: ${r.step}${c.expectStep && r.step !== c.expectStep ? ` (expected ${c.expectStep})` : ''}`);
  console.log(`  message: ${line(r.botText)}`);
  if (r.options?.length) {
    console.log(`  chips: ${r.options.map((o) => o.label).slice(0, 6).join(' · ')}`);
  }
  if (missing.length) console.log(`  missing phrases: ${missing.join(' | ')}`);
  console.log('');
}

// Change selection: Bus locked → user says Madurai (keep service)
{
  const first = resolveProgressiveText('Bus', DB, null, null);
  const second = resolveProgressiveText('Madurai', DB, first.session, null);
  const keep =
    !!(second.session.browseToken || second.session.medium)
    && /madurai/i.test(String(second.session.city || second.botText));
  console.log(`${keep ? 'PASS' : 'FAIL'}  Change selection — Bus then Madurai keeps service`);
  console.log(`  step: ${second.step}`);
  console.log(`  session medium/browse: ${second.session.browseToken || second.session.medium}`);
  console.log(`  session city: ${second.session.city}`);
  console.log(`  message: ${line(second.botText)}\n`);
  if (!keep) failed += 1;
}

// Chip city confirm → area/direction/quote path
{
  const start = resolveProgressiveText('Bus Semi Branding Chennai', DB, null, null);
  console.log(`INFO  Exact+City start → step=${start.step} | ${line(start.botText)}`);
  if (start.options?.length) {
    const next = continueProgressiveAction(
      start.options[0].id,
      start.session,
      DB,
      [start.options[0].id],
    );
    console.log(`INFO  After first chip → step=${next.step} | ${line(next.botText)}`);
    if (next.step === 'quote_ready') {
      const ok = next.botText.includes('Your quotation is ready');
      console.log(`${ok ? 'PASS' : 'FAIL'}  Quote ready copy`);
      if (!ok) failed += 1;
    }
  }
  console.log('');
}

console.log(failed === 0 ? 'All smoke checks passed.' : `${failed} smoke check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
