/**
 * Progressive quote chat — DB-backed matching with consultative sales-manager replies.
 * AI (optional) only helps parse intent; prices/services always come from DB.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * STRICT FUNNEL RULES (mandatory — do not weaken these without product sign-off)
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. Order: Service → Type → City → Area → Direction → Quote
 *    (Type ALWAYS before City — never ask city first then type then city again)
 * 2. City UI: when 2+ cities/places → checkbox multi-select (allowMulti=true) + Confirm
 * 3. Exactly 1 city → auto-lock and continue (no OK Continue tap)
 * 4. 0 / NA city → skip city step
 * 5. Multi-city / multi-area Confirm → then Direction/site checkboxes when 2+ sites
 *    under the selection (Area · direction chips); Confirm → ONE quote with those lines.
 *    Exactly 1 site → finalize. Never orphan "Next"; never skip the site ask when 2+.
 * 6. detectCityInText (user typing) = known metros for phrases like "in chennai".
 *    City chips / locks = raw metadata.city from DB (OMR, Padur, Chennai, …);
 *    if city blank → area_name. Never invent Chennai when DB only has OMR/Padur.
 * 7. Service + locality in text (e.g. "near omr hoarding") → match rows where
 *    metadata.city OR area_name contains that place; set area/placeHint;
 *    City step confirms the DB city label(s) in that pool (e.g. OMR) — never force metro
 * 8. Locking mediumType (type chip) MUST preserve city / area / placeHint / candidates
 * 9. Place-first (OMR/ECR): new medium chip KEEPS place; city Confirm uses DB city labels
 *    in that pool; clear place on medium change only when no placeHint/area is locked
 * 10. City chip pool MUST use same medium (+ mediumType if locked) filters as matching
 * 11. Direction: ask when 2+ distinct direction_remarks
 * 12. Family tokens (bus/led/booth/metro): only when token is NOT an exact catalog medium.
 *     Exact medium locked → Type = distinct metadata.medium_type from DB only.
 *     Bare family token → ask which catalog medium; never remount family after exact lock.
 *     "led" clarify also lists Non LED siblings (Mobile Van Non LED)
 * 13. Chip / ask lists use ONLY DB field values:
 *     medium · medium_type · city · area_name · direction_remarks
 *     (skip blank / NA; no medium_type whitelist invent)
 * 14. City match = metadata.city / area_name / locations (serviceMatchesCityLabel) — show DB values
 * 15. Place/area filters NEVER use direction_remarks — "TOWARDS VADAPALANI" ≠ Vadapalani;
 *     direction_remarks only for Direction step + detectDirectionInText (multi-word sites)
 * 16. Batch multi-service: dedupe family duplicates (metro elevated keeps, bare metro drops);
 *     then sequential per service Type → City → Area → Direction (ask only if 2+).
 *     Shared city in text → city-lock path (still sequential, no mega city×service grid).
 *     Metro Type = Station Elevated/Underground + Train Inside + Train Wrap
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  CLOUD_CITY_KEYS,
  ConfirmationRow,
  extractCityFromDbService,
  extractQueryWords,
  getMinQuantityFromDbService,
  serviceMatchesQuery,
} from './cloudQuoteValidation';
import { canonicalizeServiceName, KNOWN_CITY_LIST } from './serviceNameUtils';
import type { DbService } from './serviceResolver';
import { formatServiceDisplayName } from './serviceResolver';
import { resolveMediaAgainstCatalog } from '../services/chatIntentAiService';

const REAL_CITY_KEYS = [...new Set([...CLOUD_CITY_KEYS, ...KNOWN_CITY_LIST])]
  .map((c) => c.toLowerCase())
  .sort((a, b) => b.length - a.length);

/**
 * Product-approved Madurai misspellings only (not generic fuzzy cities).
 * Maps typed token → canonical metro key.
 */
const CITY_TYPO_ALIASES: Record<string, string> = {
  maddurai: 'madurai',
  maduari: 'madurai',
  madhurai: 'madurai',
  madaurai: 'madurai',
};

export type ProgressiveStep =
  | 'related_services'
  | 'did_you_mean'
  | 'pick_city'
  | 'pick_area'
  | 'pick_type'
  | 'pick_direction'
  | 'no_match'
  | 'min_qty_confirm'
  | 'quote_ready'
  | 'small_talk';

export interface ProgressiveOption {
  id: string;
  label: string;
  serviceId?: string;
  city?: string;
  medium?: string;
  /** DB medium_type discriminator (elevated / underground / …). */
  mediumType?: string;
  /** Group header label for grouped checklist (batch multi-select). */
  group?: string;
  /** Optional reference thumbnail from DB (omit when missing). */
  imageUrl?: string;
}

export interface BatchSegment {
  raw: string;
  token: string;
  qty: number | null;
  city: string | null;
}

export interface ProgressiveSession {
  originalText: string;
  medium?: string;
  /**
   * Selected DB medium_type (elevated / underground / Nonlit …) after type chip.
   * Left unset when user Confirms 2+ types on the same medium (union via candidates).
   */
  mediumType?: string;
  /**
   * True after type step was answered (single lock or multi-type Confirm union).
   * Prevents re-asking Frontlit/Nonlit after multi Confirm when mediumType is unset.
   */
  typesResolved?: boolean;
  /** Browse token from user text (bus, shelter, led) — broader than one medium key. */
  browseToken?: string;
  city?: string;
  area?: string;
  /**
   * Site / direction phrase from free text (e.g. "Gemini Flyover").
   * Used to narrow pool before asking Service → Type → City → Area.
   */
  directionHint?: string;
  /** Confirmed place hint from Did-you-mean (e.g. Gandhi Nagar) for batch/area. */
  placeHint?: string;
  qty: number | null;
  durationText?: string | null;
  candidateServiceIds?: string[];
  bestGuessServiceId?: string;
  bestGuessLabel?: string;
  /** Did-you-mean target: place name or service medium. */
  bestGuessKind?: 'place' | 'service';
  pendingRows?: ConfirmationRow[];
  /** Remaining media types for multi-service (legacy sequential — prefer segments batch). */
  pendingMedia?: string[];
  collectedRows?: ConfirmationRow[];
  collectedServiceIds?: string[];
  aiReply?: string | null;
  /** Last bot opening phrase — avoid repeating the same opener twice in a row. */
  lastOpener?: string | null;
  /** Rotation index for deterministic opener variety. */
  openerIdx?: number;
  /** Last no-match / unavailable message key — avoid identical error loops. */
  lastErrorKey?: string | null;
  /** Multi-service batch: parsed qty+token segments from one message. */
  segments?: BatchSegment[];
  /** Per service_id quantity from segment parsing. */
  qtyByServiceId?: Record<string, number>;
  /**
   * Compact batch chip id → service ids (avoids megabyte `batch-group:uuid,uuid,...` strings).
   */
  batchGroupMap?: Record<string, string[]>;
  /**
   * Remaining cities to process sequentially after multi-city Confirm
   * (area → direction for each).
   */
  pendingCityQueue?: string[];
  /**
   * Remaining batch work items (service + city) after multi-select Confirm.
   */
  workQueue?: Array<{
    medium: string;
    browseToken?: string;
    qty: number | null;
    city?: string;
    area?: string;
    candidateServiceIds?: string[];
  }>;
  /**
   * Display names for multi-service batch (shown on chip cards as “Selected services”).
   */
  batchServiceLabels?: string[];
  /** Requested services not offered in the locked city (e.g. Cab in Madurai). */
  batchUnavailableLabels?: string[];
  /** One-shot note: "We currently don’t offer Cab in Madurai." */
  batchUnavailableNote?: string;
  /** True after the unavailable note was shown once in botText. */
  batchUnavailableSpoken?: boolean;
  /**
   * Place-only browse (e.g. "hosur"/"madurai") — block silent quote finalize
   * until the user picks a service chip or Continue.
   */
  needsContinueConfirm?: boolean;
}

export interface ProgressiveTurnResult {
  step: ProgressiveStep;
  botText: string;
  options: ProgressiveOption[];
  allowMulti?: boolean;
  session: ProgressiveSession;
  /** When set, caller should generate quote immediately */
  quoteRows?: ConfirmationRow[];
  /** Service names auto-confirmed without city question (rendered as a badge list in UI). */
  autoConfirmedList?: string[];
  /** Min-qty details for each service below minimum (rendered as a structured card). */
  belowMinDetails?: Array<{
    service: string;
    requested: number;
    minimum: number;
    serviceId?: string;
  }>;
}

/** Five DB funnel fields for simple console REQ/RES logs. */
function sessionFiveFields(s?: ProgressiveSession | null) {
  return {
    medium: s?.medium || null,
    mediumType: s?.mediumType || null,
    city: s?.city || null,
    area: s?.area || s?.placeHint || null,
    direction: s?.directionHint || null,
  };
}

function logFunnelReq(
  kind: 'text' | 'action',
  payload: { text?: string; action?: string; selected?: string[]; session?: ProgressiveSession | null },
): void {
  console.log('[funnel] REQ', {
    kind,
    text: payload.text || null,
    action: payload.action || null,
    selected: payload.selected?.length ? payload.selected : null,
    session: sessionFiveFields(payload.session),
  });
}

function logFunnelRes(result: ProgressiveTurnResult): void {
  console.log('[funnel] RES', {
    step: result.step,
    botText: result.botText,
    chips: result.options.map((o) => o.label),
    session: sessionFiveFields(result.session),
  });
}

const STOP_WORDS = new Set([
  'need', 'for', 'the', 'a', 'an', 'in', 'at', 'of', 'and', 'i', 'want', 'please',
  'generate', 'quote', 'quotation', 'create', 'price', 'cost', 'rates', 'rate',
  'services', 'service', 'ads', 'advertising', 'outdoor', 'some', 'any', 'get', 'give',
  'me', 'my', 'to', 'with', 'looking', 'show', 'list', 'available', 'all', 'options',
  'days', 'day', 'months', 'month', 'weeks', 'week',
]);

function titleCase(s: string): string {
  return s
    .split(/[\s_/]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^(led|lcd|fm|tv|ac)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Short family tokens that sound like vehicles/things — clarify we mean advertising. */
const FAMILY_NEEDS_ADS_WORD = new Set([
  'bus', 'auto', 'cab', 'taxi', 'car', 'van', 'metro', 'train', 'truck', 'bike',
]);

/**
 * Sales-facing product label.
 * "bus" → "bus advertising" (not vehicle type); "Police Booth" / "Bus Shelter" stay as-is.
 */
function salesAdLabel(token: string | undefined | null): string {
  const raw = String(token || '').trim();
  if (!raw || raw.toLowerCase() === 'this' || raw.toLowerCase() === 'that') {
    return 'this service';
  }
  const key = canonicalizeServiceName(raw);
  const label = titleCase(raw);
  if (FAMILY_NEEDS_ADS_WORD.has(key)) {
    return `${label.toLowerCase()} advertising`;
  }
  return label;
}

/**
 * Response style (Quote Buddy AI System Prompt):
 * Availability first → ask only next missing step → rotate openings → max 2–3 sentences.
 * Never invent inventory; never say "database".
 */
const OPENER_POOL = [
  '',
  "Here's what we found.",
  "Let's continue.",
  'Thanks.',
  'Good choice.',
  'Hello!',
] as const;

function familyWord(token?: string | null): string {
  const key = canonicalizeServiceName(token || '');
  if (FAMILY_NEEDS_ADS_WORD.has(key)) return key;
  return titleCase(token || 'advertising');
}

/** Exact-ish catalog medium: multi-word / not bare family token. */
function isExactCatalogMediumShape(token: string): boolean {
  const key = canonicalizeServiceName(token);
  if (!key || FAMILY_NEEDS_ADS_WORD.has(key)) return false;
  return key.includes(' ') || key.length > 12;
}

function pickOpener(
  session: ProgressiveSession | null | undefined,
  preferred: readonly string[] = OPENER_POOL,
): string {
  const last = (session?.lastOpener || '').trim();
  const ordered = preferred.filter((o) => o !== last);
  const pool = ordered.length ? ordered : [...preferred];
  const idx = typeof session?.openerIdx === 'number' ? session.openerIdx : 0;
  return pool[Math.abs(idx) % pool.length] ?? '';
}

function composeReply(
  session: ProgressiveSession | null | undefined,
  parts: { avail?: string | null; ask?: string | null; preferredOpeners?: readonly string[] },
): { text: string; opener: string } {
  const opener = pickOpener(session, parts.preferredOpeners || OPENER_POOL);
  const lines = [opener, parts.avail, parts.ask]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  return { text: lines.join('\n\n'), opener };
}

function stampReplyMeta(
  session: ProgressiveSession,
  opener: string,
  errorKey?: string | null,
): ProgressiveSession {
  return {
    ...session,
    lastOpener: opener,
    openerIdx: ((session.openerIdx || 0) + 1) % 48,
    lastErrorKey: errorKey === undefined ? session.lastErrorKey : errorKey,
  };
}

function withComposedReply(
  result: ProgressiveTurnResult,
  parts: { avail?: string | null; ask?: string | null; preferredOpeners?: readonly string[]; errorKey?: string | null },
): ProgressiveTurnResult {
  // Prefer fresh availability copy over a stale AI shortReply / wrong-step reply
  const { text, opener } = composeReply(result.session, parts);
  return {
    ...result,
    botText: text,
    session: stampReplyMeta(result.session, opener, parts.errorKey),
  };
}

function stampResultOpener(result: ProgressiveTurnResult): ProgressiveTurnResult {
  const first = (result.botText || '').split('\n')[0]?.trim() || '';
  const known = new Set<string>([
    ...OPENER_POOL,
    'Sure!',
    'Great!',
    'Perfect!',
    'Got it.',
    'Understood.',
    'I understand',
  ]);
  const opener =
    known.has(first)
    || /^(Sure!|Great!|Perfect!|Hello!|Thanks\.|Let's continue\.|Here's what we found\.|Good choice\.)$/i.test(first)
      ? first
      : (result.session.lastOpener || '');
  return {
    ...result,
    session: stampReplyMeta(result.session, opener),
  };
}

function copyAskType(
  token?: string | null,
  session?: ProgressiveSession | null,
): string {
  const key = canonicalizeServiceName(token || '');
  const avail = FAMILY_NEEDS_ADS_WORD.has(key)
    ? `We currently provide ${key} advertising services.`
    : `We currently provide ${titleCase(token || 'advertising')} options.`;
  const ask = FAMILY_NEEDS_ADS_WORD.has(key)
    ? `Which ${key} advertising service do you need?`
    : token && isExactCatalogMediumShape(token)
      ? `Which option do you need for ${titleCase(token)}?`
      : `Which ${familyWord(token)} service would you like?`;
  return composeReply(session, { avail, ask }).text;
}

function copyAskCities(
  medium?: string | null,
  session?: ProgressiveSession | null,
): string {
  const svc = titleCase(medium || 'this service');
  return composeReply(session, {
    avail: `This service is available in more than one city.`,
    ask: `Which city do you need ${svc} in?`,
  }).text;
}

function formatPlacePrep(place: string): string {
  const cleaned = place.replace(/^near\s+/i, '').trim();
  const parts = cleaned.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  const landmark = parts.find((p) => /^(omr|ecr|airport)\b/i.test(p));
  if (landmark) return `near ${landmark}`;
  if (/^(omr|ecr|airport)\b/i.test(cleaned)) return `near ${cleaned}`;
  return `in ${cleaned}`;
}

function copyPlaceServices(
  place: string,
  session?: ProgressiveSession | null,
): string {
  return composeReply(session, {
    avail: `We currently provide the following services ${formatPlacePrep(place)}.`,
    ask: 'Which service would you like?',
  }).text;
}

function copySingleServiceAtPlace(
  service: string,
  place: string,
  session?: ProgressiveSession | null,
): string {
  return composeReply(session, {
    avail: `We currently provide ${titleCase(service)} services ${formatPlacePrep(place)}.`,
    preferredOpeners: ["Here's what we found.", "Let's continue.", ''],
  }).text;
}

/** Family/service at a place → availability + type ask. */
function copyAskTypeAtPlace(
  medium: string | undefined | null,
  place: string,
  session?: ProgressiveSession | null,
): string {
  const key = canonicalizeServiceName(medium || '');
  const near = formatPlacePrep(place);
  if (FAMILY_NEEDS_ADS_WORD.has(key)) {
    return composeReply(session, {
      avail: `We currently provide ${key} advertising services ${near}.`,
      ask: `Which ${key} advertising service do you need?`,
    }).text;
  }
  const svc = titleCase(medium || 'this');
  return composeReply(session, {
    avail: `We currently provide ${svc} services ${near}.`,
    ask: `Which ${svc} option would you like?`,
  }).text;
}

/** Type-step copy: never reuse place “which service?” reply after medium was auto-locked. */
function typeStepBotText(
  reply: string | null | undefined,
  medium: string | undefined,
  place?: string | null,
  session?: ProgressiveSession | null,
): string {
  const placeAsk =
    !!reply
    && (/which (advertising )?service/i.test(reply)
      || /following services/i.test(reply)
      || /here[’']s what we (offer|found)/i.test(reply)
      || /looking in /i.test(reply)
      || /^sure!/i.test(reply.trim())
      || /^great!/i.test(reply.trim()));
  if (place && medium && (!reply || placeAsk || /which city/i.test(reply))) {
    return copyAskTypeAtPlace(medium, place, session);
  }
  if (reply && !placeAsk && !/which city/i.test(reply) && /currently provide/i.test(reply)) {
    return reply;
  }
  return copyAskType(medium, session);
}

function copyAskArea(
  city?: string | null,
  medium?: string | null,
  session?: ProgressiveSession | null,
): string {
  const svc = titleCase(medium || 'this service');
  if (city) {
    return composeReply(session, {
      avail: `${svc} is available in more than one area in ${city}.`,
      ask: `Which area do you need?`,
    }).text;
  }
  return composeReply(session, {
    avail: `${svc} covers more than one area.`,
    ask: 'Which area do you need?',
  }).text;
}

function copyAskDirection(
  locationLabel: string,
  mediumName: string,
  session?: ProgressiveSession | null,
): string {
  const loc = locationLabel || 'that area';
  return composeReply(session, {
    avail: `${mediumName} in ${loc} has a few sites available.`,
    ask: 'Which location or direction would you like?',
  }).text;
}

function copyQuoteReady(): string {
  return 'Your quotation is ready.\n\nOpening quotation preview.';
}

function copyUnknownService(session?: ProgressiveSession | null): string {
  return composeReply(session, {
    avail: "I couldn't match that with our available advertising services.",
    ask: 'Please choose one of the options below.',
    preferredOpeners: ['', "Here's what we found.", 'Hello!'],
  }).text;
}

function copyUnknownCity(city: string, session?: ProgressiveSession | null): string {
  const key = `city:${canonicalizeServiceName(city)}`;
  if (session?.lastErrorKey === key) {
    return composeReply(session, {
      avail: `Still no services for ${city} in our list.`,
      ask: 'Please try another city or pick a service first.',
      preferredOpeners: ["Let's continue.", 'Thanks.', ''],
    }).text;
  }
  return composeReply(session, {
    avail: `We're currently not providing services in ${city}.`,
    ask: 'Please choose another city.',
    preferredOpeners: ['', "Here's what we found."],
  }).text;
}

function copyUnknownArea(area: string, session?: ProgressiveSession | null): string {
  const key = `area:${canonicalizeServiceName(area)}`;
  if (session?.lastErrorKey === key) {
    return composeReply(session, {
      avail: `Still no match for ${area} with this service.`,
      ask: 'Please pick another available area.',
      preferredOpeners: ["Let's continue.", ''],
    }).text;
  }
  return composeReply(session, {
    avail: `We're currently not providing this service in ${area}.`,
    ask: 'Please choose another available area.',
    preferredOpeners: ['', "Here's what we found."],
  }).text;
}

function copyNotOfferedInCity(
  service: string,
  city: string,
  session?: ProgressiveSession | null,
): string {
  return composeReply(session, {
    avail: `We're currently not providing ${titleCase(service)} services in ${city}.`,
    ask: `Here are the services we currently provide in ${city}.`,
    preferredOpeners: ['', "Here's what we found.", "Let's continue."],
  }).text;
}

function copyGreeting(): string {
  return "Hi! 👋 I'm here to help you prepare a quotation.\n\nWhat advertising service are you looking for?";
}

function copyWhichService(session?: ProgressiveSession | null): string {
  return composeReply(session, {
    avail: undefined,
    ask: 'What advertising service are you looking for?',
    preferredOpeners: ['Hello!', '', "Let's continue."],
  }).text;
}

/** Catalogue Q&A: "what services/cities/areas/types are available?" */
export type CatalogueBrowseKind = 'services' | 'cities' | 'areas' | 'types';

/**
 * Detect listing / availability questions (not a plain quote request).
 * Examples: "what services are available?", "which cities?", "areas available in chennai"
 */
export function detectCatalogueBrowseQuery(text: string): CatalogueBrowseKind | null {
  const t = (text || '').trim();
  if (!t) return null;

  if (/^services?\??$/i.test(t)) return 'services';
  if (/^(cities|locations?)\??$/i.test(t)) return 'cities';
  if (/^areas?\??$/i.test(t)) return 'areas';
  if (/^(types?|options?)\??$/i.test(t)) return 'types';

  const lower = t.toLowerCase();
  const listing =
    /\b(what|which|list|show|tell\s+me)\b/.test(lower)
    || /\b(available|availability)\b/.test(lower)
    || /\bdo you (offer|have|provide)\b/.test(lower)
    || /\bwhat('?s| is) available\b/.test(lower);

  if (!listing) return null;

  // Prefer specific axis (types before services — "service types")
  if (/\b(service\s+types?|types?|variants?)\b/.test(lower)) return 'types';
  if (/\b(areas?|localit(?:y|ies)|neighbourhoods?|neighborhoods?)\b/.test(lower)) {
    return 'areas';
  }
  if (/\b(cities|city|locations?|metros?)\b/.test(lower)) return 'cities';
  if (/\b(services?|products?|media)\b/.test(lower)) return 'services';
  if (
    /\bwhat('?s| is) available\b/.test(lower)
    || /\bdo you (offer|have|provide)\b/.test(lower)
  ) {
    return 'services';
  }
  return null;
}

/**
 * Answer catalogue questions with DB chips — picking a chip continues into the quote funnel.
 */
function startCatalogueBrowse(
  kind: CatalogueBrowseKind,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const scopedCity = session.city;
  const scopedMed = session.browseToken || session.medium;
  let pool = [...services];
  if (scopedCity) {
    pool = pool.filter((s) => serviceMatchesCityLabel(s, scopedCity));
  }
  // Cities/areas/types can be scoped to a named service; "what services?" lists the full menu
  if (kind !== 'services' && scopedMed) {
    const by = filterForBrowseOrFamily(pool, scopedMed);
    if (by.length) pool = by;
  }

  if (!pool.length) {
    if (scopedCity) {
      return {
        step: 'no_match',
        botText: copyUnknownCity(scopedCity, session),
        options: [],
        session: stampReplyMeta(session, '', `browse:${kind}:${scopedCity}`),
      };
    }
    return softClarifyNeed(services, session, reply);
  }

  if (kind === 'services') {
    const options = uniqueMediumOnlyOptions(pool).slice(0, 40);
    if (!options.length) {
      return softClarifyNeed(services, session, reply);
    }
    const { text, opener } = composeReply(session, {
      avail: scopedCity
        ? `We currently provide the following services in ${scopedCity}.`
        : 'We currently provide the following advertising services.',
      ask: 'Which service would you like?',
      preferredOpeners: ["Here's what we found.", '', 'Hello!'],
    });
    return {
      step: 'pick_type',
      botText: reply || text,
      options,
      allowMulti: true,
      session: stampReplyMeta(
        {
          ...session,
          // Fresh service pick from catalogue
          medium: undefined,
          browseToken: undefined,
          mediumType: undefined,
          typesResolved: undefined,
          candidateServiceIds: pool.map((s) => s.service_id),
          needsContinueConfirm: false,
        },
        opener,
      ),
    };
  }

  if (kind === 'cities') {
    const options = uniqueCityOptionsFromPool(pool, scopedMed).slice(0, 40);
    if (!options.length) {
      return {
        step: 'no_match',
        botText: composeReply(session, {
          avail: scopedMed
            ? `We're currently not listing cities for ${titleCase(scopedMed)}.`
            : "We're currently not listing cities.",
          ask: 'Please choose a service first, or try another question.',
        }).text,
        options: uniqueMediumOnlyOptions(services).slice(0, 24),
        allowMulti: true,
        session: stampReplyMeta(
          { ...session, medium: undefined, browseToken: undefined },
          '',
          `browse:cities:empty`,
        ),
      };
    }
    if (options.length === 1) {
      return advanceFunnel(
        lockOneCity(
          {
            ...session,
            medium: scopedMed ? canonicalizeServiceName(scopedMed) : session.medium,
            browseToken: scopedMed ? canonicalizeServiceName(scopedMed) : session.browseToken,
            candidateServiceIds: pool.map((s) => s.service_id),
          },
          pool,
          options[0].city || options[0].label,
        ),
        services,
        reply
          || composeReply(session, {
            avail: `We currently provide${scopedMed ? ` ${titleCase(scopedMed)}` : ''} services in ${options[0].label}.`,
          }).text,
      );
    }
    const { text, opener } = composeReply(session, {
      avail: scopedMed
        ? `We currently provide ${titleCase(scopedMed)} in these cities.`
        : 'We currently provide services in these cities.',
      ask: 'Which city would you like?',
      preferredOpeners: ["Here's what we found.", '', "Let's continue."],
    });
    return {
      step: 'pick_city',
      botText: reply || text,
      options,
      allowMulti: true,
      session: stampReplyMeta(
        {
          ...session,
          candidateServiceIds: pool.map((s) => s.service_id),
          needsContinueConfirm: false,
        },
        opener,
      ),
    };
  }

  if (kind === 'areas') {
    const options = uniqueAreaOptionsFromPool(pool, scopedCity, scopedMed).slice(0, 40);
    if (!options.length) {
      return {
        step: 'no_match',
        botText: composeReply(session, {
          avail: scopedCity
            ? `We're currently not listing areas in ${scopedCity}.`
            : "We're currently not listing areas for that selection.",
          ask: 'Please choose a city or service, or pick from the options below.',
        }).text,
        options: scopedCity
          ? uniqueMediumOnlyOptions(pool).slice(0, 24)
          : uniqueCityOptionsFromPool(services).slice(0, 24),
        allowMulti: true,
        session: stampReplyMeta(session, '', 'browse:areas:empty'),
      };
    }
    if (options.length === 1) {
      return advanceFunnel(
        {
          ...session,
          area: options[0].label,
          placeHint: options[0].label,
          candidateServiceIds: pool.map((s) => s.service_id),
        },
        services,
        reply
          || composeReply(session, {
            avail: `We currently provide services in ${options[0].label}${scopedCity ? ` · ${scopedCity}` : ''}.`,
          }).text,
      );
    }
    const { text, opener } = composeReply(session, {
      avail: scopedCity
        ? `We currently provide services in these areas in ${scopedCity}.`
        : 'We currently provide services in these areas.',
      ask: 'Which area would you like?',
      preferredOpeners: ["Here's what we found.", '', "Let's continue."],
    });
    return {
      step: 'pick_area',
      botText: reply || text,
      options,
      allowMulti: true,
      session: stampReplyMeta(
        {
          ...session,
          candidateServiceIds: pool.map((s) => s.service_id),
          needsContinueConfirm: false,
        },
        opener,
      ),
    };
  }

  // types
  const exact = scopedMed && isExactCatalogMedium(scopedMed, services);
  const options = (
    exact
      ? uniqueTypeOnlyOptions(pool, scopedMed)
      : uniqueMediumLabelsWithExamples(pool)
  ).slice(0, 40);
  if (!options.length) {
    return startCatalogueBrowse('services', session, services, reply);
  }
  if (options.length === 1) {
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(options[0].medium || scopedMed || ''),
        mediumType: options[0].mediumType
          ? canonicalizeServiceName(options[0].mediumType)
          : session.mediumType,
        typesResolved: true,
        browseToken: canonicalizeServiceName(options[0].medium || scopedMed || ''),
        candidateServiceIds: pool.map((s) => s.service_id),
      },
      services,
      reply,
    );
  }
  const { text, opener } = composeReply(session, {
    avail: scopedMed
      ? `We currently provide these ${titleCase(scopedMed)} options${scopedCity ? ` in ${scopedCity}` : ''}.`
      : scopedCity
        ? `We currently provide these options in ${scopedCity}.`
        : 'We currently provide these service types.',
    ask: 'Which option would you like?',
    preferredOpeners: ["Here's what we found.", '', "Let's continue."],
  });
  return {
    step: 'pick_type',
    botText: reply || text,
    options,
    allowMulti: true,
    session: stampReplyMeta(
      {
        ...session,
        candidateServiceIds: pool.map((s) => s.service_id),
        needsContinueConfirm: false,
      },
      opener,
    ),
  };
}

/** Labels for every collected batch line (not just the last). */
function collectedServiceLabels(
  rows: ConfirmationRow[] | undefined,
): string | null {
  if (!rows?.length) return null;
  const names = [
    ...new Set(
      rows
        .map((r) => (r.service || '').split(/[·—–]/)[0].trim())
        .filter(Boolean),
    ),
  ];
  if (!names.length) return null;
  if (names.length <= 8) return names.join(', ');
  return `${names.slice(0, 6).join(', ')} +${names.length - 6} more`;
}

/** @deprecated Prefer collectedServiceLabels for batch "Added …" copy. */
function lastCollectedServiceLabel(
  rows: ConfirmationRow[] | undefined,
): string | null {
  return collectedServiceLabels(rows);
}

/**
 * Batch handoff: what we locked → what’s next (conversational).
 */
function copyBatchNextService(opts: {
  finishedLabel?: string | null;
  nextLabel: string;
  city?: string;
  remainingAfter: number;
}): string {
  const where = opts.city ? ` in ${opts.city}` : '';
  const added = opts.finishedLabel
    ? `Added ${opts.finishedLabel}.\n\n`
    : '';
  return `${added}Next — ${opts.nextLabel}${where}.`;
}

function copyBatchStepWhy(step: ProgressiveStep | string | undefined): string {
  switch (step) {
    case 'pick_type':
      return ' Which option do you need';
    case 'pick_area':
      return ' Which area do you need';
    case 'pick_direction':
      return ' Which location or direction would you like';
    case 'pick_city':
      return ' Which city do you need';
    default:
      return '';
  }
}

function copyBatchStart(city: string, count: number, firstLabel: string): string {
  return `Looking at ${count} services in ${city}.\n\nNext — ${firstLabel}.`;
}

function withBatchStepPrompt(
  result: ProgressiveTurnResult,
  handoff: string,
): ProgressiveTurnResult {
  const why = copyBatchStepWhy(result.step);
  if (!handoff.trim()) return result;
  // Prefer short handoff + why (avoid stacking long paragraphs)
  if (result.step === 'min_qty_confirm' || result.step === 'quote_ready') {
    return result;
  }
  return {
    ...result,
    botText: `${handoff}${why}.`.replace(/\.\./g, '.'),
  };
}

type BatchWorkItem = {
  medium: string;
  browseToken?: string;
  qty: number | null;
  city?: string;
  area?: string;
  candidateServiceIds?: string[];
};

function poolForBatchWork(services: DbService[], w: BatchWorkItem): DbService[] {
  let pool = w.candidateServiceIds?.length
    ? services.filter((s) => w.candidateServiceIds!.includes(s.service_id))
    : [...services];
  const token = w.browseToken || w.medium;
  if (w.medium && isExactCatalogMedium(w.medium, services)) {
    const exact = filterByExactMedium(pool, w.medium);
    if (exact.length) pool = exact;
  } else if (token) {
    const browse = filterForBrowseOrFamily(pool, token);
    if (browse.length) pool = browse;
  }
  if (w.city) {
    const scoped = pool.filter((s) => serviceMatchesCityLabel(s, w.city!));
    if (scoped.length) pool = scoped;
  }
  return pool;
}

/**
 * Auto-resolve a batch work item when every funnel step has 0/1 DB option.
 * Returns null if any step has 2+ choices (must ask the user).
 */
function tryAutoResolveBatchWork(
  w: BatchWorkItem,
  services: DbService[],
): { reps: DbService[]; label: string; city?: string } | null {
  let pool = poolForBatchWork(services, w);
  if (!pool.length) return null;

  let medium = canonicalizeServiceName(w.medium);
  let mediumType: string | undefined;

  if (!isExactCatalogMedium(medium, services)) {
    const familyTok = canonicalizeServiceName(w.browseToken || medium);
    if (isMetroSegmentToken(familyTok)) {
      pool = mergeMetroFamilyServices(services, pool);
    }
    const mediums = uniqueMediumOnlyOptions(pool);
    if (mediums.length > 1) return null;
    if (mediums.length === 1) {
      medium = canonicalizeServiceName(mediums[0].medium || medium);
      const exact = filterByExactMedium(pool, medium);
      if (exact.length) pool = exact;
    } else {
      const familyOpts = uniqueMediumLabelsWithExamples(pool);
      if (familyOpts.length > 1) return null;
      if (familyOpts.length === 1) {
        medium = canonicalizeServiceName(familyOpts[0].medium || medium);
        mediumType = familyOpts[0].mediumType
          ? canonicalizeServiceName(familyOpts[0].mediumType)
          : undefined;
      }
    }
  }

  const types = uniqueTypeOnlyOptions(pool, medium);
  if (types.length > 1) return null;
  if (types.length === 1) {
    mediumType = canonicalizeServiceName(types[0].mediumType || types[0].label);
    const typed = pool.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mediumType;
    });
    if (typed.length) pool = typed;
  }

  let city = w.city;
  const cities = uniqueCityOptionsFromPool(pool, medium);
  if (!city) {
    if (cities.length > 1) return null;
    if (cities.length === 1) city = cities[0].city || cities[0].label;
  }
  if (city) {
    const scoped = pool.filter((s) => serviceMatchesCityLabel(s, city!));
    if (scoped.length) pool = scoped;
  }

  const areas = uniqueAreaOptionsFromPool(pool, city, medium);
  if (areas.length > 1) return null;
  if (areas.length === 1) {
    const aKey = canonicalizeServiceName(areas[0].label);
    const narrowed = pool.filter(
      (s) => canonicalizeServiceName(getFunnelAreaLabel(s) || '') === aKey,
    );
    if (narrowed.length) pool = narrowed;
  }

  const withDir = pool.filter((s) => !!getDirectionLabel(s));
  const dirKeys = [
    ...new Set(
      withDir
        .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
        .filter(Boolean),
    ),
  ];
  if (dirKeys.length > 1) return null;

  const rep = (dirKeys.length === 1 ? withDir[0] : undefined) || pool[0];
  if (!rep) return null;

  const label = mediumType
    ? `${titleCase(medium)} — ${titleCase(mediumType)}`
    : titleCase(w.browseToken || medium);

  return { reps: [rep], label, city };
}

/**
 * Split batch work: auto-add skippable services, keep only items that need a choice.
 */
function partitionBatchWork(
  workItems: BatchWorkItem[],
  services: DbService[],
  session: ProgressiveSession,
  qtyByServiceId: Record<string, number>,
): {
  needAsk: BatchWorkItem[];
  seedRows: ConfirmationRow[];
  seedIds: string[];
  autoLabels: string[];
} {
  const needAsk: BatchWorkItem[] = [];
  const autoLabels: string[] = [];
  let seedRows: ConfirmationRow[] = [...(session.collectedRows || [])];
  let seedIds: string[] = [...(session.collectedServiceIds || [])];

  for (const w of workItems) {
    const resolved = tryAutoResolveBatchWork(w, services);
    if (!resolved) {
      needAsk.push(w);
      continue;
    }
    autoLabels.push(resolved.label);
    const built = buildRowsForServices(
      resolved.reps,
      w.qty,
      session.durationText,
      session.originalText,
      {
        ...qtyByServiceId,
        ...Object.fromEntries(
          resolved.reps.map((r) => [r.service_id, w.qty ?? qtyByServiceId[r.service_id]]),
        ),
      },
    );
    seedRows = [...seedRows, ...built.rows];
    seedIds = [...seedIds, ...resolved.reps.map((r) => r.service_id)];
  }

  return { needAsk, seedRows, seedIds, autoLabels };
}

function copyBatchAutoAddedThenAsk(
  autoLabels: string[],
  nextLabel: string,
  city?: string,
): string {
  const where = city ? ` in ${city}` : '';
  const added = autoLabels.length
    ? `Added ${autoLabels.join(', ')}.\n\n`
    : '';
  return `${added}Next — ${nextLabel}${where}.`;
}

function matchKnownCityLabel(value: string): string | null {
  const lower = value.toLowerCase().trim();
  if (!lower) return null;
  const exact = REAL_CITY_KEYS.find((c) => lower === c);
  if (exact) return exact.charAt(0).toUpperCase() + exact.slice(1);
  // "Chennai North" ok — but not "PAN India (except Mumbai)" via substring
  const prefixed = REAL_CITY_KEYS.find(
    (c) =>
      lower.startsWith(`${c} `)
      || lower.startsWith(`${c},`)
      || lower.startsWith(`${c}-`)
      || lower.startsWith(`${c}/`),
  );
  if (prefixed) return prefixed.charAt(0).toUpperCase() + prefixed.slice(1);
  return null;
}

function isKnownCityKey(value: string): boolean {
  return !!matchKnownCityLabel(value);
}

function metaFieldClean(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s || s.toUpperCase() === 'NA') return null;
  return s;
}

/** Raw metadata.city (may be a metro OR a locality like Padur). */
function getMetaCityRaw(svc: DbService): string | null {
  return metaFieldClean((svc.metadata as { city?: string } | undefined)?.city);
}

/**
 * City for funnel chips / locks — what the DB actually stores.
 * 1) metadata.city as-is (OMR, Padur, Chennai, …)
 * 2) if blank → area_name / area
 * Never invent a metro (Chennai) when the row only has OMR/Padur.
 */
function funnelCityFromDb(svc: DbService): string | null {
  const raw = getMetaCityRaw(svc);
  if (raw && !isNumericOnlyLabel(raw) && !isDirectionLikeLabel(raw)) {
    return matchKnownCityLabel(raw) || titleCase(raw);
  }
  const area = getMetaAreaRaw(svc);
  if (area && !isNumericOnlyLabel(area) && !isDirectionLikeLabel(area)) {
    return titleCase(area);
  }
  return null;
}

/**
 * Neighbourhood-level area from metadata.area / area_name.
 * Skips numeric-only values (size/rate codes like "1000", "400") — those are not places.
 * Does NOT include direction_remarks (street-level; used in direction step).
 */
function getMetaAreaRaw(svc: DbService): string | null {
  const meta = svc.metadata as {
    area?: string;
    area_name?: string;
    direction_remarks?: string;
  } | undefined;
  const raw = metaFieldClean(meta?.area) || metaFieldClean(meta?.area_name);
  if (!raw || isNumericOnlyLabel(raw)) return null;
  return raw;
}

/** True when the label is only digits / measurements — not a real place name. */
function isNumericOnlyLabel(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  // "1000", "400", "12x8", "20 x 10"
  if (/^\d+(\.\d+)?$/.test(t)) return true;
  if (/^\d+\s*[x×]\s*\d+$/i.test(t)) return true;
  if (/^\d+(\s*(ft|feet|m|meter|metres|sq|sqft|cm))?$/i.test(t)) return true;
  return false;
}

/**
 * Street/direction label for the final "which direction?" step.
 * Returns direction_remarks only when it is a real value.
 */
export function getDirectionLabel(svc: DbService): string | null {
  const meta = svc.metadata as { direction_remarks?: string } | undefined;
  return metaFieldClean(meta?.direction_remarks);
}

/** Long road / direction-style labels — not city or area chips. */
function isDirectionLikeLabel(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (/\b(towards|toward|opp\.?|opposite)\b/i.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 6) return true;
  if ((t.match(/,/g) || []).length >= 1 && words.length >= 4) return true;
  return false;
}

/**
 * City for funnel chips — metadata.city as stored (Pallavaram, Chennai, …).
 * Does not require KNOWN_CITY_LIST. Skips NA / direction-like junk.
 */
export function getDbCityLabel(svc: DbService): string | null {
  const raw = getMetaCityRaw(svc);
  if (!raw || isNumericOnlyLabel(raw) || isDirectionLikeLabel(raw)) return null;
  // Prefer known metro spelling when applicable
  const known = matchKnownCityLabel(raw);
  if (known) return known;
  return titleCase(raw);
}

/**
 * When vendor rows put a locality in metadata.city (Padur, Vadapalani…)
 * instead of a metro, return that locality.
 * @deprecated Prefer getDbCityLabel for city chips; kept for locality browse.
 */
function getLocalityFromMetaCity(svc: DbService): string | null {
  const raw = getMetaCityRaw(svc);
  if (!raw) return null;
  if (matchKnownCityLabel(raw)) return null;
  if (isDirectionLikeLabel(raw)) return null;
  return titleCase(raw);
}

/** Real city only (Chennai/Madurai…) — never area names like Anna Nagar / Padur. */
export function extractRealCityFromDbService(svc: DbService): string | null {
  const metaCity = getMetaCityRaw(svc);
  if (metaCity) {
    const known = matchKnownCityLabel(metaCity);
    if (known) return known;
  }

  const locs: string[] = svc.metadata?.locations || [];
  for (const loc of locs) {
    const known = matchKnownCityLabel(loc);
    if (known) return known;
  }

  const sid = (svc.service_id || '').toLowerCase();
  for (const city of REAL_CITY_KEYS) {
    if (sid.endsWith(`-${city}`) || sid.includes(`-${city}-`)) {
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }

  const docName = (svc.document_name || '').toLowerCase();
  for (const key of REAL_CITY_KEYS) {
    if (docName.includes(key)) return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // Fall back to shared extractor, then drop if not a known city key
  const loose = extractCityFromDbService(svc);
  if (loose && REAL_CITY_KEYS.includes(loose.toLowerCase())) return loose;
  return null;
}

/** Distinct cities for funnel — raw DB city (else area_name), no metro invent. */
export function getCatalogCities(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const s of services) {
    const c = funnelCityFromDb(s);
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function titleCaseCityKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function parseQtyFromText(text: string): number | null {
  if (!hasExplicitQty(text)) return null;
  // Prefer leading qty: "50 bus" not "3 months" alone
  const leading = text.match(/^\s*(\d+)\b/);
  if (leading) {
    const n = parseInt(leading[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // "bus 50" style (number not part of a duration)
  const mid = text.match(/\b(\d+)\b(?!\s*(?:days?|months?|weeks?)\b)/i);
  if (mid) {
    const n = parseInt(mid[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** True only when user typed a count (not only "3 months"). */
export function hasExplicitQty(text: string): boolean {
  const withoutDuration = text.replace(/\b\d+\s*(days?|months?|weeks?)\b/gi, ' ');
  return /\b\d+\b/.test(withoutDuration);
}

function isSmallTalk(text: string): ProgressiveTurnResult | null {
  const t = text.trim();
  if (!t) return null;

  const session: ProgressiveSession = { originalText: t, qty: null };

  if (/^(hi|hello|hey|hii|hai|howdy|yo|hola)[\s!.]*$/i.test(t)
    || /^(good\s+(morning|afternoon|evening))[\s!.]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: copyGreeting(),
      options: [],
      session,
    };
  }

  if (/^(thanks|thank\s*you|thx|ty)[\s!.]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: "You're welcome!\n\nWhat advertising service can I help with next?",
      options: [],
      session,
    };
  }

  if (/^(help|how\s+(does\s+this\s+work|to\s+use)|what\s+can\s+you\s+do)[\s?.!]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: "Sure!\n\nTell me the advertising service or city you're looking for.",
      options: [],
      session,
    };
  }

  // Incomplete: "i need a", "i want", "looking for"
  if (/^(i\s+)?(need|want|looking\s+for)\s*(a|an|some)?\s*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: 'What advertising service are you looking for?',
      options: [],
      session,
    };
  }

  return null;
}

export function parseDurationFromText(text: string): string | null {
  const m = text.match(/\b(\d+)\s*(days?|months?|weeks?)\b/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

export function detectCityInText(text: string, _services?: DbService[]): string | null {
  const lower = text.toLowerCase();
  // Known metros only — do NOT use getCatalogCities (Padur/Vadapalani/Hosur are areas)
  const keys = [...REAL_CITY_KEYS].sort((a, b) => b.length - a.length);
  for (const city of keys) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      return titleCaseCityKey(city);
    }
  }
  // Madurai common typos only (e.g. "maddurai") — product-approved; not generic fuzzy
  const typoKeys = Object.keys(CITY_TYPO_ALIASES).sort((a, b) => b.length - a.length);
  for (const typo of typoKeys) {
    if (new RegExp(`\\b${typo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      const canonical = CITY_TYPO_ALIASES[typo]!;
      return titleCaseCityKey(canonical);
    }
  }
  return null;
}

/** Cache localities per services array identity (avoids rebuild on every detect). */
let _localityCacheRef: DbService[] | null = null;
let _localityCache: string[] = [];

/** Distinct localities / areas from DB (Padur, Saidapet, … — not metro cities or service types). */
export function getCatalogLocalities(services: DbService[]): string[] {
  if (services === _localityCacheRef) return _localityCache;

  const mediumKeys = new Set<string>();
  for (const m of getCatalogTypeKeys(services)) {
    const key = canonicalizeServiceName(m);
    if (!key) continue;
    mediumKeys.add(key);
    const first = key.split(/\s+/)[0];
    if (first) mediumKeys.add(first);
  }

  const set = new Set<string>();
  const addIfPlace = (raw: string | null | undefined) => {
    if (!raw || isNumericOnlyLabel(raw) || matchKnownCityLabel(raw)) return;
    const key = canonicalizeServiceName(raw);
    if (!key) return;
    const first = key.split(/\s+/)[0] || '';
    // Cheap medium-token check only (no O(n) family filter per label)
    if (mediumKeys.has(key) || (first.length >= 3 && mediumKeys.has(first))) return;
    set.add(titleCase(raw));
  };

  for (const s of services) {
    addIfPlace(getMetaCityRaw(s));
    addIfPlace(getMetaAreaRaw(s));
    addIfPlace(getLocalityFromMetaCity(s));
    // NEVER index direction_remarks — "TOWARDS VADAPALANI" must not create a Vadapalani place.
  }

  _localityCacheRef = services;
  _localityCache = [...set].sort((a, b) => a.localeCompare(b));
  return _localityCache;
}

/** Detect a DB locality/area name in free text (e.g. "saidapet", "muttukadu"). */
export function detectLocalityInText(text: string, services: DbService[]): string | null {
  const words = extractQueryWords(text).filter((w) => !STOP_WORDS.has(w));
  // Fast path: if this is clearly a medium/type word, never treat as locality
  if (words.length === 1) {
    const w = words[0];
    if (filterByMediumFamily(services, w).length > 0) return null;
    const mediumKeys = getCatalogTypeKeys(services).map((m) => canonicalizeServiceName(m));
    if (mediumKeys.some((m) => m === w || m.startsWith(`${w} `) || m.split(/\s+/)[0] === w)) {
      return null;
    }
  }

  const lower = text.toLowerCase();
  const keys = getCatalogLocalities(services)
    .map((l) => l.toLowerCase())
    .filter((l) => l.length >= 3 && !isNumericOnlyLabel(l))
    .sort((a, b) => b.length - a.length);
  for (const loc of keys) {
    if (new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      return titleCase(loc);
    }
  }
  // Fallback: single query word appears inside area / locality only (never direction_remarks).
  // Prefer the FULL place label (Gandhi Nagar), never return the partial word alone.
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 4) return null;
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const exact = new Set<string>();
    const partial = new Set<string>();
    for (const s of services) {
      const area = getMetaAreaRaw(s) || getLocalityFromMetaCity(s);
      if (area && re.test(area)) {
        if (canonicalizeServiceName(area) === w) exact.add(titleCase(area));
        else partial.add(titleCase(area));
      }
    }
    if (exact.size === 1) return [...exact][0];
    if (exact.size === 0 && partial.size === 1) return [...partial][0];
    return null;
  }
  return null;
}

function filterByLocality(services: DbService[], locality: string): DbService[] {
  const a = canonicalizeServiceName(locality);
  if (!a) return [];
  const aRe = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return services.filter((s) => {
    const label = canonicalizeServiceName(getAreaLabel(s) || '');
    const loc = canonicalizeServiceName(getLocalityFromMetaCity(s) || '');
    const meta = canonicalizeServiceName(getMetaCityRaw(s) || '');
    const area = canonicalizeServiceName(getMetaAreaRaw(s) || '');
    // Place match = area / locality / city only — NEVER direction_remarks
    // ("…TOWARDS VADAPALANI" ≠ service in Vadapalani)
    return label === a || loc === a || meta === a || area === a
      || aRe.test(label) || aRe.test(loc) || aRe.test(meta) || aRe.test(area);
  });
}

/**
 * Road-corridor / direction fallback REMOVED — place match = city or area_name only.
 * Discard type/area ask copy when the pool is empty (would show text with no chips).
 */
function isAskStepReplyWithoutOptions(reply?: string | null): boolean {
  if (!reply) return false;
  return (
    /which type should I quote/i.test(reply)
    || /has more than one option/i.test(reply)
    || /which of these types fits/i.test(reply)
    || /happy to quote/i.test(reply)
    || /fits your brief/i.test(reply)
    || /which (?:area|city|service)/i.test(reply)
    || /pick the site/i.test(reply)
    || /which site\(s\) fit/i.test(reply)
    || /which option would you like/i.test(reply)
    || /looking at .+\. happy to quote/i.test(reply)
  );
}

/** Locality-only (or metro-only) → funnel asks City (if many) → Service → Type → … */
function startPlaceTypeBrowse(
  place: string,
  isMetroCity: boolean,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const hits = isMetroCity
    ? filterByCity(services, place)
    : filterByLocality(services, place);
  if (!hits.length) {
    const errKey = `place:${canonicalizeServiceName(place)}`;
    return {
      step: 'no_match',
      botText: copyUnknownCity(place, session),
      options: [],
      session: stampReplyMeta(
        {
          ...session,
          city: isMetroCity ? place : session.city,
          area: isMetroCity ? session.area : place,
        },
        '',
        errKey,
      ),
    };
  }
  // Multi-city for this place → ask DB city values (OMR / Padur / Chennai as stored)
  if (!isMetroCity) {
    const cities = [
      ...new Set(
        hits
          .map((h) => funnelCityFromDb(h))
          .filter(Boolean) as string[],
      ),
    ];
    if (cities.length > 1) {
      const cityOpts = cities.sort().map((c) => ({
        id: `city:${c.toLowerCase()}`,
        label: c,
        city: c,
      }));
      const { text, opener } = composeReply(session, {
        avail: `We currently provide services near ${place} across more than one location.`,
        ask: 'Which city or location should I prepare?',
      });
      return {
        step: 'pick_city',
        botText: reply || text,
        options: cityOpts,
        allowMulti: true,
        session: stampReplyMeta(
          {
            ...session,
            area: place,
            placeHint: place,
            needsContinueConfirm: false,
            candidateServiceIds: hits.map((h) => h.service_id),
          },
          opener,
        ),
      };
    }
    if (cities.length === 1) {
      return advanceFunnel(
        {
          ...session,
          area: place,
          placeHint: place,
          city: cities[0],
          needsContinueConfirm: true,
          candidateServiceIds: hits.map((h) => h.service_id),
        },
        services,
        reply,
      );
    }
  }

  const mediumOpts = uniqueMediumOnlyOptions(hits);
  const placeReply =
    reply
    || (mediumOpts.length === 1
      ? copySingleServiceAtPlace(
        mediumOpts[0].medium || mediumOpts[0].label,
        place,
        session,
      )
      : copyPlaceServices(place, session));

  return advanceFunnel(
    {
      ...session,
      // Metro typed as city; place names stay as area/placeHint — city chips use DB values later
      city: isMetroCity ? place : session.city,
      area: isMetroCity ? session.area : place,
      placeHint: isMetroCity ? session.placeHint : place,
      medium:
        mediumOpts.length === 1
          ? canonicalizeServiceName(mediumOpts[0].medium || '')
          : session.medium,
      browseToken:
        mediumOpts.length === 1
          ? canonicalizeServiceName(mediumOpts[0].medium || '')
          : session.browseToken,
      pendingMedia: [],
      candidateServiceIds: hits.map((s) => s.service_id),
      needsContinueConfirm: true,
      pendingCityQueue: undefined,
      workQueue: undefined,
      collectedRows: mediumOpts.length === 1 ? (session.collectedRows || []) : [],
      collectedServiceIds:
        mediumOpts.length === 1 ? (session.collectedServiceIds || []) : [],
    },
    services,
    placeReply,
  );
}

/**
 * Chip thumbnail URL from DB metadata — prefer reference image, else first images[].
 * Returns undefined when none (chip stays text-only).
 */
export function getChipImageUrl(svc: DbService): string | undefined {
  const meta = svc.metadata;
  if (!meta) return undefined;
  const images = meta.images;
  if (Array.isArray(images) && images.length > 0) {
    const ref = images.find((i) => {
      const t = (i.type || '').toLowerCase();
      return t === 'reference' || t === 'reference_image' || t.includes('ref');
    });
    const url = (ref?.url || images[0]?.url || '').trim();
    if (url) return url;
  }
  const single = meta.reference_image;
  if (typeof single === 'string' && single.trim()) return single.trim();
  return undefined;
}

/** First available reference image in a row group. */
function firstChipImage(rows: DbService[]): string | undefined {
  for (const s of rows) {
    const url = getChipImageUrl(s);
    if (url) return url;
  }
  return undefined;
}

function distinctFunnelCities(rows: DbService[]): number {
  const set = new Set<string>();
  for (const s of rows) {
    const c = funnelCityFromDb(s);
    if (c) set.add(canonicalizeServiceName(c));
  }
  return set.size;
}

function distinctFunnelAreas(rows: DbService[]): number {
  const set = new Set<string>();
  for (const s of rows) {
    const a = getMetaAreaRaw(s);
    if (a && !isNumericOnlyLabel(a)) set.add(canonicalizeServiceName(a));
  }
  return set.size;
}

function distinctFunnelDirections(rows: DbService[]): number {
  const set = new Set<string>();
  for (const s of rows) {
    const d = getDirectionLabel(s);
    if (d) set.add(canonicalizeServiceName(d));
  }
  return set.size;
}

function distinctFunnelMediumTypes(rows: DbService[]): number {
  const set = new Set<string>();
  for (const s of rows) {
    const t = getMediumTypeFromDb(s);
    if (t) set.add(canonicalizeServiceName(t));
  }
  return set.size;
}

/**
 * Thumbnail only when this chip maps to a unique next step:
 * medium → 1 city AND ≤1 medium_type AND ≤1 direction
 * type → 1 city AND ≤1 direction (types already split)
 * city → 1 area · area → 1 direction · direction → 1 site.
 */
function chipImageIfUniqueNext(
  rows: DbService[],
  next: 'city' | 'area' | 'direction' | 'site',
): string | undefined {
  if (!rows.length) return undefined;
  if (next === 'site') {
    const ids = new Set(rows.map((s) => s.service_id).filter(Boolean));
    return ids.size === 1 ? firstChipImage(rows) : undefined;
  }
  if (next === 'city') {
    // Medium chips: hide when 2+ cities, 2+ medium_types, or 2+ directions
    if (distinctFunnelCities(rows) !== 1) return undefined;
    if (distinctFunnelMediumTypes(rows) > 1) return undefined;
    if (distinctFunnelDirections(rows) > 1) return undefined;
    return firstChipImage(rows);
  }
  const count =
    next === 'area'
      ? distinctFunnelAreas(rows)
      : distinctFunnelDirections(rows);
  return count === 1 ? firstChipImage(rows) : undefined;
}

export function getMediumKey(svc: DbService): string {
  const meta = svc.metadata as { medium?: string; medium_type?: string } | undefined;
  const medium = String(meta?.medium || '').trim();
  if (medium && medium.toUpperCase() !== 'NA') {
    return canonicalizeServiceName(medium.split(/[·|]/)[0] || medium);
  }
  const name = (svc.service_name || '').split(/[·—–]/)[0] || '';
  const first = canonicalizeServiceName(name).split(/\s+/)[0] || '';
  if (first) return first;
  const sid = (svc.service_id || '').toLowerCase();
  return sid.split('-')[0] || 'service';
}

/**
 * DB medium_type for funnel Type step — metadata.medium_type only.
 * Skip blank / NA / direction-like junk; never invent from service_id or whitelist.
 */
export function getMediumTypeFromDb(svc: DbService): string | null {
  const meta = svc.metadata as {
    medium_type?: string;
    mediumType?: string;
    type_of_medium?: string;
  } | undefined;
  const raw = String(
    meta?.medium_type || meta?.mediumType || meta?.type_of_medium || '',
  ).trim();
  if (!raw || raw.toUpperCase() === 'NA') return null;
  const cleaned = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Direction text wrongly stored as medium_type — not a Type chip
  if (isDirectionLikeLabel(cleaned) || cleaned.split(/\s+/).length > 6) return null;
  return titleCase(cleaned);
}

/** Parse `medium:Foo` or `medium:Foo|elevated` chip ids. */
function parseMediumChipToken(token: string): { medium: string; mediumType?: string } {
  const raw = token.trim();
  const pipe = raw.indexOf('|');
  if (pipe >= 0) {
    const medium = raw.slice(0, pipe).trim();
    const mediumType = raw.slice(pipe + 1).trim();
    return { medium, mediumType: mediumType || undefined };
  }
  return { medium: raw };
}

function serviceMatchesMediumChip(
  svc: DbService,
  chip: { medium: string; mediumType?: string },
): boolean {
  const mk = canonicalizeServiceName(getMediumKey(svc));
  const want = canonicalizeServiceName(chip.medium);
  if (!want) return false;
  const mediumOk =
    mk === want
    || isSameMediumFamily(mk, want)
    || canonicalizeServiceName(formatServiceDisplayName(svc)).includes(want);
  if (!mediumOk) return false;
  if (!chip.mediumType) return true;
  const got = getMediumTypeFromDb(svc);
  if (!got) return false;
  return canonicalizeServiceName(got) === canonicalizeServiceName(chip.mediumType);
}

export function getAreaLabel(svc: DbService): string | null {
  // Prefer explicit area fields (including metadata.area from vendor_rate_chunks)
  const fromMeta = getMetaAreaRaw(svc);
  if (fromMeta) return fromMeta;

  // Locality wrongly stored in metadata.city (Padur, Vadapalani, …)
  const locality = getLocalityFromMetaCity(svc);
  if (locality) return locality;

  // Parse trailing location from service_id: medium-city-area_slug
  // e.g. appartment_demo-padur-happiness_to → Padur
  const sid = (svc.service_id || '').toLowerCase().replace(/_/g, '-');
  if (!sid) return null;
  const city = (extractRealCityFromDbService(svc) || '').toLowerCase();
  const medium = getMediumKey(svc).replace(/\s+/g, '-');
  let rest = sid;
  if (city && rest.includes(`-${city}-`)) {
    rest = rest.slice(rest.indexOf(`-${city}-`) + city.length + 2);
  } else if (city && rest.endsWith(`-${city}`)) {
    return null;
  } else if (medium && rest.startsWith(`${medium}-`)) {
    rest = rest.slice(medium.length + 1);
    if (city && rest.startsWith(`${city}-`)) rest = rest.slice(city.length + 1);
    else if (city && rest === city) return null;
  } else {
    const parts = sid.split('-').filter(Boolean);
    // Drop leading medium-ish tokens until we hit a locality candidate
    if (parts.length >= 2) {
      const candidate = parts.find(
        (p, idx) => idx >= 1 && p.length >= 3 && !REAL_CITY_KEYS.includes(p) && !CLOUD_CITY_KEYS.includes(p),
      );
      if (candidate) return titleCase(candidate.replace(/_/g, ' '));
    }
  }
  rest = rest.replace(/^-+|-+$/g, '');
  if (!rest || rest.length < 3) return null;
  const firstSeg = rest.split('-')[0] || rest;
  if (CLOUD_CITY_KEYS.includes(firstSeg) || REAL_CITY_KEYS.includes(firstSeg) || (city && firstSeg === city)) {
    return null;
  }
  return titleCase(firstSeg.replace(/_/g, ' '));
}

/**
 * Display place for chips: localities as-is; metro+area as "Chennai · Area".
 */
function resolveDisplayPlace(
  svc: DbService,
  token: string,
): ProgressiveOption | null {
  const realCity = extractRealCityFromDbService(svc);
  const locality = getLocalityFromMetaCity(svc);
  const areaFromMeta = getMetaAreaRaw(svc);
  const area = areaFromMeta || (!locality ? getAreaLabel(svc) : null);

  // Locality stored as city → chip "Padur"
  if (locality) {
    const key = canonicalizeServiceName(locality);
    return {
      id: `place:locality|${key}`,
      label: locality,
      city: realCity || undefined,
      medium: token,
      imageUrl: getChipImageUrl(svc),
    };
  }

  if (realCity && area) {
    const areaKey = canonicalizeServiceName(area);
    return {
      id: `place:${realCity.toLowerCase()}|${areaKey}`,
      label: `${realCity} · ${area}`,
      city: realCity,
      medium: token,
      imageUrl: getChipImageUrl(svc),
    };
  }

  // Numeric-only or missing area → city chip only (direction asked later)
  if (realCity) {
    return {
      id: `city:${realCity.toLowerCase()}`,
      label: realCity,
      city: realCity,
      medium: token,
      // No thumb on city chips — keeps chat light
    };
  }

  // Last resort: any area-like label (skip numeric codes)
  const fallbackArea = getAreaLabel(svc);
  if (fallbackArea && !isNumericOnlyLabel(fallbackArea)) {
    const key = canonicalizeServiceName(fallbackArea);
    return {
      id: `place:locality|${key}`,
      label: fallbackArea,
      medium: token,
      imageUrl: getChipImageUrl(svc),
    };
  }

  return null;
}

export function friendlyServiceLabel(svc: DbService): string {
  const area = getAreaLabel(svc);
  const base = (svc.service_name || svc.service_id || 'Service').split('·')[0].trim();
  if (area && !canonicalizeServiceName(base).includes(canonicalizeServiceName(area))) {
    // Prefer short medium + area when name is huge
    const medium = titleCase(getMediumKey(svc));
    return `${medium} · ${area}`;
  }
  return base.length > 80 ? base.slice(0, 77) + '…' : base;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function similarity(a: string, b: string): number {
  const ca = canonicalizeServiceName(a);
  const cb = canonicalizeServiceName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  if (ca.includes(cb) || cb.includes(ca)) return 0.92;
  const dist = levenshtein(ca, cb);
  const maxLen = Math.max(ca.length, cb.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen;
}

/** English / filler words — never fuzzy-correct into a catalog medium. */
const SKIP_MEDIA_FUZZY = new Set([
  ...STOP_WORDS,
  'both', 'with', 'this', 'that', 'then', 'when', 'from', 'have', 'been', 'will',
  'near', 'only', 'just', 'also', 'more', 'less', 'next', 'last', 'good', 'best',
  'full', 'semi', 'site', 'area', 'city', 'place', 'road', 'street', 'gate',
  'inside', 'outside', 'court', 'stand', 'stop', 'home', 'unit', 'units',
]);

/** Catalog tokens safe for silent typo fix (full keys + first words, len ≥ 3). */
function getCatalogMediaCorrectTokens(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const m of getCatalogTypeKeys(services)) {
    const key = canonicalizeServiceName(m);
    if (!key || key.length < 3) continue;
    set.add(key);
    const first = key.split(/\s+/).filter(Boolean)[0];
    if (first && first.length >= 3) set.add(first);
  }
  return [...set];
}

/**
 * Silent typo fix against catalog media tokens only (not cities / places / directions).
 * Returns corrected token or null if already exact / ambiguous / unsafe.
 */
function correctMediaTokenSilent(token: string, catalogTokens: string[]): string | null {
  const t = canonicalizeServiceName(token);
  if (!t || t.length < 4) return null;
  if (SKIP_MEDIA_FUZZY.has(t)) return null;
  if (catalogTokens.includes(t)) return null; // already good — no rewrite needed

  const maxD = t.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDist = Infinity;
  let ties = 0;
  for (const c of catalogTokens) {
    if (c.length < 3) continue;
    if (Math.abs(c.length - t.length) > maxD) continue;
    if (SKIP_MEDIA_FUZZY.has(c)) continue;
    const d = levenshtein(t, c);
    if (d === 0) return null;
    if (d > maxD) continue;
    if (d < bestDist) {
      bestDist = d;
      best = c;
      ties = 1;
    } else if (d === bestDist) {
      ties += 1;
    }
  }
  if (ties !== 1 || !best) return null;
  return best;
}

/**
 * Rewrite user text: fix media-word typos / plurals against catalog (silent).
 * Never touches city / locality / direction tokens (those aren't in catalogTokens).
 */
function softCorrectMediaWordsInText(text: string, services: DbService[]): string {
  if (!text.trim() || !services.length) return text;
  // Skip on long multi-service lists — levenshtein × every word freezes the tab
  const andCount = (text.match(/\band\b/gi) || []).length;
  if (andCount >= 3 || text.length > 180) return text;
  const catalogTokens = getCatalogMediaCorrectTokens(services);
  if (!catalogTokens.length) return text;

  return text.replace(/[A-Za-z][A-Za-z']+/g, (raw) => {
    if (raw.length < 4) return raw;
    const lower = raw.toLowerCase();
    if (SKIP_MEDIA_FUZZY.has(canonicalizeServiceName(lower))) return raw;
    // Already matches catalog (with plural/synonym normalize)
    const canon = canonicalizeServiceName(lower);
    if (catalogTokens.includes(canon)) {
      // If canonicalize changed spelling (hording→hoarding), rewrite to catalog form
      if (canon !== lower && canon.indexOf(' ') < 0) {
        return raw[0] === raw[0].toUpperCase()
          ? canon.charAt(0).toUpperCase() + canon.slice(1)
          : canon;
      }
      return raw;
    }
    const fixed = correctMediaTokenSilent(lower, catalogTokens);
    if (!fixed || fixed === canon) return raw;
    // Keep simple lower/Title casing
    if (raw === raw.toUpperCase() && raw.length > 1) return fixed.toUpperCase();
    if (raw[0] === raw[0].toUpperCase()) {
      return fixed.charAt(0).toUpperCase() + fixed.slice(1);
    }
    return fixed;
  });
}

/** True when service belongs to the given city label (DB city or area_name). */
function serviceMatchesCityLabel(svc: DbService, city: string): boolean {
  const c = city.toLowerCase().trim();
  if (!c) return false;
  const cKey = canonicalizeServiceName(c);
  const cRe = new RegExp(
    `\\b${cKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    'i',
  );
  const candidates = [
    getMetaCityRaw(svc),
    getDbCityLabel(svc),
    funnelCityFromDb(svc),
    getMetaAreaRaw(svc),
    getAreaLabel(svc),
    getLocalityFromMetaCity(svc),
    ...((svc.metadata?.locations || []) as string[]),
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase().trim());
  return candidates.some((l) => {
    if (l === c || canonicalizeServiceName(l) === cKey) return true;
    return cRe.test(l);
  });
}

function filterByCity(services: DbService[], city: string | null): DbService[] {
  if (!city) return services;
  return services.filter((s) => serviceMatchesCityLabel(s, city));
}

function matchServices(services: DbService[], words: string[], city: string | null): DbService[] {
  const scoped = filterByCity(services, city);
  if (words.length === 0) return [];
  const matched = scoped.filter((s) => serviceMatchesQuery(s, words));
  return matched;
}

/**
 * Browse match for user tokens like "bus" / "shelter" / "apartment".
 * Matches word boundary in medium + product name (includes Bus Shelter when asking "bus").
 * Also tolerates spelling variants (apartment ↔ appartment).
 */
function browseTokenVariants(token: string, services?: DbService[]): string[] {
  const t = canonicalizeServiceName(token);
  if (!t) return [];
  const out = new Set<string>([t]);
  if (t === 'apartment') out.add('appartment');
  if (t === 'appartment') out.add('apartment');
  // Silent typo → catalog token (hoardin → hoarding, buss already synonym)
  if (services?.length) {
    const fixed = correctMediaTokenSilent(t, getCatalogMediaCorrectTokens(services));
    if (fixed) out.add(fixed);
  }
  // Plural form of each variant for regex without relying only on s?
  for (const v of [...out]) {
    if (!v.endsWith('s')) out.add(`${v}s`);
  }
  return [...out];
}

/** True when word is a catalog medium / first token (metro, bus, hoarding…). */
function isCatalogMediumToken(word: string, services: DbService[]): boolean {
  const w = canonicalizeServiceName(word);
  if (!w || w.length < 2) return false;
  return getCatalogTypeKeys(services).some((m) => {
    const key = canonicalizeServiceName(m);
    return key === w || key.startsWith(`${w} `) || key.split(/\s+/)[0] === w;
  });
}

function filterByBrowseToken(services: DbService[], token: string): DbService[] {
  const variants = browseTokenVariants(token, services);
  if (!variants.length) return [];
  const res = variants.map(
    (v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i'),
  );
  // Short family tokens (metro, bus) — ONLY match medium / id / short name head.
  // Never scan long service_name lines that embed "Metro Station" in a bus-shelter title.
  const tok = canonicalizeServiceName(token);
  const shortFamily = tok.split(/\s+/).length === 1 && tok.length <= 8;
  return services.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    if (res.some((re) => re.test(med))) return true;
    const sid = canonicalizeServiceName(s.service_id || '');
    if (res.some((re) => re.test(sid))) return true;
    const nameRaw = (s.service_name || '').split(/[·—–|]/)[0] || '';
    const name = canonicalizeServiceName(nameRaw);
    if (shortFamily) {
      // First 3 tokens only ("metro station elevated", not full direction-in-name)
      const head = name.split(/\s+/).slice(0, 3).join(' ');
      return res.some((re) => re.test(head));
    }
    return res.some((re) => re.test(name));
  });
}

/** Prefer browse hits; fall back to strict family for exact medium chips. */
function filterForBrowseOrFamily(services: DbService[], token: string): DbService[] {
  const browse = filterByBrowseToken(services, token);
  const family = filterByMediumFamily(services, token);
  let hits = browse.length ? browse : family;
  const t = canonicalizeServiceName(token);
  // "metro" also covers Train Inside / Train Wrap (may not contain the word metro)
  if (t === 'metro' || t.startsWith('metro ')) {
    hits = mergeMetroFamilyServices(services, hits);
  }
  return hits;
}

/** Train Inside / Train Wrap + Metro Station variants under the metro family. */
function isMetroFamilyHay(hay: string): boolean {
  const h = canonicalizeServiceName(hay);
  if (/\bmetro\b/.test(h)) return true;
  if (/\btrain\s+inside\b/.test(h) || /\btrain\s+wrap\b/.test(h)) return true;
  if (/\btrain\b/.test(h) && /\b(inside|wrap)\b/.test(h)) return true;
  return false;
}

function mergeMetroFamilyServices(services: DbService[], base: DbService[]): DbService[] {
  const map = new Map(base.map((s) => [s.service_id, s]));
  for (const s of services) {
    if (map.has(s.service_id)) continue;
    const hay = `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|/]/)[0] || ''} ${s.service_id || ''}`;
    if (isMetroFamilyHay(hay)) map.set(s.service_id, s);
  }
  return [...map.values()];
}

function isMetroSegmentToken(token: string): boolean {
  const t = canonicalizeServiceName(token);
  return t === 'metro' || t.startsWith('metro ') || t === 'train' || t.startsWith('train ');
}

/** Soft ceiling — kept high enough for real multi-service quotes; chip caps prevent freezes. */
const MAX_BATCH_SEGMENTS = 20;

function normalizeSegmentPhrase(text: string): string {
  return text
    .replace(/mobile\s*vans?/gi, 'mobile van')
    .replace(/mobilevan/gi, 'mobile van')
    .replace(/awarness/gi, 'awareness')
    .replace(/elevetaed/gi, 'elevated')
    .replace(/app?art+ment/gi, 'apartment')
    // Glue fixes: "2and" / "100and" / "poster2 and" → proper spaces for qty+and splits
    .replace(/(\d)\s*(and|&|\+)\s*/gi, '$1 $2 ')
    .replace(/(\d)(and|&|\+)/gi, '$1 $2 ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match DB rows for a multi-word segment token (e.g. "bus semi", "apartment lift"). */
function matchSegmentHits(
  services: DbService[],
  token: string,
  city: string | null,
): DbService[] {
  const words = canonicalizeServiceName(normalizeSegmentPhrase(token))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (!words.length) return [];

  // Narrow pool first (avoid O(all services × regex) on mega multi-service messages)
  let pool = services;
  const family = words[0];
  if (family.length >= 3) {
    const familyHits = filterForBrowseOrFamily(services, family);
    if (familyHits.length > 0 && familyHits.length < services.length) {
      pool = familyHits;
    }
  }

  const variantsByWord = words.map((w) => browseTokenVariants(w, services));
  let hits = pool.filter((s) => {
    const hay = canonicalizeServiceName(
      `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|]/)[0] || ''} ${s.service_id || ''}`,
    );
    return variantsByWord.every((variants) =>
      variants.some((v) => hay.includes(v)),
    );
  });

  if (!hits.length) {
    hits = filterByBrowseToken(services, words.join(' '));
  }
  if (!hits.length && words.length > 1) {
    hits = filterByBrowseToken(services, words[0]);
  }

  // Strict city lock: empty = not offered in this city (do not fall back to all cities)
  if (city) {
    const c = city.toLowerCase();
    hits = hits.filter((s) => {
      const real = (extractRealCityFromDbService(s) || '').toLowerCase();
      const loc = (getLocalityFromMetaCity(s) || '').toLowerCase();
      const meta = (getMetaCityRaw(s) || '').toLowerCase();
      return real === c || loc === c || meta === c || serviceMatchesCityLabel(s, city);
    });
  }

  // "metro" segment → include Train Inside / Train Wrap even without the word "metro"
  if (isMetroSegmentToken(words.join(' ')) || isMetroSegmentToken(token)) {
    hits = mergeMetroFamilyServices(services, hits);
    if (city) {
      const c = city.toLowerCase();
      hits = hits.filter((s) => {
        const real = (extractRealCityFromDbService(s) || '').toLowerCase();
        const loc = (getLocalityFromMetaCity(s) || '').toLowerCase();
        return real === c || loc === c || serviceMatchesCityLabel(s, city);
      });
    }
  }
  return hits;
}

/** Drop "need a quote for / i want / please" filler so segments become "bus", not "need a quote for bus". */
function stripQuoteFiller(text: string): string {
  return text
    .replace(
      /\b((i\s+)?(need|want|looking\s+for|give\s+me|get\s+me|please)\s+)?(a\s+)?(quote|quotation|price|rates?)\s+(for|of)\b/gi,
      ' ',
    )
    .replace(/\b(i\s+)?(need|want|looking\s+for)\b/gi, ' ')
    .replace(/\b(please|kindly)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compact segment token to catalog media (bus / auto) — never keep filler phrases. */
function refineSegmentToken(raw: string, services: DbService[]): string {
  const cleaned = stripQuoteFiller(raw);
  const media = detectMediaLocal(cleaned, services);
  if (media.length >= 1) return media[0];
  const words = canonicalizeServiceName(cleaned)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (words.length) {
    const joined = words.join(' ');
    const again = detectMediaLocal(joined, services);
    if (again.length >= 1) return again[0];
    return joined;
  }
  return canonicalizeServiceName(cleaned);
}

/**
 * Split "50 bus semi and 10 bus shelter and auto 100" into qty+token segments.
 * Returns [] when the message is not a multi-service list.
 * Shared city ("… in chennai") is applied to every segment.
 * Unknown short tokens (e.g. trailing "gandhi") are omitted from segments
 * and returned via extractBatchPlaceHint().
 */
export function parseServiceSegments(text: string, services: DbService[]): BatchSegment[] {
  const normalized = stripQuoteFiller(normalizeSegmentPhrase(text));
  const sharedCity = detectCityInText(normalized, services);
  const parts = normalized
    .split(/\s*(?:\band\b|,|&|\+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  if (parts.length < 2) return [];

  const segments: BatchSegment[] = [];
  for (const part of parts) {
    const partCity = detectCityInText(part, services) || sharedCity;
    const qty = parseQtyFromText(part);
    const stripped = stripQtyCityDuration(stripQuoteFiller(part), partCity);
    const token = refineSegmentToken(stripped, services);
    if (!token || token.length < 2) continue;
    // Skip pure city / filler leftovers
    if (sharedCity && canonicalizeServiceName(token) === canonicalizeServiceName(sharedCity)) {
      continue;
    }

    const hits = matchSegmentHits(services, token, partCity);
    if (hits.length > 0) {
      segments.push({ raw: part, token, qty, city: partCity });
      continue;
    }
    const media = detectMediaLocal(stripped, services);
    if (media.length) {
      segments.push({ raw: part, token: media[0], qty, city: partCity });
      continue;
    }
    const tokenKey = canonicalizeServiceName(token);
    // Keep known family tokens even with zero inventory (so batch can say "not providing")
    if (FAMILY_NEEDS_ADS_WORD.has(tokenKey) || tokenKey.length >= 4) {
      segments.push({ raw: part, token, qty, city: partCity });
      continue;
    }
    // Unmatched short place-like token (gandhi) — skip as service segment
    if (isShortAmbiguousQuery(stripped) && !qty) continue;
    // Keep phrase so batch UI can still try fuzzy browse
    segments.push({ raw: part, token, qty, city: partCity });
  }

  // Ensure shared city is on every segment
  const withCity = sharedCity
    ? segments.map((s) => ({ ...s, city: s.city || sharedCity }))
    : segments;
  return withCity.length >= 2 ? withCity : [];
}

/** Trailing / unmatched short place hint from a multi-service message (e.g. "… and gandhi"). */
export function extractBatchPlaceHint(text: string, services: DbService[]): string | null {
  const normalized = stripQuoteFiller(normalizeSegmentPhrase(text));
  const parts = normalized
    .split(/\s*(?:\band\b|,|&|\+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  for (const part of parts) {
    const city = detectCityInText(part, services);
    const qty = parseQtyFromText(part);
    const stripped = stripQtyCityDuration(stripQuoteFiller(part), city);
    if (qty || !isShortAmbiguousQuery(stripped)) continue;
    if (matchSegmentHits(services, refineSegmentToken(stripped, services), city).length > 0) continue;
    if (detectMediaLocal(stripped, services).length > 0) continue;
    const place = suggestPartialPlace(stripped, services) || detectLocalityInText(stripped, services);
    if (place) return place;
    if (suggestPartialService(stripped, services)) continue;
  }
  return null;
}

/**
 * Group key for deduplication: medium family + city/locality.
 * All bus shelter sites in Anna Nagar share the same key → one chip.
 */
function batchGroupKey(svc: DbService): string {
  const medium = canonicalizeServiceName(getMediumKey(svc));
  const city = (getLocalityFromMetaCity(svc) || extractRealCityFromDbService(svc) || '').toLowerCase();
  return `${medium}|${city}`;
}

/**
 * Prefer longer / more-specific segments; drop family duplicates.
 * e.g. "metro station elevated" keeps, bare "metro" drops;
 * "bus semi" kept alongside "bus shelter" (shelter is not a style token).
 */
function dedupeBatchSegments(segments: BatchSegment[]): BatchSegment[] {
  if (segments.length <= 1) return segments;

  type Scored = { seg: BatchSegment; index: number; key: string };
  const scored: Scored[] = segments
    .map((seg, index) => ({
      seg: { ...seg },
      index,
      key: canonicalizeServiceName(seg.token),
    }))
    .filter((x) => x.key.length >= 2);

  const covers = (longer: string, shorter: string): boolean => {
    if (!longer || !shorter) return false;
    if (longer === shorter) return true;
    if (longer.startsWith(`${shorter} `)) return true;
    if (
      isMetroSegmentToken(shorter)
      && isMetroSegmentToken(longer)
      && longer.length >= shorter.length
    ) {
      return true;
    }
    // "bus semi" covers bare "bus"; "bus shelter" does not
    if (longer !== shorter && isSameMediumFamily(longer, shorter)) return true;
    return false;
  };

  const bySpecificity = [...scored].sort(
    (a, b) => b.key.length - a.key.length || a.index - b.index,
  );
  const kept: Scored[] = [];

  for (const item of bySpecificity) {
    const exact = kept.find((k) => k.key === item.key);
    if (exact) {
      if (
        (item.seg.qty ?? 0) > 0
        && !(exact.seg.qty != null && exact.seg.qty > 0)
      ) {
        exact.seg = { ...exact.seg, qty: item.seg.qty };
      }
      continue;
    }
    if (kept.some((k) => k.key !== item.key && covers(k.key, item.key))) {
      continue;
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].key !== item.key && covers(item.key, kept[i].key)) {
        if (
          (kept[i].seg.qty ?? 0) > 0
          && !(item.seg.qty != null && item.seg.qty > 0)
        ) {
          item.seg = { ...item.seg, qty: kept[i].seg.qty };
        }
        kept.splice(i, 1);
      }
    }
    kept.push(item);
  }

  kept.sort((a, b) => a.index - b.index);
  return kept.map((k) => k.seg);
}

/** Multi-service batch entry.
 *  - City already known → startBatchWithCityLock (sequential funnel in that city)
 *  - No shared city → sequential Type → City → Area → Direction per service (ask only if 2+)
 *  - Dedupes metro / family duplicates before starting
 */
function startBatchMultiSelect(
  segments: BatchSegment[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  if (segments.length > MAX_BATCH_SEGMENTS) {
    const preview = segments
      .slice(0, 6)
      .map((s) => titleCase(s.token))
      .join(', ');
    return {
      step: 'small_talk',
      botText:
        reply
        || `That's ${segments.length} services — please keep it to ${MAX_BATCH_SEGMENTS} or fewer.\n\nTry starting with: ${preview}…`,
      options: [],
      session: {
        ...session,
        segments: undefined,
        pendingMedia: [],
        qty: null,
      },
    };
  }

  const sharedCity =
    session.city
    || segments.map((s) => s.city).find((c): c is string => !!c)
    || detectCityInText(session.originalText || '', services)
    || null;

  const rawSegs = sharedCity
    ? segments.map((s) => ({ ...s, city: s.city || sharedCity }))
    : segments;
  const segs = dedupeBatchSegments(rawSegs);

  // City already named ("bus, auto in chennai") → never re-ask city list upfront
  if (sharedCity) {
    return startBatchWithCityLock(segs, sharedCity, session, services, reply);
  }

  return startBatchSequentialFunnel(segs, session, services, reply);
}

/**
 * Multi-service, no shared city: one service at a time through the full funnel
 * (Type → City → Area → Direction). Skip 0/1; ask only when 2+.
 * Services that exist in exactly one metro city are grouped ("only in Chennai") —
 * city is auto-locked; no OK Continue one-by-one.
 */
function startBatchSequentialFunnel(
  segments: BatchSegment[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const qtyByServiceId: Record<string, number> = { ...(session.qtyByServiceId || {}) };
  type WorkItem = {
    medium: string;
    browseToken?: string;
    qty: number | null;
    city?: string;
    candidateServiceIds?: string[];
  };
  const workItems: WorkItem[] = [];
  const missingLabels: string[] = [];
  const seenTok = new Set<string>();

  const soleRealCityForHits = (hits: DbService[]): string | null => {
    const cities = [
      ...new Set(
        hits
          .map((h) => extractRealCityFromDbService(h))
          .filter((c): c is string => !!c && REAL_CITY_KEYS.includes(c.toLowerCase())),
      ),
    ];
    return cities.length === 1 ? cities[0]! : null;
  };

  for (const seg of segments) {
    const token = refineSegmentToken(seg.token, services) || seg.token;
    const key = canonicalizeServiceName(token);
    if (!key || seenTok.has(key)) continue;
    if (
      [...seenTok].some(
        (k) =>
          k.startsWith(`${key} `)
          || (isMetroSegmentToken(key) && isMetroSegmentToken(k) && k.length > key.length)
          || (k !== key && isSameMediumFamily(k, key)),
      )
    ) {
      continue;
    }
    seenTok.add(key);

    let hits = matchSegmentHits(services, token, seg.city);
    if (!hits.length) {
      hits = filterForBrowseOrFamily(services, token);
    }
    if (!hits.length) {
      missingLabels.push(titleCase(token));
      continue;
    }
    if (seg.qty != null && seg.qty > 0) {
      for (const h of hits) qtyByServiceId[h.service_id] = seg.qty;
    }

    const soleCity = seg.city || soleRealCityForHits(hits) || undefined;

    workItems.push({
      medium: key,
      browseToken: key,
      qty: seg.qty ?? null,
      city: soleCity,
      candidateServiceIds: hits.map((h) => h.service_id),
    });
  }

  if (!workItems.length) {
    return {
      step: 'no_match',
      botText:
        reply
        || (missingLabels.length
          ? `Sorry, I couldn't find those services (${missingLabels.join(', ')}).\n\nPlease choose available advertising services.`
          : copyUnknownService()),
      options: [],
      session: { ...session, segments, pendingMedia: [], qty: null },
    };
  }

  const [first, ...rest] = workItems;
  const needCityNames = workItems
    .filter((w) => !w.city)
    .map((w) => titleCase(w.browseToken || w.medium));

  // Auto-add services with no choice; only queue items that need an ask
  const { needAsk, seedRows, seedIds, autoLabels } = partitionBatchWork(
    workItems,
    services,
    session,
    qtyByServiceId,
  );

  if (!needAsk.length) {
    if (seedRows.length) {
      return finalizeSelection([], {
        ...session,
        qtyByServiceId,
        segments,
        collectedRows: seedRows,
        collectedServiceIds: seedIds,
        workQueue: undefined,
        pendingMedia: [],
        needsContinueConfirm: false,
      }, services);
    }
  }

  const askFirst = needAsk[0] || first;
  const askRest = needAsk.length ? needAsk.slice(1) : rest;
  const firstLabel = titleCase(askFirst.browseToken || askFirst.medium);

  let intro = '';
  if (missingLabels.length) {
    intro += `I couldn’t match: ${missingLabels.join(', ')}. `;
  }
  if (needCityNames.length && needAsk.some((w) => !w.city)) {
    intro +=
      needCityNames.length === 1
        ? `${needCityNames[0]} needs a city — which should I prepare for? `
        : `These need a city choice (${needCityNames.slice(0, 3).join(', ')}${
          needCityNames.length > 3 ? '…' : ''
        }). Which should I prepare for? `;
  }
  if (autoLabels.length || needAsk.length) {
    intro += copyBatchAutoAddedThenAsk(
      autoLabels,
      firstLabel,
      askFirst.city,
    );
  } else if (askFirst.city) {
    intro += copyBatchStart(askFirst.city, workItems.length, firstLabel);
  } else {
    intro += (
      `I’ll go one by one through ${workItems.length} service${workItems.length === 1 ? '' : 's'} `
      + `and only ask when there’s a choice. Starting with ${firstLabel}.`
    );
  }
  if (!intro.trim()) {
    intro = `Starting with ${firstLabel}.`;
  }

  const exact = isExactCatalogMedium(askFirst.medium, services);
  const allLabels = workItems.map((w) => titleCase(w.browseToken || w.medium));
  const result = startMediumFlow(
    askFirst.medium,
    {
      ...session,
      city: askFirst.city,
      medium: exact ? askFirst.medium : undefined,
      browseToken: askFirst.browseToken || askFirst.medium,
      mediumType: undefined,
      qty: askFirst.qty,
      qtyByServiceId,
      segments,
      candidateServiceIds: askFirst.candidateServiceIds,
      workQueue: askRest,
      collectedRows: seedRows,
      collectedServiceIds: seedIds,
      pendingMedia: [],
      pendingCityQueue: undefined,
      needsContinueConfirm: false,
      typesResolved: undefined,
      area: undefined,
      placeHint: undefined,
      directionHint: undefined,
      batchGroupMap: undefined,
      batchServiceLabels: allLabels,
    },
    services,
    reply || intro.trim(),
  );
  return {
    ...result,
    autoConfirmedList: autoLabels.length ? autoLabels : allLabels,
    session: {
      ...result.session,
      batchServiceLabels: allLabels,
      collectedRows: seedRows.length ? seedRows : result.session.collectedRows,
      collectedServiceIds: seedIds.length ? seedIds : result.session.collectedServiceIds,
    },
  };
}

/**
 * Multi-service + city already known (e.g. "bus, auto in chennai"):
 * - Scope to that city only (no city chip list)
 * - Ask types for services that exist there
 * - Clearly say which requested services are NOT offered in that city
 */
function startBatchWithCityLock(
  segments: BatchSegment[],
  city: string,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  type Avail = {
    token: string;
    qty: number | null;
    hits: DbService[];
  };
  const available: Avail[] = [];
  const missingLabels: string[] = [];
  const qtyByServiceId: Record<string, number> = { ...(session.qtyByServiceId || {}) };

  // Dedupe by token (bus, bus → one) + metro family specifics
  const deduped = dedupeBatchSegments(segments);
  const seenTok = new Set<string>();
  for (const seg of deduped) {
    const token = refineSegmentToken(seg.token, services) || seg.token;
    const key = canonicalizeServiceName(token);
    if (!key || seenTok.has(key)) continue;
    seenTok.add(key);

    let hits = matchSegmentHits(services, token, city);
    if (!hits.length) {
      hits = filterForBrowseOrFamily(services, token).filter((s) =>
        serviceMatchesCityLabel(s, city),
      );
    }
    if (!hits.length) {
      missingLabels.push(titleCase(token));
      continue;
    }
    if (seg.qty != null && seg.qty > 0) {
      for (const h of hits) qtyByServiceId[h.service_id] = seg.qty;
    }
    available.push({ token, qty: seg.qty ?? null, hits });
  }

  const availLabels = available.map((a) => titleCase(a.token));

  if (!available.length) {
    const asked = [...seenTok].map((t) => titleCase(t));
    const list =
      asked.length <= 1
        ? asked[0] || 'those services'
        : asked.length === 2
          ? `${asked[0]} or ${asked[1]}`
          : `${asked.slice(0, -1).join(', ')}, or ${asked[asked.length - 1]}`;
    return {
      step: 'no_match',
      botText:
        reply
        || `We're currently not offering ${list} in ${city}.\n\nPlease choose another city or service.`,
      options: [],
      session: {
        ...session,
        city,
        segments,
        pendingMedia: [],
        needsContinueConfirm: false,
      },
    };
  }

  const workItems = available.map((a) => ({
    medium: canonicalizeServiceName(a.token),
    browseToken: canonicalizeServiceName(a.token),
    qty: a.qty,
    city,
    candidateServiceIds: a.hits.map((h) => h.service_id),
  }));

  const { needAsk, seedRows, seedIds, autoLabels } = partitionBatchWork(
    workItems,
    services,
    session,
    qtyByServiceId,
  );

  let unavailableNote: string | undefined;
  if (missingLabels.length && availLabels.length) {
    unavailableNote = formatBatchUnavailableNote(city, missingLabels, availLabels);
  }

  if (!needAsk.length) {
    if (seedRows.length) {
      return finalizeSelection([], {
        ...session,
        city,
        qtyByServiceId,
        segments,
        collectedRows: seedRows,
        collectedServiceIds: seedIds,
        workQueue: undefined,
        pendingMedia: [],
        needsContinueConfirm: false,
        batchUnavailableLabels: missingLabels.length ? missingLabels : undefined,
        batchUnavailableNote: unavailableNote,
      }, services);
    }
  }

  const askFirst = needAsk[0] || workItems[0];
  const askRest = needAsk.length ? needAsk.slice(1) : workItems.slice(1);
  const firstLabel = titleCase(askFirst.browseToken || askFirst.medium);

  let intro = '';
  if (unavailableNote) {
    intro = `${unavailableNote}\n\n`;
  }
  intro += copyBatchAutoAddedThenAsk(autoLabels, firstLabel, city);

  // Exact catalog medium → lock; family (bus) → browseToken asks type chips
  const exact = isExactCatalogMedium(askFirst.medium, services);
  const result = startMediumFlow(
    askFirst.medium,
    {
      ...session,
      city,
      medium: exact ? askFirst.medium : undefined,
      browseToken: askFirst.browseToken || askFirst.medium,
      qty: askFirst.qty,
      qtyByServiceId,
      segments,
      candidateServiceIds: askFirst.candidateServiceIds,
      workQueue: askRest,
      collectedRows: seedRows,
      collectedServiceIds: seedIds,
      pendingMedia: [],
      pendingCityQueue: undefined,
      needsContinueConfirm: false,
      area: undefined,
      placeHint: undefined,
      batchServiceLabels: availLabels,
      batchUnavailableLabels: missingLabels.length ? missingLabels : undefined,
      batchUnavailableNote: unavailableNote,
      batchUnavailableSpoken: false,
    },
    services,
    reply || intro.trim(),
  );
  const noted = withBatchUnavailableNote(result.botText, {
    ...result.session,
    batchUnavailableNote: unavailableNote || result.session.batchUnavailableNote,
    batchUnavailableLabels: missingLabels.length
      ? missingLabels
      : result.session.batchUnavailableLabels,
    batchUnavailableSpoken: false,
  });
  const prompted = withBatchStepPrompt(
    { ...result, botText: noted.botText, session: noted.session },
    intro.trim(),
  );
  return {
    ...prompted,
    autoConfirmedList: autoLabels.length ? autoLabels : availLabels,
    session: {
      ...prompted.session,
      batchServiceLabels: availLabels,
      batchUnavailableLabels: missingLabels.length ? missingLabels : undefined,
      batchUnavailableNote: unavailableNote,
      collectedRows: seedRows.length ? seedRows : prompted.session.collectedRows,
      collectedServiceIds: seedIds.length ? seedIds : prompted.session.collectedServiceIds,
    },
  };
}

/** Family match: "bus" → bus full/semi; not bus stand. Name fallback uses same rule. */
function filterByMediumFamily(services: DbService[], medium: string): DbService[] {
  const m = canonicalizeServiceName(medium);
  if (!m) return [];
  const byMedium = filterByExactMedium(services, m);
  if (byMedium.length) return byMedium;
  return services.filter((s) => {
    const nameBase = canonicalizeServiceName((s.service_name || '').split(/[·—–|]/)[0] || '');
    return isSameMediumFamily(nameBase, m);
  });
}

function uniqueMediumLabels(services: DbService[]): ProgressiveOption[] {
  return uniqueMediumLabelsWithExamples(services);
}

/** Type chips — catalog medium, merged with DB medium_type when present. */
function uniqueMediumLabelsWithExamples(services: DbService[]): ProgressiveOption[] {
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services) {
    const medium = getMediumKey(s);
    if (!medium) continue;
    const mType = getMediumTypeFromDb(s);
    // Avoid "Metro Train Inside Branding — Inside"
    const typeAlreadyInMedium =
      !!mType
      && canonicalizeServiceName(medium).includes(canonicalizeServiceName(mType));
    const typeForChip = mType && !typeAlreadyInMedium ? mType : null;
    const key = typeForChip
      ? `${canonicalizeServiceName(medium)}|${canonicalizeServiceName(typeForChip)}`
      : canonicalizeServiceName(medium);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    const label = typeForChip
      ? `${titleCase(medium)} — ${titleCase(typeForChip)}`
      : titleCase(medium);
    groups.set(key, {
      rows: [s],
      opt: {
        id: typeForChip
          ? `medium:${medium}|${canonicalizeServiceName(typeForChip)}`
          : `medium:${medium}`,
        label,
        medium,
        mediumType: typeForChip || undefined,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Catalog type keys only — never a hardcoded bus/hoarding list. */
export function getCatalogTypeKeys(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const s of services) {
    const m = getMediumKey(s);
    if (m) set.add(m);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Local multi-type detect using ONLY DB catalog mediums (fallback when AI offline).
 * Matches catalog keys OR their first token ("bus" matches "bus semi branding").
 * Does not treat "bus stand" as Bus (see isAmbiguousPlaceQuery).
 */
export function detectMediaLocal(text: string, services: DbService[]): string[] {
  if (isAmbiguousPlaceQuery(text)) return [];
  // Feature words that span multiple mediums (led, …) → clarify, not one family
  if (detectFeatureClarifyHint(text, services, detectCityInText(text, services))) {
    return [];
  }
  const lower = text.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' and ');
  const catalog = getCatalogTypeKeys(services)
    .map((m) => ({ raw: m, key: canonicalizeServiceName(m) }))
    .filter((m) => m.key.length >= 2)
    .sort((a, b) => b.key.length - a.key.length);

  const found = new Set<string>();
  for (const m of catalog) {
    const words = m.key.split(/\s+/).filter(Boolean);
    const first = words[0] || m.key;
    const fullRe = new RegExp(
      `\\b${m.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
      'i',
    );
    const firstRe = new RegExp(
      `\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
      'i',
    );

    if (fullRe.test(lower)) {
      // Full catalog key matches → use it directly
      found.add(m.key);
    } else if (firstRe.test(lower)) {
      // First word matches → find longest prefix (2+ words) that also matches in text
      let longestMatch = first;
      for (let i = words.length; i >= 2; i--) {
        const prefix = words.slice(0, i).join(' ');
        const prefRe = new RegExp(
          `\\b${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
          'i',
        );
        if (prefRe.test(lower)) {
          longestMatch = prefix;
          break;
        }
      }
      // Prefer longest prefix that appears in the user text (e.g. "no parking"
      // → "no parking", not catalog sibling "no parking printing only").
      // Only fall back to full catalog key when nothing longer matched.
      if (longestMatch !== first || first.length >= 3) {
        found.add(longestMatch);
      } else if (fullRe.test(lower)) {
        found.add(m.key);
      }
    }
  }

  // Prefer specific mediums ("bus shelter") over short family ("bus") when both matched
  const ranked = [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const pruned: string[] = [];
  for (const f of ranked) {
    if (pruned.some((p) => p.startsWith(`${f} `))) continue;
    for (let i = pruned.length - 1; i >= 0; i--) {
      if (f.startsWith(`${pruned[i]} `)) pruned.splice(i, 1);
    }
    pruned.push(f);
  }
  return pruned;
}

/** Ambiguous place/context — prefer AI; local fallback for common multi-type feature phrases. */
export function isAmbiguousPlaceQuery(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bbus\s*stands?\b/.test(t)) return true;
  return false;
}

/**
 * Local: single feature word (led) that hits multiple mediums via name/medium → clarify.
 * Does not trigger for clear families like "bus" when all hits share that family.
 */
export function detectFeatureClarifyHint(
  text: string,
  services: DbService[],
  city: string | null,
): string | null {
  if (/\b(and|&|\+)\b/i.test(text)) return null;
  if (isAmbiguousPlaceQuery(text)) {
    if (/\bbus\s*stands?\b/i.test(text)) return 'bus stand';
    return 'that';
  }
  const cityDetected = city || detectCityInText(text, services);
  const stripped = stripQtyCityDuration(text, cityDetected);
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  if (words.length !== 1) return null;
  const hint = words[0];
  // Locality name (saidapet, padur) — not a feature; place-browse handles it
  if (detectLocalityInText(hint, services) || detectLocalityInText(text, services)) {
    return null;
  }
  const familyRows = filterByMediumFamily(services, hint);
  const familyScoped = cityDetected ? filterByCity(familyRows, cityDetected) : familyRows;
  // Clear product family in DB ("bus", "auto") → let medium flow ask city / areas
  if (familyScoped.length > 0) return null;

  const featureTypes = typesForClarify(services, cityDetected, hint);
  // Feature/feature word only (e.g. led) spanning multiple catalog types
  if (featureTypes.length > 1) return hint;
  return null;
}

/** Types related to a feature/hint — search medium + product name only (not area text). */
function typesForClarify(
  services: DbService[],
  city: string | null,
  hint: string | null,
): ProgressiveOption[] {
  const scoped = city ? filterByCity(services, city) : services;
  if (!hint || !hint.trim()) {
    return uniqueMediumLabelsWithExamples(scoped);
  }
  const h = canonicalizeServiceName(hint);
  const words = h.split(/\s+/).filter((w) => w.length >= 2);

  const nameHeadOf = (s: DbService): string => {
    const name = canonicalizeServiceName((s.service_name || '').split(/[·—–|/]/)[0] || '');
    return name.split(/\s+/).slice(0, 4).join(' ');
  };

  /** Strip led / non led so "mobile van led" and "mobile van non led" share a base. */
  const ledProductBase = (medium: string): string =>
    canonicalizeServiceName(medium)
      .replace(/\bnon\s*led\b/g, ' ')
      .replace(/\bled\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  let matchedSvcs = scoped.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    const nameHead = nameHeadOf(s);
    const hay = `${med} ${nameHead}`;
    if (words.length > 1) {
      return words.every((w) => hay.includes(w));
    }
    // Primary pass: "led" must not match "non led"
    if (h === 'led' && /\bnon\s*led\b/.test(hay)) return false;
    const mType = canonicalizeServiceName(getMediumTypeFromDb(s) || '');
    const hayFull = `${hay} ${mType}`;
    return new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hayFull);
  });

  // "led" clarify: also offer Non LED siblings of the same product (Mobile Van Non LED)
  if (h === 'led' && matchedSvcs.length > 0) {
    const bases = new Set(
      matchedSvcs
        .map((s) =>
          ledProductBase(
            `${getMediumKey(s)} ${getMediumTypeFromDb(s) || ''}`,
          ),
        )
        .filter((b) => b.length >= 3),
    );
    const seen = new Set(matchedSvcs.map((s) => s.service_id));
    for (const s of scoped) {
      if (seen.has(s.service_id)) continue;
      const med = canonicalizeServiceName(getMediumKey(s));
      const mType = canonicalizeServiceName(getMediumTypeFromDb(s) || '');
      const hay = `${med} ${nameHeadOf(s)} ${mType}`;
      if (!/\bnon\s*led\b/.test(hay)) continue;
      const base = ledProductBase(`${getMediumKey(s)} ${mType}`);
      if (!base) continue;
      const ok =
        bases.has(base)
        || [...bases].some(
          (b) =>
            base === b
            || base.startsWith(`${b} `)
            || b.startsWith(`${base} `)
            || isSameMediumFamily(base, b)
            || isSameMediumFamily(b, base),
        );
      if (!ok) continue;
      seen.add(s.service_id);
      matchedSvcs = [...matchedSvcs, s];
    }
  }

  const fromHint = uniqueMediumLabelsWithExamples(matchedSvcs);
  // Never fall back to the full catalog — empty means "not a feature clarify"
  return fromHint;
}


function isCityOnlyQuery(text: string, services: DbService[]): string | null {
  // "give me a quote for chennai" → strip filler first so leftover "give" never blocks
  const cleaned = stripQuoteFiller(text);
  const city = detectCityInText(cleaned, services) || detectCityInText(text, services);
  if (!city) return null;
  if (isAmbiguousPlaceQuery(cleaned) || isAmbiguousPlaceQuery(text)) return null;
  if (detectMediaLocal(cleaned, services).length > 0) return null;
  if (detectMediaLocal(text, services).length > 0) return null;
  const stripped = stripQtyCityDuration(cleaned || text, city);
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  const cityTokens = new Set(city.toLowerCase().split(/\s+/));
  const rest = words.filter((w) => !cityTokens.has(w));
  if (rest.length === 0) return city;
  if (rest.every((w) => [
    'service', 'services', 'available', 'list', 'show', 'all', 'options',
    'advertising', 'ads', 'media', 'btl', 'outdoor',
  ].includes(w))) {
    return city;
  }
  return null;
}

/** Locality-only query e.g. "saidapet" / "padur" → browse types at that place. */
function isLocalityOnlyQuery(text: string, services: DbService[]): string | null {
  if (isCityOnlyQuery(text, services)) return null;
  // Service/medium words (apartment, bus, hoarding…) are never localities
  if (detectMediaLocal(text, services).length > 0) return null;
  if (filterByMediumFamily(services, text.trim()).length > 0) return null;

  const locality = detectLocalityInText(text, services);
  if (!locality) return null;
  if (isAmbiguousPlaceQuery(text)) return null;

  // If the detected "locality" is itself a known medium/type token, ignore
  const locKey = canonicalizeServiceName(locality);
  if (filterByMediumFamily(services, locKey).length > 0) return null;
  if (detectMediaLocal(locKey, services).length > 0) return null;

  // Don't treat as locality-only if user also named a clear ad medium (bus, auto, …)
  const stripped = text.replace(
    new RegExp(`\\b${locality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'),
    ' ',
  );
  const media = detectMediaLocal(stripped, services);
  if (media.length > 0) return null;
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  const locTokens = new Set(locality.toLowerCase().split(/\s+/));
  const rest = words.filter((w) => !locTokens.has(w));
  if (rest.length === 0) return locality;
  if (rest.every((w) => ['service', 'services', 'available', 'list', 'show', 'all', 'options', 'near', 'in', 'at'].includes(w))) {
    return locality;
  }
  return null;
}

function mediumLabelsForCity(services: DbService[], city: string): ProgressiveOption[] {
  return uniqueMediumOnlyOptions(filterByCity(services, city));
}

/** Size/finish style tokens — same family as "bus full", not different products like "bus stand". */
const MEDIUM_STYLE_TOKENS = new Set([
  'full', 'semi', 'branding', 'wrap', 'wrapping', 'panel', 'back', 'front',
  'interior', 'exterior', 'non', 'led', 'lcd', 'digital', 'static', 'premium',
  'standard', 'basic', 'partial', 'complete', 'side', 'rear', 'top', 'outside',
  'elevated', 'underground', 'train', 'inside', 'platform',
]);

function isSameMediumFamily(mediumKey: string, familyToken: string): boolean {
  const mk = canonicalizeServiceName(mediumKey);
  const m = canonicalizeServiceName(familyToken);
  if (!m || !mk) return false;
  if (mk === m) return true;
  const parts = mk.split(/\s+/).filter(Boolean);
  if (parts[0] !== m) return false;
  if (parts.length === 1) return true;
  // Remaining tokens must all be style words (not "stand", "booth", "shelter", …)
  return parts.slice(1).every((p) => MEDIUM_STYLE_TOKENS.has(p));
}

/** Strict family filter: "auto" → auto full / auto semi. Not "bus stand" when asking "bus". */
function filterByExactMedium(services: DbService[], medium: string): DbService[] {
  const m = canonicalizeServiceName(medium);
  if (!m) return [];
  const exact = services.filter((s) => canonicalizeServiceName(getMediumKey(s)) === m);
  if (exact.length) return exact;
  return services.filter((s) => isSameMediumFamily(getMediumKey(s), m));
}

function uniqueServiceOptions(services: DbService[], limit = Number.POSITIVE_INFINITY): ProgressiveOption[] {
  const seen = new Set<string>();
  const out: ProgressiveOption[] = [];
  for (const s of services) {
    const id = s.service_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: friendlyServiceLabel(s),
      serviceId: id,
      city: getDbCityLabel(s) || extractRealCityFromDbService(s) || undefined,
      medium: getMediumKey(s),
      imageUrl: getChipImageUrl(s),
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function uniqueProductOptions(services: DbService[]): ProgressiveOption[] {
  // Prefer medium + medium_type merge; keep Elevated / Underground distinct.
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services) {
    const medium = getMediumKey(s);
    const mType = getMediumTypeFromDb(s);
    const typeAlreadyInMedium =
      !!mType
      && !!medium
      && canonicalizeServiceName(medium).includes(canonicalizeServiceName(mType));
    const merged =
      medium && mType && !typeAlreadyInMedium
        ? `${titleCase(medium)} — ${titleCase(mType)}`
        : null;
    const label = (
      merged
      || formatServiceDisplayName(s)
      || (s.service_name || '').split('·')[0]
      || friendlyServiceLabel(s)
    ).trim();
    const key = canonicalizeServiceName(label);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `product:${key}`,
        label: label.length > 60 ? label.slice(0, 57) + '…' : label,
        medium: medium || getMediumKey(s),
        mediumType: mType && !typeAlreadyInMedium ? mType : undefined,
        serviceId: getAreaLabel(s) ? undefined : s.service_id,
        city: extractRealCityFromDbService(s) || undefined,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 40);
}

function citiesForMedium(services: DbService[], medium: string): ProgressiveOption[] {
  const scoped = filterForBrowseOrFamily(services, medium);
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of scoped) {
    const c = funnelCityFromDb(s);
    if (!c) continue;
    const key = c.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `city:${key}`,
        label: c,
        city: c,
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'area'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function areasForMediumCity(services: DbService[], medium: string, city: string): DbService[] {
  return filterForBrowseOrFamily(services, medium).filter((s) =>
    serviceMatchesCityLabel(s, city),
  );
}

/** Unique place chips: localities as-is; metro+area as "City · Area". */
function uniquePlaceOptions(services: DbService[], token: string): ProgressiveOption[] {
  const hits = filterForBrowseOrFamily(services, token);
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();

  for (const s of hits) {
    const place = resolveDisplayPlace(s, token);
    if (!place) continue;
    const existing = groups.get(place.id);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    // Strip any pre-set image; unique-next applied below
    const { imageUrl: _drop, ...base } = place;
    groups.set(place.id, { opt: base, rows: [s] });
  }

  if (groups.size === 0) {
    return citiesForMedium(services, token);
  }

  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      // Place → next is area sites' directions (1 direction = unique site image)
      imageUrl: chipImageIfUniqueNext(rows, 'direction'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Distinct area chips within a city for a browse token. */
function uniqueAreaOptions(services: DbService[], token: string, city: string): ProgressiveOption[] {
  const hits = areasForMediumCity(services, token, city);
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of hits) {
    const area = getFunnelAreaLabel(s);
    if (!area) continue;
    const key = canonicalizeServiceName(area);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `area:${key}`,
        label: area,
        city,
        medium: token,
        serviceId: undefined,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'direction'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** After location narrowed: continue strict funnel Service → Type → City → Area → Direction. */
function afterLocationResolved(
  hits: DbService[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  return advanceFunnel(
    {
      ...session,
      candidateServiceIds: hits.length
        ? hits.map((s) => s.service_id)
        : session.candidateServiceIds,
    },
    services,
    reply,
  );
}

/** Build direction picker options from a set of services that have direction_remarks. */
function buildDirectionPicker(
  hits: DbService[],
  session: ProgressiveSession,
  locationLabel: string,
): ProgressiveTurnResult {
  const typeKeys = [
    ...new Set(
      hits
        .map((s) => {
          const t = getMediumTypeFromDb(s);
          return t ? canonicalizeServiceName(t) : '';
        })
        .filter(Boolean),
    ),
  ];
  const annotateType = typeKeys.length > 1;

  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of hits) {
    const dir = getDirectionLabel(s);
    if (!dir) continue;
    const mType = getMediumTypeFromDb(s);
    const typeKey = mType ? canonicalizeServiceName(mType) : '';
    // Multi-type union (Frontlit + Nonlit): keep both lines even if direction text matches
    const key = annotateType && typeKey
      ? `${canonicalizeServiceName(dir)}|${typeKey}`
      : canonicalizeServiceName(dir);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    const label =
      annotateType && mType
        ? `${dir} (${titleCase(mType)})`
        : dir;
    groups.set(key, {
      rows: [s],
      opt: {
        id: `direction:${s.service_id}`,
        label,
        serviceId: s.service_id,
        city: extractRealCityFromDbService(s) || undefined,
        medium: getMediumKey(s),
        mediumType: mType || undefined,
      },
    });
  }
  const options = [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      // Direction chip → show image only for a single site
      imageUrl: chipImageIfUniqueNext(rows, 'site'),
      serviceId: rows.length === 1 ? rows[0].service_id : opt.serviceId,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const mediumName = titleCase(getMediumKey(hits[0]) || session.medium || 'service');
  const ask = copyAskDirection(locationLabel || 'that area', mediumName, session);
  const noted = withBatchUnavailableNote(ask, {
    ...session,
    medium: getMediumKey(hits[0]) || session.medium,
    candidateServiceIds: hits.map((s) => s.service_id),
  });
  return {
    step: 'pick_direction',
    botText: noted.botText,
    options,
    allowMulti: true,
    session: {
      ...noted.session,
      // One site round for place/OMR / multi-type union — never leave workQueue → "Next up"
      workQueue: undefined,
      pendingCityQueue: undefined,
      batchServiceLabels: undefined,
      area: session.area || session.placeHint || noted.session.area,
      placeHint: session.placeHint || session.area || noted.session.placeHint,
    },
  };
}

/**
 * After multi-area Confirm: checkbox list of every site (Area · direction).
 * Includes sites with no direction_remarks (label = area / service name).
 */
function buildMultiAreaSitePicker(
  hits: DbService[],
  session: ProgressiveSession,
  areaLabels: string[],
): ProgressiveTurnResult {
  const options: ProgressiveOption[] = [];
  const seen = new Set<string>();
  for (const s of hits) {
    if (seen.has(s.service_id)) continue;
    seen.add(s.service_id);
    const area = getFunnelAreaLabel(s) || getAreaLabel(s) || '';
    const dir = getDirectionLabel(s);
    let label: string;
    if (area && dir) {
      const aKey = canonicalizeServiceName(area);
      const dKey = canonicalizeServiceName(dir);
      label =
        dKey.includes(aKey) || aKey.includes(dKey) ? dir : `${area} · ${dir}`;
    } else {
      label = dir || area || friendlyServiceLabel(s);
    }
    options.push({
      id: `direction:${s.service_id}`,
      label,
      serviceId: s.service_id,
      city: extractRealCityFromDbService(s) || undefined,
      medium: getMediumKey(s),
      imageUrl: getChipImageUrl(s),
      group: area || undefined,
    });
  }
  options.sort((a, b) => {
    const byGroup = (a.group || '').localeCompare(b.group || '', undefined, {
      sensitivity: 'base',
    });
    if (byGroup !== 0) return byGroup;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  const loc =
    areaLabels.length === 0
      ? session.city || 'those areas'
      : areaLabels.length <= 3
        ? areaLabels.join(', ')
        : `${areaLabels.slice(0, 2).join(', ')} +${areaLabels.length - 2} more`;
  const mediumName = titleCase(getMediumKey(hits[0]) || session.medium || 'service');
  return {
    step: 'pick_direction',
    botText: copyAskDirection(loc, mediumName, session),
    options,
    allowMulti: true,
    session: {
      ...session,
      medium: getMediumKey(hits[0]) || session.medium,
      area: undefined,
      needsContinueConfirm: false,
      candidateServiceIds: hits.map((s) => s.service_id),
      workQueue: undefined,
      pendingCityQueue: undefined,
    },
  };
}

/** Service chips only (medium) — Type is a separate funnel step. */
function uniqueMediumOnlyOptions(services: DbService[]): ProgressiveOption[] {
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services) {
    const medium = getMediumKey(s);
    if (!medium) continue;
    const key = canonicalizeServiceName(medium);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `medium:${medium}`,
        label: titleCase(medium),
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** medium_type chips for a selected service (Nonlit / Lit / Elevated …). */
function uniqueTypeOnlyOptions(services: DbService[], medium: string): ProgressiveOption[] {
  const want = canonicalizeServiceName(medium);
  const family = want.split(/\s+/).filter(Boolean)[0] || want;
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services) {
    const mk = canonicalizeServiceName(getMediumKey(s));
    if (!mk) continue;
    // "metro station" types + sibling "metro wrap" / "metro train inside" under family "metro"
    const mediumOk =
      mk === want
      || isSameMediumFamily(mk, want)
      || (family.length >= 3 && (isSameMediumFamily(mk, family) || mk.startsWith(`${family} `)));
    if (!mediumOk) continue;
    const mType = getMediumTypeFromDb(s);
    if (!mType) continue;
    const key = canonicalizeServiceName(mType);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `medium:${medium}|${key}`,
        label: titleCase(mType),
        medium,
        mediumType: mType,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function uniqueCityOptionsFromPool(services: DbService[], medium?: string): ProgressiveOption[] {
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services) {
    // Raw DB city; if blank → area_name. Never invent Chennai / metro preference.
    const city = funnelCityFromDb(s);
    if (!city) continue;
    const key = city.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `city:${key}`,
        label: city,
        city,
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'area'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Area chips — raw area_name from DB (long site lines OK; duplicates with direction OK). */
function getFunnelAreaLabel(svc: DbService): string | null {
  const raw = getMetaAreaRaw(svc);
  if (!raw || isNumericOnlyLabel(raw)) return null;
  return raw;
}

function uniqueAreaOptionsFromPool(
  services: DbService[],
  city: string | undefined,
  medium?: string,
): ProgressiveOption[] {
  const scoped = city
    ? services.filter((s) => serviceMatchesCityLabel(s, city))
    : services;
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of scoped) {
    const area = getFunnelAreaLabel(s);
    if (!area) continue;
    const key = canonicalizeServiceName(area);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `area:${key}`,
        label: area,
        city,
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'direction'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Match free text against direction_remarks (multi-word sites like "Gemini Flyover").
 * Prefers longest / strongest phrase match.
 */
export function detectDirectionInText(
  text: string,
  services: DbService[],
): { phrase: string; serviceIds: string[]; city?: string; area?: string } | null {
  const lower = text.toLowerCase().trim();
  if (lower.length < 4) return null;

  // "metro" / "bus" / "led" → service flow, never steal a direction that mentions the word
  const bareWords = extractQueryWords(lower).filter((w) => !STOP_WORDS.has(w));
  if (bareWords.length === 1 && isCatalogMediumToken(bareWords[0], services)) {
    return null;
  }
  if (detectMediaLocal(text, services).length > 0) {
    return null;
  }

  type Cand = { phrase: string; len: number; svc: DbService };
  const cands: Cand[] = [];

  for (const s of services) {
    const dir = getDirectionLabel(s);
    if (!dir || dir.length < 4) continue;
    const dLower = dir.toLowerCase();
    // Full-phrase containment only when query is multi-word or long place-like (≥8 chars)
    if (
      (bareWords.length >= 2 || lower.length >= 8)
      && (dLower.includes(lower) || (lower.length >= 8 && lower.includes(dLower)))
    ) {
      cands.push({ phrase: dir, len: Math.min(dLower.length, lower.length), svc: s });
      continue;
    }
    const qWords = bareWords.filter((w) => w.length >= 3);
    if (qWords.length === 0) continue;
    // Skip catalog medium tokens as direction keys (metro ≠ Anna Nagar Metro Station)
    if (qWords.every((w) => isCatalogMediumToken(w, services))) continue;
    const allHit = qWords.every((w) =>
      new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(dLower),
    );
    if (!allHit) continue;
    if (qWords.length >= 2 || (qWords.length === 1 && qWords[0].length >= 5)) {
      cands.push({ phrase: dir, len: qWords.join(' ').length, svc: s });
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.len - a.len || b.phrase.length - a.phrase.length);
  const bestPhrase = cands[0].phrase;
  const bestKey = canonicalizeServiceName(bestPhrase);
  const byDir = services.filter((s) => {
    const d = getDirectionLabel(s);
    return d && canonicalizeServiceName(d) === bestKey;
  });
  const matched = cands
    .filter((c) => {
      const k = canonicalizeServiceName(c.phrase);
      return k === bestKey || k.includes(bestKey) || bestKey.includes(k);
    })
    .map((c) => c.svc);
  const all = byDir.length ? byDir : matched;
  const uniq = [...new Map(all.map((s) => [s.service_id, s])).values()];
  const areas = [
    ...new Set(
      uniq.map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s)).filter(Boolean) as string[],
    ),
  ];
  return {
    phrase: bestPhrase,
    serviceIds: uniq.map((s) => s.service_id),
    // Never silent-set city — funnel confirms when exactly one remains
    city: undefined,
    area: areas.length === 1 ? areas[0] : undefined,
  };
}

/** True when `token` is an exact catalog medium key (e.g. "bus semi", "apartment demo"). */
function isExactCatalogMedium(token: string, services: DbService[]): boolean {
  const t = canonicalizeServiceName(token);
  if (!t) return false;
  return services.some((s) => canonicalizeServiceName(getMediumKey(s)) === t);
}

/** Pool used for the City step — same medium/type scope as the funnel pool. */
function poolForCityOptions(
  services: DbService[],
  session: ProgressiveSession,
  scopedPool: DbService[],
): DbService[] {
  // Place/area already locked → stay scoped
  if (session.area || session.placeHint) return scopedPool;

  const token = session.medium || session.browseToken || '';
  if (!token) return scopedPool;

  let hits: DbService[] = [];
  if (session.medium && isExactCatalogMedium(session.medium, services)) {
    hits = filterByExactMedium(services, session.medium);
  }
  if (!hits.length) {
    hits = filterForBrowseOrFamily(services, token);
  }
  if (!hits.length) return scopedPool;

  // MUST apply mediumType so chips match what filterPoolBySession will keep
  if (session.mediumType) {
    const mt = canonicalizeServiceName(session.mediumType);
    hits = hits.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mt;
    });
  }
  return hits.length ? hits : scopedPool;
}

/**
 * Prefix bot text once with batch "not offered in city" note (Cab in Madurai, etc.).
 */
function withBatchUnavailableNote(
  botText: string,
  session: ProgressiveSession,
): { botText: string; session: ProgressiveSession } {
  const note = (session.batchUnavailableNote || '').trim();
  if (!note || session.batchUnavailableSpoken) {
    return { botText, session };
  }
  // Avoid double-prefix if caller already included the note
  if (
    botText.includes(note)
    || /isn['’]t available in|currently not (offering|providing)/i.test(botText)
  ) {
    return {
      botText,
      session: { ...session, batchUnavailableSpoken: true },
    };
  }
  const ask = botText.trim();
  return {
    botText: ask ? `${note}\n\n${ask}` : note,
    session: { ...session, batchUnavailableSpoken: true },
  };
}

function formatBatchUnavailableNote(city: string, missing: string[], available: string[]): string {
  const miss =
    missing.length === 1
      ? missing[0]
      : missing.length === 2
        ? `${missing[0]} and ${missing[1]}`
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  const have =
    available.length === 0
      ? ''
      : available.length === 1
        ? available[0]
        : available.length === 2
          ? `${available[0]} and ${available[1]}`
          : `${available.slice(0, -1).join(', ')} and ${available[available.length - 1]}`;
  if (have) {
    return `We're currently not providing ${miss} services in ${city}.\n\nLet's continue with ${have}.`;
  }
  return `We're currently not providing ${miss} services in ${city}.`;
}

/** Lock the only city and continue the funnel (no OK Continue tap). */
function lockOneCity(
  sess: ProgressiveSession,
  pool: DbService[],
  onlyCity: string,
): ProgressiveSession {
  return {
    ...sess,
    city: onlyCity,
    needsContinueConfirm: false,
    candidateServiceIds: pool.map((s) => s.service_id),
    pendingRows: undefined,
  };
}

function filterPoolBySession(services: DbService[], session: ProgressiveSession): DbService[] {
  let pool = session.candidateServiceIds?.length
    ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
    : [...services];

  if (session.medium || session.browseToken) {
    const token = session.browseToken || session.medium || '';
    // Exact catalog medium ("bus semi", "apartment demo") → exact filter
    // Family token ("bus") → browse so bus shelter / other cities are included
    if (session.medium && isExactCatalogMedium(session.medium, services)) {
      const exactMed = filterByExactMedium(pool, session.medium);
      if (exactMed.length) pool = exactMed;
      else {
        const byBrowse = filterForBrowseOrFamily(pool, token);
        if (byBrowse.length) pool = byBrowse;
      }
    } else {
      const byBrowse = filterForBrowseOrFamily(pool, token);
      if (byBrowse.length) {
        pool = byBrowse;
      } else if (session.medium) {
        const exactMed = filterByExactMedium(pool, session.medium);
        if (exactMed.length) pool = exactMed;
      }
    }
  }

  if (session.mediumType) {
    const mt = canonicalizeServiceName(session.mediumType);
    pool = pool.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mt;
    });
  }

  if (session.directionHint) {
    const hint = canonicalizeServiceName(session.directionHint);
    const hintRe = new RegExp(
      `\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    );
    const dirHits = pool.filter((s) => {
      const dir = getDirectionLabel(s);
      if (!dir) return false;
      const d = canonicalizeServiceName(dir);
      return d === hint || d.includes(hint) || hint.includes(d) || hintRe.test(dir);
    });
    if (dirHits.length) pool = dirHits;
  }

  return filterHitsBySessionLocation(pool, session);
}

/**
 * Strict funnel: Service → Type → City → Area → Direction → Quote.
 * Skip empty/NA steps; auto-select when only one option; ask when many.
 */
export function advanceFunnel(
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  // browseToken alone = family browse (e.g. "bus") — do NOT promote to locked medium
  let sess: ProgressiveSession = {
    ...session,
    medium: session.medium,
    browseToken: session.browseToken || session.medium,
    // Confirmed place hint acts as area when area not set
    area: session.area || session.placeHint,
  };

  for (let guard = 0; guard < 10; guard++) {
    const pool = filterPoolBySession(services, sess);
    if (!pool.length) {
      const where = [sess.city, sess.area].filter(Boolean).join(' · ');
      const svcLabel = sess.medium || sess.browseToken;
      const fallback = sess.city && svcLabel
        ? copyNotOfferedInCity(svcLabel, sess.city, sess)
        : sess.area && svcLabel
          ? copyUnknownArea(sess.area, sess)
          : sess.city
            ? copyUnknownCity(sess.city, sess)
            : copyUnknownService(sess);
      return {
        step: 'no_match',
        // Never keep "which type?" when options are empty — that looks like a freeze
        botText:
          reply && !isAskStepReplyWithoutOptions(reply) ? reply : fallback,
        options: [],
        session: sess,
      };
    }

    sess = {
      ...sess,
      candidateServiceIds: pool.map((s) => s.service_id),
    };

    // 1) Service (medium)
    if (!sess.medium) {
      const mediums = uniqueMediumOnlyOptions(pool);
      if (mediums.length > 1) {
        const where = [sess.city, sess.area].filter(Boolean).join(' · ');
        return {
          step: 'pick_type',
          botText:
            reply
            || (sess.directionHint
              ? `Sure!\n\nWhich service do you need for ${sess.directionHint}?`
              : where
                ? copyPlaceServices(where, sess)
                : sess.browseToken
                  ? copyAskType(sess.browseToken, sess)
                  : copyWhichService(sess)),
          options: mediums,
          allowMulti: true,
          session: sess,
        };
      }
      if (mediums.length === 1) {
        sess = {
          ...sess,
          medium: mediums[0].medium,
          browseToken: mediums[0].medium,
        };
        continue;
      }
    }

    // 2) Type — ALWAYS before City (RULE 1)
    // Family browse (token is NOT an exact catalog medium) → distinct mediums from DB.
    // Exact medium locked (e.g. Metro Station) → only that medium's medium_type from DB.
    // Never remount the family medium list once an exact medium is locked.
    if (sess.medium && !sess.mediumType && !sess.typesResolved) {
      const exactMedium = isExactCatalogMedium(sess.medium, services);
      if (!exactMedium) {
        const familyTok = canonicalizeServiceName(sess.browseToken || sess.medium);
        // Bare family tokens (metro / bus): merge sibling catalog rows from DB only
        const typePool = isMetroSegmentToken(familyTok)
          ? mergeMetroFamilyServices(services, pool)
          : pool;
        const familyOpts = uniqueMediumLabelsWithExamples(typePool);
        if (familyOpts.length > 1) {
          const place = sess.area || sess.placeHint || sess.city;
          return {
            step: 'pick_type',
            botText: typeStepBotText(reply, sess.browseToken || sess.medium, place, sess),
            // Thumbs via unique-next only (1 city, ≤1 type, ≤1 direction)
            options: familyOpts,
            allowMulti: true,
            session: {
              ...sess,
              candidateServiceIds: typePool.map((s) => s.service_id),
            },
          };
        }
        if (familyOpts.length === 1) {
          sess = {
            ...sess,
            medium: canonicalizeServiceName(familyOpts[0].medium || sess.medium),
            mediumType: familyOpts[0].mediumType
              ? canonicalizeServiceName(familyOpts[0].mediumType)
              : sess.mediumType,
            browseToken: familyOpts[0].medium || sess.browseToken,
            typesResolved: true,
          };
          continue;
        }
      }

      const types = uniqueTypeOnlyOptions(pool, sess.medium);
      if (types.length > 1) {
        const place = sess.area || sess.placeHint || sess.city;
        return {
          step: 'pick_type',
          botText: typeStepBotText(reply, sess.medium, place, sess),
          // Elevated/Underground etc. — thumb when that type is unique-next
          options: types,
          allowMulti: true, // Same as city/service chips — multi type → one quote / workQueue
          session: sess,
        };
      }
      if (types.length === 1) {
        // Don't auto-lock the single type when the pool also contains untyped services
        // for the same medium (e.g. plain "Police Booth" alongside "Police Booth Inside").
        // Auto-locking would silently narrow city options to only the typed variant's cities.
        const wantedMedium = canonicalizeServiceName(sess.medium || '');
        const hasUntypedSiblings = pool.some(
          (s) =>
            canonicalizeServiceName(getMediumKey(s)) === wantedMedium
            && !getMediumTypeFromDb(s),
        );
        if (!hasUntypedSiblings) {
          sess = {
            ...sess,
            mediumType: canonicalizeServiceName(types[0].mediumType || types[0].label),
            typesResolved: true,
          };
          continue;
        }
        // Untyped siblings exist — skip type auto-lock; city step will include all variants
      }
      // 0 types — skip
    }

    // 3) City — raw DB city values (OMR/Padur/Chennai as stored). No metro invent.
    if (!sess.city) {
      const cityPool = poolForCityOptions(services, sess, pool);
      const cities = uniqueCityOptionsFromPool(cityPool, sess.medium);
      if (cities.length > 1) {
        // Place locked (near OMR): confirm with DB city labels in this pool — never invent Chennai
        if (sess.area || sess.placeHint) {
          const place = sess.area || sess.placeHint || '';
          const placeKey = canonicalizeServiceName(place);
          const placeAsCity = cities.find(
            (c) => canonicalizeServiceName(c.city || c.label) === placeKey,
          );
          if (placeAsCity) {
            sess = lockOneCity(
              sess,
              cityPool,
              placeAsCity.city || placeAsCity.label,
            );
            continue;
          }
          // Multiple distinct DB cities under this place scope → ask those labels
          return {
            step: 'pick_city',
            botText: reply || copyAskCities(sess.medium, sess),
            options: cities,
            allowMulti: true,
            session: {
              ...sess,
              candidateServiceIds: cityPool.map((s) => s.service_id),
              needsContinueConfirm: false,
            },
          };
        }
        return {
          step: 'pick_city',
          botText:
            reply
            || copyAskCities(sess.medium, sess),
          options: cities,
          allowMulti: true, // RULE 2: city/place chips = checkboxes
          session: {
            ...sess,
            candidateServiceIds: cityPool.map((s) => s.service_id),
            needsContinueConfirm: false,
          },
        };
      }
      if (cities.length === 1) {
        const onlyCity = cities[0].city || cities[0].label;
        sess = lockOneCity(sess, cityPool, onlyCity);
        continue;
      }
      // 0 cities (all NA) — if place locked, lock place label and continue
      if ((sess.area || sess.placeHint) && cityPool.length > 0) {
        sess = lockOneCity(
          sess,
          cityPool,
          sess.area || sess.placeHint || 'this place',
        );
        continue;
      }
      // 0 cities (all NA) — skip city step
    }

    // 4) Area — actual area_name values (ask if 2+ even if text looks like directions)
    if (!sess.area) {
      const areas = uniqueAreaOptionsFromPool(pool, sess.city, sess.medium);
      if (areas.length > 1) {
        return {
          step: 'pick_area',
          botText:
            reply
            || copyAskArea(sess.city, sess.medium, sess),
          options: areas,
          allowMulti: true,
          session: sess,
        };
      }
      if (areas.length === 1) {
        sess = { ...sess, area: areas[0].label };
        continue;
      }
    }

    const finalPool = filterPoolBySession(services, sess);
    if (!finalPool.length) {
      return {
        step: 'no_match',
        botText: reply || "We couldn't find a match for that selection.\n\nPlease choose another option.",
        options: [],
        session: sess,
      };
    }

    // 5) Direction — ask when 2+ before any finalize
    const withDir = finalPool.filter((s) => !!getDirectionLabel(s));
    const dirKeys = [
      ...new Set(
        withDir
          .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
          .filter(Boolean),
      ),
    ];
    const where = [sess.city, sess.area].filter(Boolean).join(' · ') || sess.directionHint || '';

    // Place/area path with no city in metadata — auto-lock place and continue
    if (sess.needsContinueConfirm && !sess.city) {
      sess = lockOneCity(
        { ...sess, medium: sess.medium || getMediumKey(finalPool[0]) },
        finalPool,
        sess.area || where || 'this city',
      );
      continue;
    }

    if (dirKeys.length > 1) {
      return buildDirectionPicker(withDir, {
        ...sess,
        needsContinueConfirm: false,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      }, where);
    }

    // Place-only collapse — auto-clear continue flag (no OK tap)
    if (sess.needsContinueConfirm) {
      sess = { ...sess, needsContinueConfirm: false };
      if (!sess.city) {
        const onlyCity =
          uniqueCityOptionsFromPool(finalPool, sess.medium)[0]?.city
          || sess.area
          || where
          || 'this city';
        sess = lockOneCity(
          { ...sess, medium: sess.medium || getMediumKey(finalPool[0]) },
          finalPool,
          onlyCity,
        );
      }
      continue;
    }

    if (dirKeys.length === 1 && withDir.length >= 1) {
      const reps = new Map<string, DbService>();
      for (const s of withDir) {
        const key = canonicalizeServiceName(getDirectionLabel(s) || s.service_id);
        if (!reps.has(key)) reps.set(key, s);
      }
      return finalizeSelection([...reps.values()], {
        ...sess,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      }, services);
    }

    if (finalPool.length === 1) {
      return finalizeSelection(finalPool, sess, services);
    }

    // Type already confirmed (Elevated / Underground / multi Confirm) — do not re-ask the
    // same split as "Metro Station — Elevated" product chips. One rep per medium_type.
    if (sess.typesResolved && dirKeys.length <= 1) {
      const byType = new Map<string, DbService>();
      for (const s of finalPool) {
        const t = canonicalizeServiceName(getMediumTypeFromDb(s) || '_none');
        if (!byType.has(t)) byType.set(t, s);
      }
      if (byType.size >= 1) {
        return finalizeSelection([...byType.values()], {
          ...sess,
          candidateServiceIds: finalPool.map((s) => s.service_id),
        }, services);
      }
    }

    const products = uniqueProductOptions(finalPool);
    if (products.length > 1) {
      return {
        step: 'related_services',
        botText: reply || copyAskDirection(where || '', titleCase(sess.medium || 'service'), sess),
        options: products,
        allowMulti: true,
        session: {
          ...sess,
          candidateServiceIds: finalPool.map((s) => s.service_id),
        },
      };
    }

    return {
      step: 'related_services',
      botText: reply || copyAskDirection(where || '', titleCase(sess.medium || 'service'), sess),
      options: uniqueServiceOptions(finalPool),
      allowMulti: true,
      session: {
        ...sess,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      },
    };
  }

  return {
    step: 'no_match',
    botText: copyWhichService(),
    options: [],
    session: sess,
  };
}

/** Short / unclear free text → candidate for Did you mean? */
function isShortAmbiguousQuery(text: string): boolean {
  const words = extractQueryWords(text).filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const t = text.trim();
  return words.length >= 1 && words.length <= 2 && t.length <= 28 && !/\band\b/i.test(t);
}

/** Exact catalog medium match (full key), not a partial "booth"→"police booth". */
function isExactMediaQuery(text: string, services: DbService[]): boolean {
  const q = canonicalizeServiceName(text);
  if (!q) return false;
  return getCatalogTypeKeys(services).some((m) => canonicalizeServiceName(m) === q);
}

/** Exact full locality/area name in DB. */
function isExactLocalityQuery(text: string, services: DbService[]): boolean {
  const q = canonicalizeServiceName(text);
  if (!q) return false;
  return getCatalogLocalities(services).some((l) => canonicalizeServiceName(l) === q);
}

function suggestPartialPlace(text: string, services: DbService[]): string | null {
  const q = canonicalizeServiceName(text);
  if (q.length < 3) return null;
  if (isExactLocalityQuery(text, services)) return null;

  // Prefer short area_name values for place hints (unused for DYM — kept for batch hint)
  const areaSet = new Set<string>();
  for (const s of services) {
    const area = getFunnelAreaLabel(s);
    if (area && area.split(/\s+/).length <= 4) areaSet.add(area);
    const loc = getLocalityFromMetaCity(s);
    if (loc && !isDirectionLikeLabel(loc)) areaSet.add(loc);
  }
  const places = [...areaSet]
    .map((p) => ({ raw: p, key: canonicalizeServiceName(p) }))
    .filter((p) => {
      if (p.key.length <= q.length) return false;
      if (isDirectionLikeLabel(p.raw)) return false;
      if (p.raw.split(/\s+/).length > 4) return false;
      return (
        p.key.startsWith(q)
        || p.key.includes(` ${q}`)
        || new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p.key)
      );
    })
    .sort((a, b) => a.key.length - b.key.length || a.key.localeCompare(b.key));
  if (!places.length) return null;
  const starts = places.filter(
    (p) => p.key.startsWith(q) || p.key.includes(` ${q}`),
  );
  return (starts.length ? starts : places)[0].raw;
}

function suggestPartialService(text: string, services: DbService[]): string | null {
  const q = canonicalizeServiceName(text);
  if (q.length < 3) return null;
  if (isExactMediaQuery(text, services)) return null;
  const catalog = getCatalogTypeKeys(services)
    .map((m) => ({ raw: m, key: canonicalizeServiceName(m) }))
    .filter((m) => m.key.length > q.length && (m.key.includes(q) || m.key.split(/\s+/).includes(q)))
    .sort((a, b) => a.key.length - b.key.length);
  if (!catalog.length) {
    // browse: booth → Police Booth via name
    const browse = filterByBrowseToken(services, q);
    const mediums = uniqueMediumOnlyOptions(browse);
    if (mediums.length === 1) {
      const m = mediums[0].medium || '';
      if (canonicalizeServiceName(m) !== q) return m;
    }
    return null;
  }
  return catalog[0].raw;
}

function buildDidYouMeanTurn(
  label: string,
  kind: 'place' | 'service',
  session: ProgressiveSession,
  serviceId?: string,
): ProgressiveTurnResult {
  return {
    step: 'did_you_mean',
    botText: `Just to confirm — did you mean ${titleCase(label)}?`,
    options: [
      {
        id: 'yes',
        label: 'Yes',
        serviceId,
        medium: kind === 'service' ? label : undefined,
        city: kind === 'place' ? undefined : undefined,
      },
      { id: 'no', label: 'No' },
    ],
    session: {
      ...session,
      bestGuessKind: kind,
      bestGuessLabel: titleCase(label),
      bestGuessServiceId: serviceId,
      medium: kind === 'service' ? canonicalizeServiceName(label) : session.medium,
      placeHint: kind === 'place' ? titleCase(label) : session.placeHint,
    },
  };
}

/**
 * After one city/service finishes, continue pending city queue or batch work queue.
 */
function continuePendingWork(
  session: ProgressiveSession,
  collectedRows: ConfirmationRow[],
  collectedServiceIds: string[],
  services: DbService[],
): ProgressiveTurnResult | null {
  const cityQueue = [...(session.pendingCityQueue || [])];
  if (cityQueue.length > 0) {
    const nextCity = cityQueue.shift()!;
    return advanceFunnel(
      {
        ...session,
        city: nextCity,
        area: session.placeHint || undefined,
        directionHint: undefined,
        mediumType: session.mediumType,
        pendingCityQueue: cityQueue,
        collectedRows,
        collectedServiceIds,
        candidateServiceIds: undefined,
        pendingRows: undefined,
      },
      services,
      `Next — ${titleCase(session.medium || 'service')} in ${nextCity}.`,
    );
  }

  const workQueue = [...(session.workQueue || [])];
  if (workQueue.length > 0) {
    const next = workQueue.shift()!;
    const browse = canonicalizeServiceName(next.browseToken || next.medium);
    const med = canonicalizeServiceName(next.medium);
    const exact = isExactCatalogMedium(med, services);
    const nextLabel = titleCase(browse || med);
    const handoff = copyBatchNextService({
      finishedLabel: collectedServiceLabels(collectedRows),
      nextLabel,
      city: next.city || next.area,
      remainingAfter: workQueue.length,
    });
    const result = startMediumFlow(
      med,
      {
        ...session,
        medium: exact ? med : undefined,
        browseToken: browse,
        mediumType: undefined,
        city: next.city,
        area: next.area || undefined,
        placeHint: undefined,
        qty: next.qty,
        directionHint: undefined,
        pendingCityQueue: undefined,
        workQueue,
        collectedRows,
        collectedServiceIds,
        candidateServiceIds: next.candidateServiceIds,
        pendingRows: undefined,
        needsContinueConfirm: false,
        typesResolved: undefined,
        batchServiceLabels: session.batchServiceLabels,
      },
      services,
      handoff,
    );
    return withBatchStepPrompt(result, handoff);
  }
  return null;
}

function filterHitsBySessionLocation(hits: DbService[], session: ProgressiveSession): DbService[] {
  let out = hits;
  if (session.area) {
    const a = canonicalizeServiceName(session.area);
    const aRe = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    out = hits.filter((s) => {
      const label = canonicalizeServiceName(getAreaLabel(s) || '');
      const locality = canonicalizeServiceName(getLocalityFromMetaCity(s) || '');
      const metaCity = canonicalizeServiceName(getMetaCityRaw(s) || '');
      const metaArea = canonicalizeServiceName(getMetaAreaRaw(s) || '');
      // Place = city metadata OR area_name only — NEVER direction_remarks
      return label === a || locality === a || metaCity === a || metaArea === a
        || aRe.test(label) || aRe.test(locality) || aRe.test(metaCity) || aRe.test(metaArea);
    });
    if (session.city && out.length > 0) {
      const narrowed = out.filter((s) => serviceMatchesCityLabel(s, session.city!));
      if (narrowed.length > 0) out = narrowed;
    }
    return out;
  }
  if (session.city) {
    const c = session.city.toLowerCase();
    out = out.filter((s) => serviceMatchesCityLabel(s, c));
  }
  return out;
}

function bestFuzzyGuess(
  services: DbService[],
  query: string,
  city: string | null,
): { svc: DbService; score: number } | null {
  const scoped = filterByCity(services, city);
  const q = canonicalizeServiceName(query);
  if (!q || q.length < 3) return null;

  let best: { svc: DbService; score: number } | null = null;
  const seen = new Set<string>();

  for (const s of scoped) {
    const labels = [
      s.service_name || '',
      (s.service_name || '').split('·')[0],
      getMediumKey(s),
      friendlyServiceLabel(s),
    ];
    for (const label of labels) {
      const score = similarity(q, label);
      if (score < 0.72) continue;
      const id = s.service_id;
      if (seen.has(id) && best && best.svc.service_id === id) continue;
      if (!best || score > best.score) {
        best = { svc: s, score };
        seen.add(id);
      }
    }
  }
  return best && best.score < 0.98 ? best : null;
}

function buildRowsForServices(
  selected: DbService[],
  qty: number | null,
  durationText: string | null | undefined,
  originalText: string,
  qtyByServiceId?: Record<string, number>,
): { rows: ConfirmationRow[]; belowMin: Array<{ svc: DbService; requested: number; minimum: number }> } {
  const belowMin: Array<{ svc: DbService; requested: number; minimum: number }> = [];
  const rows: ConfirmationRow[] = [];

  for (const svc of selected) {
    const minQty = getMinQuantityFromDbService(svc);
    const metro =
      extractRealCityFromDbService(svc)
      || getLocalityFromMetaCity(svc)
      || extractCityFromDbService(svc)
      || '—';
    const area = getFunnelAreaLabel(svc) || getAreaLabel(svc);
    const dir = getDirectionLabel(svc);
    // Distinguish multi-area / multi-site lines (OMR · towards… vs Chetpet)
    let city = metro;
    if (area && canonicalizeServiceName(area) !== canonicalizeServiceName(metro)) {
      city = dir ? `${area} · ${dir}` : area;
    } else if (dir) {
      city = `${metro} · ${dir}`;
    }
    const perSvcQty =
      qtyByServiceId && qtyByServiceId[svc.service_id] != null
        ? qtyByServiceId[svc.service_id]
        : qty;
    let useQty: number;
    if (perSvcQty == null) {
      useQty = minQty && minQty > 1 ? minQty : 1;
    } else if (minQty && minQty > 1 && perSvcQty < minQty) {
      belowMin.push({ svc, requested: perSvcQty, minimum: minQty });
      useQty = perSvcQty; // pending until user confirms
    } else {
      useQty = perSvcQty;
    }
    rows.push({
      service: (svc.service_name || '').split('·')[0].trim() || friendlyServiceLabel(svc),
      qty: useQty,
      city,
      serviceId: svc.service_id,
    });
  }

  void durationText;
  void originalText;
  return { rows, belowMin };
}

function stripQtyCityDuration(text: string, city: string | null): string {
  let t = text;
  if (city) {
    t = t.replace(new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), ' ');
  }
  t = t.replace(/\b\d+\s*(days?|months?|weeks?)\b/gi, ' ');
  t = t.replace(/\b\d+\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export interface IntentOverlay {
  kind?: string | null;
  media?: string[] | null;
  medium?: string | null;
  city?: string | null;
  areaHint?: string | null;
  ambiguous?: boolean;
  clarifyHint?: string | null;
  qty?: number | null;
  duration?: string | null;
  shortReply?: string | null;
}

function softPickTypes(
  services: DbService[],
  session: ProgressiveSession,
  city: string | undefined,
  botText: string,
): ProgressiveTurnResult {
  const types = city
    ? mediumLabelsForCity(services, city)
    : uniqueMediumOnlyOptions(services);
  return {
    step: 'pick_type',
    botText,
    options: types,
    allowMulti: types.length > 1,
    session: { ...session, city, pendingMedia: [] },
  };
}

/** Prefer common BTL media for help examples when present in catalog. */
function pickExampleServiceLabels(services: DbService[], n = 3): string[] {
  const all = uniqueMediumLabelsWithExamples(services);
  if (!all.length) return ['Bus Semi', 'Metro Station', 'Apartment Lift'];
  const prefer = [
    'bus semi',
    'metro station',
    'apartment lift',
    'auto semi',
    'cab',
    'hoarding',
    'lamp post',
    'bus shelter',
  ];
  const picked: string[] = [];
  const used = new Set<string>();
  for (const p of prefer) {
    const hit = all.find((o) => {
      const hay = canonicalizeServiceName(`${o.label} ${o.medium || ''}`);
      return hay.includes(p) || hay.startsWith(p.split(/\s+/)[0] || p);
    });
    if (hit && !used.has(hit.id)) {
      used.add(hit.id);
      picked.push(hit.label);
      if (picked.length >= n) return picked;
    }
  }
  for (const o of all) {
    if (used.has(o.id)) continue;
    picked.push(o.label);
    if (picked.length >= n) break;
  }
  return picked;
}

function pickExamplePlaces(services: DbService[], n = 3): string[] {
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    const c = extractRealCityFromDbService(s);
    if (!c) continue;
    const key = canonicalizeServiceName(c);
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(c);
    if (cities.length >= n) return cities;
  }
  for (const loc of getCatalogLocalities(services)) {
    const key = canonicalizeServiceName(loc);
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(titleCase(loc));
    if (cities.length >= n) break;
  }
  return cities.length ? cities : ['Chennai', 'Madurai', 'Coimbatore'];
}

/**
 * Wrong / unreadable input — no wall of chips; ask again with DB examples.
 */
/**
 * True when prior turn already locked funnel fields — free text should refine, not restart.
 */
function priorHasFunnelLocks(prior?: ProgressiveSession | null): boolean {
  if (!prior) return false;
  return !!(
    prior.medium
    || prior.browseToken
    || prior.city
    || prior.area
    || prior.placeHint
    || prior.mediumType
    || prior.candidateServiceIds?.length
    || prior.workQueue?.length
    || prior.collectedRows?.length
  );
}

/**
 * Change selection: overlay only what the new message provides; keep other locks.
 */
function mergePriorWithDetected(
  prior: ProgressiveSession,
  detected: {
    originalText: string;
    qty: number | null;
    durationText: string | null;
    city: string | null;
    localityHint: string | null;
    media: string[];
    shortReply: string | null;
  },
): ProgressiveSession {
  const newMedia = detected.media[0]
    ? canonicalizeServiceName(detected.media[0])
    : null;
  const oldMedia = canonicalizeServiceName(prior.browseToken || prior.medium || '');
  const mediaChanged = !!newMedia && newMedia !== oldMedia;
  const cityChanged =
    !!detected.city
    && canonicalizeServiceName(detected.city)
      !== canonicalizeServiceName(prior.city || '');
  const areaFromText = detected.localityHint;
  const areaChanged =
    !!areaFromText
    && canonicalizeServiceName(areaFromText)
      !== canonicalizeServiceName(prior.area || prior.placeHint || '');

  return {
    ...prior,
    originalText: detected.originalText,
    qty: detected.qty ?? prior.qty,
    durationText: detected.durationText ?? prior.durationText,
    aiReply: detected.shortReply,
    city: detected.city || prior.city,
    // Service override: keep city; clear area/direction so we don't inherit another product's site
    area: mediaChanged
      ? (areaFromText || undefined)
      : (areaFromText || (cityChanged ? undefined : prior.area)),
    placeHint: mediaChanged
      ? (areaFromText || undefined)
      : (areaFromText || (cityChanged ? undefined : prior.placeHint)),
    medium: newMedia || prior.medium,
    browseToken: newMedia || prior.browseToken || prior.medium,
    mediumType: mediaChanged || cityChanged ? undefined : prior.mediumType,
    typesResolved: mediaChanged ? undefined : prior.typesResolved,
    candidateServiceIds:
      mediaChanged || cityChanged || areaChanged
        ? undefined
        : prior.candidateServiceIds,
    directionHint:
      mediaChanged || cityChanged || areaChanged
        ? undefined
        : prior.directionHint,
    // Service override: drop leftover type/site queue for the previous service
    workQueue: mediaChanged && !prior.segments?.length ? undefined : prior.workQueue,
    needsContinueConfirm:
      cityChanged || areaChanged || mediaChanged
        ? false
        : prior.needsContinueConfirm,
  };
}

function softClarifyNeed(
  services: DbService[],
  session: ProgressiveSession,
  reply?: string | null,
): ProgressiveTurnResult {
  const options = uniqueMediumOnlyOptions(services).slice(0, 24);
  return {
    step: options.length ? 'pick_type' : 'no_match',
    botText: (reply && reply.trim()) || copyUnknownService(session),
    options,
    allowMulti: options.length > 0,
    session: stampReplyMeta({ ...session, pendingMedia: [] }, ''),
  };
}

function startMediumFlow(
  medium: string,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const medKey = canonicalizeServiceName(medium);
  const browseToken = canonicalizeServiceName(session.browseToken || medium);
  const place = session.area || session.placeHint;

  // Family token ("bus") covering Bus Semi + Bus Shelter + … → ask which service first
  // Exact catalog medium ("bus semi", "apartment demo") → lock and continue funnel
  if (!isExactCatalogMedium(medKey, services)) {
    let browseHits = filterForBrowseOrFamily(services, browseToken);
    // Honor city lock / batch candidates so type chips are only what's offered there
    if (session.candidateServiceIds?.length) {
      const set = new Set(session.candidateServiceIds);
      browseHits = browseHits.filter((s) => set.has(s.service_id));
    } else if (session.city) {
      browseHits = browseHits.filter((s) => serviceMatchesCityLabel(s, session.city!));
    }
    // Place/corridor must scope BEFORE counting types — else we ask "which type?"
    // with a reply, then empty the pool → text and no chips (looks frozen).
    if (place) {
      browseHits = filterByLocality(browseHits, place);
      if (!browseHits.length) {
        return {
          step: 'no_match',
          botText: copyUnknownArea(place),
          options: [],
          session: {
            ...session,
            area: place,
            placeHint: session.placeHint || place,
            pendingMedia: [],
          },
        };
      }
    }
    const mediums = uniqueMediumOnlyOptions(browseHits);
    // Keep candidates when city/area already scoped (batch city lock)
    const clearCands = !(session.area || session.placeHint || session.city);
    if (mediums.length > 1) {
      return advanceFunnel(
        {
          ...session,
          medium: undefined,
          browseToken,
          area: place || session.area,
          placeHint: session.placeHint || place,
          needsContinueConfirm: !!(place && !session.city),
          candidateServiceIds: clearCands
            ? undefined
            : (session.candidateServiceIds?.length
              ? session.candidateServiceIds
              : browseHits.map((s) => s.service_id)),
        },
        services,
        reply || (place
          ? copyAskTypeAtPlace(browseToken, place, session)
          : session.city
            ? copyAskTypeAtPlace(browseToken, session.city, session)
            : copyAskType(browseToken, session)),
      );
    }
    if (mediums.length === 1) {
      return advanceFunnel(
        {
          ...session,
          medium: canonicalizeServiceName(mediums[0].medium || medKey),
          browseToken: canonicalizeServiceName(mediums[0].medium || browseToken),
          area: place || session.area,
          placeHint: session.placeHint || place,
          needsContinueConfirm: !!(place && !session.city),
          candidateServiceIds: clearCands
            ? undefined
            : (session.candidateServiceIds?.length
              ? session.candidateServiceIds
              : browseHits.map((s) => s.service_id)),
        },
        services,
        reply,
      );
    }
    // No hits in this city for this family
    if (session.city && !browseHits.length) {
      const avail = uniqueMediumOnlyOptions(
        filterByCity(services, session.city),
      );
      return {
        step: avail.length ? 'pick_type' : 'no_match',
        botText:
          reply && !isAskStepReplyWithoutOptions(reply)
            ? reply
            : `${copyNotOfferedInCity(browseToken, session.city, session)}`,
        options: avail,
        allowMulti: avail.length > 0,
        session: { ...session, pendingMedia: [], medium: undefined, browseToken: undefined },
      };
    }
  }

  const nextSession: ProgressiveSession = {
    ...session,
    medium: medKey,
    browseToken,
    // Keep city/batch-scoped candidates; clear only on a fresh unscoped browse
    candidateServiceIds:
      session.area || session.placeHint || session.city
        ? session.candidateServiceIds
        : undefined,
  };

  // Pull locality from text if not already on session
  if (!nextSession.city && !nextSession.area) {
    const locFromText = detectLocalityInText(session.originalText || '', services);
    if (locFromText) {
      nextSession.area = locFromText;
      nextSession.placeHint = nextSession.placeHint || locFromText;
    }
  }
  if (!nextSession.city && nextSession.area) {
    const pool = filterForBrowseOrFamily(services, browseToken);
    const atPlace = filterByLocality(pool, nextSession.area);
    if (atPlace.length > 0) {
      // Keep city unset so funnel confirms city; require Continue before quote
      return advanceFunnel(
        {
          ...nextSession,
          city: undefined,
          candidateServiceIds: atPlace.map((s) => s.service_id),
          needsContinueConfirm: true,
          pendingCityQueue: undefined,
          workQueue: undefined,
        },
        services,
        reply,
      );
    }
    return {
      step: 'no_match',
      botText: copyUnknownArea(nextSession.area!),
      options: [],
      session: nextSession,
    };
  }

  return advanceFunnel(nextSession, services, reply);
}

/**
 * True when local heuristics are enough — skip Gemini intent (faster send).
 * Keep AI for ambiguous free text / feature words (led, outdoor alone).
 */
export function canSkipChatIntentAi(userText: string, services: DbService[]): boolean {
  const t = (userText || '').trim();
  if (!t) return true;
  if (/^(hi|hello|hey|hii|hai|howdy|yo|hola)[\s!.]*$/i.test(t)) return true;
  if (/^(thanks|thank\s*you|thx|ok|okay|bye)[\s!.]*$/i.test(t)) return true;
  if (detectCatalogueBrowseQuery(t)) return true;
  if (isCityOnlyQuery(t, services)) return true;
  if (isLocalityOnlyQuery(t, services)) return true;
  if (parseServiceSegments(t, services).length >= 2) return true;
  if (detectMediaLocal(t, services).length >= 1) return true;
  return false;
}

/**
 * Resolve one user free-text turn into the next progressive step.
 */
export function resolveProgressiveText(
  userText: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  logFunnelReq('text', { text: userText, session: prior });
  const result = stampResultOpener(
    resolveProgressiveTextInner(userText, services, prior, intent),
  );
  logFunnelRes(result);
  return result;
}

function resolveProgressiveTextInner(
  userText: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  // Silent media plural/synonym + light typo fix (service words only — not cities/places)
  const originalText = softCorrectMediaWordsInText(
    normalizeSegmentPhrase(userText.trim()),
    services,
  );

  // AI greeting / help shortcuts
  if (intent?.kind === 'greeting') {
    return {
      step: 'small_talk',
      botText: intent.shortReply || copyGreeting(),
      options: [],
      session: { originalText, qty: null, aiReply: intent.shortReply },
    };
  }
  if (intent?.kind === 'help') {
    return {
      step: 'small_talk',
      botText:
        intent.shortReply
        || "Sure!\n\nTell me the advertising service or city you're looking for.",
      options: [],
      session: { originalText, qty: null, aiReply: intent.shortReply },
    };
  }

  const talk = isSmallTalk(originalText);
  if (talk) return talk;

  const qty = hasExplicitQty(originalText)
    ? (parseQtyFromText(originalText)
      ?? (intent?.qty != null ? Number(intent.qty) : null))
    : null;
  const durationText = intent?.duration ?? parseDurationFromText(originalText);

  // City only from user text (or AI when that city literally appears in the message).
  // Prevents AI inventing Thoraipakkam/etc. and collapsing the apartment city list.
  const cityFromText = detectCityInText(originalText, services);
  const cityFromAi = intent?.city ? titleCase(String(intent.city)) : null;
  const city =
    cityFromText
    || (cityFromAi
      && new RegExp(
        `\\b${cityFromAi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i',
      ).test(originalText)
      ? cityFromAi
      : null)
    || null;

  const catalogTypes = getCatalogTypeKeys(services);
  const mediaFromAi = (intent?.media || [])
    .map((m) => String(m).trim())
    .filter(Boolean);
  // Prefer AI media (already catalog-resolved by caller); else local catalog-only detect
  const mediaLocal = detectMediaLocal(originalText, services);
  let media =
    mediaFromAi.length > 0
      ? mediaFromAi
      : intent?.medium
        ? [String(intent.medium)]
        : mediaLocal;

  // Map free labels onto catalog keys when needed
  if (media.length && catalogTypes.length) {
    const resolved = resolveMediaAgainstCatalog(media, catalogTypes);
    if (resolved.length) media = resolved;
  }

  // Prefer exact full-phrase catalog medium when user typed it (apartment demo)
  if (mediaLocal.length === 1 && isExactMediaQuery(originalText, services)) {
    media = mediaLocal;
  }

  const shortReply = intent?.shortReply || null;

  // Area only from exact locality in user text — ignore invented AI areaHint
  const localityHint = detectLocalityInText(originalText, services);

  const earlySegmentsCheck = parseServiceSegments(originalText, services);
  const preservePrior =
    priorHasFunnelLocks(prior)
    && earlySegmentsCheck.length < 2;

  // Change selection: keep prior locks; free text overlays only what changed
  const baseSessionFields: ProgressiveSession = preservePrior
    ? mergePriorWithDetected(prior!, {
      originalText,
      qty,
      durationText,
      city,
      localityHint,
      media,
      shortReply,
    })
    : {
      originalText,
      qty,
      durationText,
      pendingMedia: [],
      collectedRows: [],
      collectedServiceIds: [],
      aiReply: shortReply,
    };

  // When refining mid-funnel with city/area only, restore media from prior for downstream
  if (preservePrior && media.length === 0) {
    const locked = baseSessionFields.browseToken || baseSessionFields.medium;
    if (locked) media = [locked];
  }
  if (preservePrior && !city && baseSessionFields.city) {
    // city variable used below — allow prior city to remain via baseSessionFields only
  }

  // Catalogue Q&A: "what services/cities/areas/types are available?" → chips → quote funnel
  const browseKind = detectCatalogueBrowseQuery(originalText);
  if (browseKind && earlySegmentsCheck.length < 2) {
    return startCatalogueBrowse(
      browseKind,
      {
        ...baseSessionFields,
        city: city || baseSessionFields.city,
        area: localityHint || baseSessionFields.area,
        placeHint: localityHint || baseSessionFields.placeHint,
        // Scope cities/areas/types to a named service; "what services?" lists the full menu
        medium:
          browseKind === 'services'
            ? undefined
            : (media[0]
              ? canonicalizeServiceName(media[0])
              : baseSessionFields.medium),
        browseToken:
          browseKind === 'services'
            ? undefined
            : (media[0]
              ? canonicalizeServiceName(media[0])
              : baseSessionFields.browseToken),
      },
      services,
      shortReply,
    );
  }

  // Partial service name (e.g. "bus semi") → enter funnel directly (no Did you mean)
  // Skip when "led"/feature words span multiple catalog types
  const earlyFeatureHint = detectFeatureClarifyHint(originalText, services, city);
  if (
    media.length === 0
    && earlySegmentsCheck.length < 2
    && !isCityOnlyQuery(originalText, services)
    && !isLocalityOnlyQuery(originalText, services)
    && mediaFromAi.length === 0
    && !earlyFeatureHint
    && !preservePrior
  ) {
    const svcSug = suggestPartialService(originalText, services);
    if (svcSug) {
      return startMediumFlow(
        svcSug,
        {
          ...baseSessionFields,
          medium: canonicalizeServiceName(svcSug),
          browseToken: canonicalizeServiceName(svcSug),
        },
        services,
        shortReply,
      );
    }
  }

  // City + Area (no service) → ask Service → Type → Direction
  if (
    city
    && localityHint
    && canonicalizeServiceName(city) !== canonicalizeServiceName(localityHint)
    && media.length === 0
  ) {
    return advanceFunnel(
      {
        ...baseSessionFields,
        city,
        area: localityHint,
        placeHint: localityHint,
      },
      services,
      shortReply || `Sure!\n\nWhich advertising service do you need in ${city} · ${localityHint}?`,
    );
  }

  // Site / direction first (e.g. "Gemini Flyover") → Service → Type → City → Area
  const cityOnlyEarly = isCityOnlyQuery(originalText, services);
  const localityOnlyEarly = isLocalityOnlyQuery(originalText, services);
  if (media.length === 0 && !cityOnlyEarly && !localityOnlyEarly) {
    const directionHit = detectDirectionInText(originalText, services);
    if (directionHit) {
      const textKey = canonicalizeServiceName(originalText);
      const isPureArea =
        !!localityHint && textKey === canonicalizeServiceName(localityHint);
      const isPureCity = !!city && textKey === canonicalizeServiceName(city);
      if (!isPureArea && !isPureCity) {
        const dirServices = services.filter((s) =>
          directionHit.serviceIds.includes(s.service_id),
        );
        const mediums = uniqueMediumOnlyOptions(dirServices);
        const onlyMedium =
          mediums.length === 1 ? mediums[0].medium : undefined;
        const place =
          localityHint
          || directionHit.area
          || undefined;
        return advanceFunnel(
          {
            ...baseSessionFields,
            directionHint: directionHit.phrase,
            medium: onlyMedium ? canonicalizeServiceName(onlyMedium) : undefined,
            browseToken: onlyMedium
              ? canonicalizeServiceName(onlyMedium)
              : undefined,
            city: city || directionHit.city,
            area: place,
            placeHint: place,
            candidateServiceIds: directionHit.serviceIds,
            needsContinueConfirm: true,
          },
          services,
          shortReply
            || (onlyMedium
              ? undefined
              : `We found sites matching “${titleCase(originalText.trim())}”.\n\nWhich service would you like?`),
        );
      }
    }
  }

  // Locality-only ("saidapet") → ask which service type there (before medium/feature flows)
  // If user already locked a service mid-funnel, refine place — do not restart
  const earlyLocality = localityOnlyEarly;
  if (earlyLocality) {
    const lockedMed = baseSessionFields.medium || baseSessionFields.browseToken;
    if (preservePrior && lockedMed) {
      return startMediumFlow(
        lockedMed,
        {
          ...baseSessionFields,
          area: earlyLocality,
          placeHint: earlyLocality,
          city: baseSessionFields.city,
          candidateServiceIds: undefined,
        },
        services,
        shortReply,
      );
    }
    return startPlaceTypeBrowse(
      earlyLocality,
      false,
      baseSessionFields,
      services,
      shortReply,
    );
  }

  // Multi-service "X and Y and Z" → batch multi-select (before clarify / single-medium flows)
  const earlySegments = parseServiceSegments(originalText, services);
  if (earlySegments.length >= 2) {
    const placeHint = extractBatchPlaceHint(originalText, services) || undefined;
    return startBatchMultiSelect(
      earlySegments,
      {
        ...baseSessionFields,
        city: city || undefined,
        placeHint,
        area: placeHint,
        qty: null,
      },
      services,
      null,
    );
  }

  const featureHint =
    (intent?.kind === 'clarify_type' || intent?.ambiguous
      ? (intent?.clarifyHint || detectFeatureClarifyHint(originalText, services, city))
      : null)
    || detectFeatureClarifyHint(originalText, services, city);

  // Ambiguous place (bus stand) / feature (led) → ask type chips, do not collapse to one medium
  if (featureHint && mediaFromAi.length < 2) {
    const hint = intent?.clarifyHint || featureHint;
    const types = typesForClarify(services, city, hint === 'that' ? null : hint);
    if (types.length > 1) {
      return {
        step: 'pick_type',
        botText:
          shortReply
          || (hint === 'that'
            ? 'Sure!\n\nWhich advertising option do you need?'
            : `Sure!\n\nWhich ${salesAdLabel(hint)}${city ? ` in ${city}` : ''} option do you need?`),
        options: types,
        allowMulti: true,
        session: {
          originalText,
          city: city || undefined,
          qty,
          durationText,
          pendingMedia: [],
          aiReply: shortReply,
        },
      };
    }
    // Single browse hit for feature → start that medium
    const browseHits =
      hint && hint !== 'that' ? filterByBrowseToken(services, hint) : [];
    if (browseHits.length > 0 && !isAmbiguousPlaceQuery(originalText)) {
      const mediums = uniqueMediumOnlyOptions(browseHits);
      if (mediums.length === 1) {
        return startMediumFlow(
          mediums[0].medium || hint,
          {
            originalText,
            medium: canonicalizeServiceName(mediums[0].medium || hint),
            browseToken: canonicalizeServiceName(mediums[0].medium || hint),
            city: city || undefined,
            qty,
            durationText,
            pendingMedia: [],
            collectedRows: [],
            collectedServiceIds: [],
            aiReply: shortReply,
          },
          services,
          shortReply,
        );
      }
      if (mediums.length > 1) {
        return {
          step: 'pick_type',
          botText: shortReply || copyAskType(hint),
          options: mediums,
          allowMulti: true,
          session: {
            originalText,
            browseToken: canonicalizeServiceName(hint),
            city: city || undefined,
            qty,
            durationText,
            pendingMedia: [],
            aiReply: shortReply,
          },
        };
      }
    }
    return {
      step: 'pick_type',
      botText:
        shortReply
        || (hint === 'that'
          ? 'Sure!\n\nWhich advertising option do you need?'
          : copyAskType(hint)),
      options: types.length ? types : uniqueMediumOnlyOptions(services),
      allowMulti: true,
      session: {
        originalText,
        city: city || undefined,
        qty,
        durationText,
        pendingMedia: [],
        aiReply: shortReply,
      },
    };
  }

  // AI city browse, metro-only, or locality-only → list DB types at that place
  const cityOnly = isCityOnlyQuery(originalText, services);
  const localityOnly = isLocalityOnlyQuery(originalText, services);
  // City named + no media (even if AI kind=quote) → browse services in that city
  const cityBrowseFallback =
    !cityOnly
    && !localityOnly
    && !!city
    && media.length === 0
    && detectMediaLocal(originalText, services).length === 0;
  const lockedMedForCity =
    preservePrior
      ? (baseSessionFields.medium || baseSessionFields.browseToken)
      : null;
  if (
    (intent?.kind === 'city_browse' || cityOnly || localityOnly || cityBrowseFallback)
    && !lockedMedForCity
  ) {
    if (localityOnly) {
      return startPlaceTypeBrowse(
        localityOnly,
        false,
        {
          originalText,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          aiReply: shortReply,
        },
        services,
        shortReply,
      );
    }
    const browseCity = cityOnly || city;
    if (browseCity) {
      // Known metros (Madurai/Chennai…) → city filter; locality-as-city (Hosur/Padur) → area filter
      const isKnownMetro = REAL_CITY_KEYS.includes(browseCity.toLowerCase());
      return startPlaceTypeBrowse(
        browseCity,
        isKnownMetro,
        {
          originalText,
          city: isKnownMetro ? browseCity : undefined,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          aiReply: shortReply,
        },
        services,
        shortReply,
      );
    }
  }

  // Mid-funnel city/area change with service already locked → continue funnel
  if (lockedMedForCity && (cityOnly || localityOnly || city || localityHint)) {
    const nextCity = cityOnly || city || baseSessionFields.city;
    const nextArea = localityOnly || localityHint || undefined;
    return startMediumFlow(
      lockedMedForCity,
      {
        ...baseSessionFields,
        medium: baseSessionFields.medium || canonicalizeServiceName(lockedMedForCity),
        browseToken: baseSessionFields.browseToken || canonicalizeServiceName(lockedMedForCity),
        city: nextCity || undefined,
        area: nextArea,
        placeHint: nextArea || baseSessionFields.placeHint,
        candidateServiceIds: undefined,
        mediumType: undefined,
        typesResolved: undefined,
      },
      services,
      shortReply,
    );
  }

  const stripped = stripQtyCityDuration(originalText, city);
  let words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  if (intent?.areaHint) {
    const aWords = extractQueryWords(String(intent.areaHint));
    if (aWords.length) words = [...new Set([...words, ...aWords])];
  }

  if (words.length === 0 && !city && media.length === 0) {
    return {
      step: 'small_talk',
      botText: shortReply || copyWhichService(),
      options: [],
      session: { originalText, qty: null },
    };
  }

  const sessionBase: ProgressiveSession = preservePrior
    ? {
      ...baseSessionFields,
      medium: media[0]
        ? canonicalizeServiceName(media[0])
        : baseSessionFields.medium,
      browseToken: media[0]
        ? canonicalizeServiceName(media[0])
        : baseSessionFields.browseToken,
      city: city || baseSessionFields.city,
      qty: qty ?? baseSessionFields.qty,
      durationText: durationText ?? baseSessionFields.durationText,
      pendingMedia: media.length > 1 ? media.slice(1) : [],
      aiReply: shortReply,
    }
    : {
      originalText,
      medium: media[0] ? canonicalizeServiceName(media[0]) : undefined,
      browseToken: media[0] ? canonicalizeServiceName(media[0]) : undefined,
      city: city || undefined,
      qty,
      durationText,
      pendingMedia: media.length > 1 ? media.slice(1) : media.length === 1 ? [] : [],
      collectedRows: [],
      collectedServiceIds: [],
      aiReply: shortReply,
    };

  if (!services.length) {
    return {
      step: 'no_match',
      botText: 'No rate cards are loaded yet.\n\nPlease upload proposals first.',
      options: [],
      session: sessionBase,
    };
  }

  // Multi-service list ("50 bus and 10 shelter and …") → one multi-select chip list
  const segments = parseServiceSegments(originalText, services);
  if (segments.length >= 2) {
    return startBatchMultiSelect(segments, sessionBase, services, null);
  }

  // AI returned multiple media without "and"-parsed segments → same batch UI
  if (media.length >= 2) {
    const fromMedia: BatchSegment[] = media.map((m) => ({
      raw: m,
      token: canonicalizeServiceName(m),
      qty,
      city,
    }));
    return startBatchMultiSelect(fromMedia, sessionBase, services, null);
  }

  // Single media → resolve locality in same text (apartment in adyar) inside startMediumFlow
  if (media.length === 1) {
    const first = media[0];
    const locInText = detectLocalityInText(originalText, services);
    // If detectCityInText mis-tagged a locality, clear it (metros-only now, belt-and-suspenders)
    const cityForSession =
      city
      && locInText
      && canonicalizeServiceName(city) === canonicalizeServiceName(locInText)
        ? null
        : city;
    // Locality-only message that is NOT also a catalog medium → place type browse
    const mediaInText = detectMediaLocal(
      stripQtyCityDuration(originalText, cityForSession),
      services,
    );
    if (locInText && mediaInText.length === 0) {
      return startPlaceTypeBrowse(locInText, false, {
        ...sessionBase,
        city: undefined,
      }, services, shortReply);
    }
    return startMediumFlow(
      first,
      {
        ...sessionBase,
        pendingMedia: [],
        medium: canonicalizeServiceName(first),
        browseToken: canonicalizeServiceName(first),
        // Keep prior city when this message didn't name a city (service override)
        city: cityForSession || sessionBase.city || undefined,
        // Pass locality when user typed it with the medium (DB may store it as city)
        area: locInText || sessionBase.area,
        placeHint: locInText || undefined,
        needsContinueConfirm: !!locInText,
        workQueue: undefined,
        pendingCityQueue: undefined,
      },
      services,
      shortReply,
    );
  }

  // Single word that is a locality → types at that place (not "city for Saidapet")
  if (words.length === 1) {
    const token = words[0];
    const asLocality = detectLocalityInText(token, services);
    if (asLocality) {
      return startPlaceTypeBrowse(asLocality, false, sessionBase, services, shortReply);
    }
    if (filterByBrowseToken(services, token).length > 0) {
      return startMediumFlow(
        token,
        {
          ...sessionBase,
          medium: canonicalizeServiceName(token),
          browseToken: canonicalizeServiceName(token),
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }
  }

  // If first word is a catalog family, use medium flow
  if (words.length >= 1) {
    const familyTry = detectMediaLocal(words.join(' '), services);
    if (familyTry.length >= 2) {
      return startBatchMultiSelect(
        familyTry.map((m) => ({
          raw: m,
          token: m,
          qty,
          city,
        })),
        sessionBase,
        services,
        shortReply,
      );
    }
    if (familyTry.length === 1) {
      return startMediumFlow(
        familyTry[0],
        {
          ...sessionBase,
          medium: familyTry[0],
          browseToken: familyTry[0],
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }
  }

  // Fallback: word match against catalog
  const mediumHint = words[0] || prior?.medium;
  const matched = matchServices(
    services,
    words.length ? words : mediumHint ? [mediumHint] : [],
    city,
  );

  if (matched.length === 0) {
    const guess = bestFuzzyGuess(services, stripped || originalText, city);
    if (guess && guess.score >= 0.72) {
      const label = friendlyServiceLabel(guess.svc);
      return {
        step: 'did_you_mean',
        botText: shortReply || `Just to confirm — did you mean ${label}?`,
        options: [
          {
            id: 'yes',
            label: 'Yes',
            serviceId: guess.svc.service_id,
            city: extractRealCityFromDbService(guess.svc) || undefined,
            imageUrl: getChipImageUrl(guess.svc),
          },
          { id: 'no', label: 'No' },
        ],
        session: {
          ...sessionBase,
          bestGuessServiceId: guess.svc.service_id,
          bestGuessLabel: label,
          medium: getMediumKey(guess.svc),
        },
      };
    }

    // City known but no media words matched → show services in that city (never dead-end)
    if (city && detectMediaLocal(originalText, services).length === 0) {
      const isKnownMetro = REAL_CITY_KEYS.includes(city.toLowerCase());
      return startPlaceTypeBrowse(
        city,
        isKnownMetro,
        {
          ...sessionBase,
          city: isKnownMetro ? city : undefined,
          area: isKnownMetro ? sessionBase.area : city,
          placeHint: isKnownMetro ? sessionBase.placeHint : city,
        },
        services,
        shortReply || copyPlaceServices(city),
      );
    }

    return softClarifyNeed(
      services,
      sessionBase,
      shortReply
        || (city ? copyUnknownCity(city) : undefined),
    );
  }

  if (matched.length === 1) {
    return finalizeSelection([matched[0]], sessionBase, services);
  }

  const mediums = new Set(matched.map(getMediumKey).map(canonicalizeServiceName));
  if (!city && mediums.size === 1) {
    const medium = getMediumKey(matched[0]);
    return startMediumFlow(medium, { ...sessionBase, medium }, services, shortReply);
  }

  if (city) {
    const medium =
      (getMediumKey(matched[0]) || '').split(/\s+/)[0]
      || words[0]
      || sessionBase.medium
      || '';
    return startMediumFlow(
      medium,
      { ...sessionBase, medium },
      services,
      shortReply,
    );
  }

  return softClarifyNeed(services, sessionBase, shortReply);
}

function minQtyConfirmBotText(
  details: Array<{ service: string; requested: number; minimum: number }>,
  stillBelow = false,
): string {
  const tip = 'Or tap the pencil to edit the qty yourself.';
  if (details.length === 1) {
    const d = details[0];
    if (stillBelow) {
      return (
        `That's still below the minimum for ${d.service} `
        + `(minimum ${d.minimum.toLocaleString()}, you entered ${d.requested.toLocaleString()}).\n\n`
        + `Shall we use ${d.minimum.toLocaleString()}, or edit again?`
      );
    }
    return (
      `You asked for ${d.requested.toLocaleString()} on ${d.service}, `
      + `but the minimum is ${d.minimum.toLocaleString()}.\n\n`
      + `Shall we use the minimum so I can continue? ${tip}`
    );
  }
  if (stillBelow) {
    return `Some quantities are still below minimums.\n\nShall we use the minimums, or edit again?`;
  }
  const names = details
    .slice(0, 3)
    .map((d) => d.service)
    .join(', ');
  const extra = details.length > 3 ? ` +${details.length - 3} more` : '';
  return (
    `A few lines are below minimums (${names}${extra}).\n\n`
    + `Shall we use the minimums so I can finish your quote? ${tip}`
  );
}

function minQtyConfirmOptions(): ProgressiveOption[] {
  return [
    { id: 'yes_min', label: 'Yes, use minimums' },
    { id: 'no_min', label: "No, I'll adjust" },
  ];
}

/**
 * Apply pencil-edited qtys on a min-qty card.
 * Still below min → same-card re-ask. All OK → quote_ready with edited qtys.
 */
export function resolveMinQtyEdits(
  session: ProgressiveSession,
  edits: Record<string, number>,
  currentDetails: Array<{ service: string; requested: number; minimum: number; serviceId?: string }>,
): ProgressiveTurnResult {
  const pending = [...(session.pendingRows || [])];
  const stillBelow: Array<{ service: string; requested: number; minimum: number; serviceId?: string }> = [];

  for (const d of currentDetails) {
    const key = d.serviceId || d.service;
    const edited = edits[key];
    const requested = edited != null && Number.isFinite(edited) && edited > 0
      ? Math.floor(edited)
      : d.requested;

    if (requested < d.minimum) {
      stillBelow.push({
        service: d.service,
        requested,
        minimum: d.minimum,
        serviceId: d.serviceId,
      });
      continue;
    }

    // Valid qty (≥ min) — write onto matching pending row
    const idx = pending.findIndex((r) =>
      (d.serviceId && r.serviceId === d.serviceId)
      || (!d.serviceId && r.service === d.service),
    );
    if (idx >= 0) {
      pending[idx] = { ...pending[idx], qty: requested };
    }
  }

  if (stillBelow.length > 0) {
    return {
      step: 'min_qty_confirm',
      botText: minQtyConfirmBotText(stillBelow, true),
      belowMinDetails: stillBelow,
      options: minQtyConfirmOptions(),
      session: {
        ...session,
        pendingRows: pending,
        collectedRows: pending,
      },
    };
  }

  return {
    step: 'quote_ready',
    botText: copyQuoteReady(),
    options: [],
    session: {
      ...session,
      pendingRows: pending,
      collectedRows: pending,
      pendingMedia: [],
      segments: undefined,
    },
    quoteRows: pending,
  };
}

function finalizeSelection(
  selected: DbService[],
  session: ProgressiveSession,
  services?: DbService[],
): ProgressiveTurnResult {
  const { rows, belowMin } = buildRowsForServices(
    selected,
    session.qty,
    session.durationText,
    session.originalText,
    session.qtyByServiceId,
  );

  const collectedRows = [...(session.collectedRows || []), ...rows];
  const collectedServiceIds = [
    ...(session.collectedServiceIds || []),
    ...selected.map((s) => s.service_id),
  ];

  // Place-locked (OMR / locality): one site Confirm → quote.
  // Same-medium type leftovers on workQueue (Frontlit → Nonlit): never "Next up: Hoarding".
  const isMultiServiceBatch = !!(session.segments && session.segments.length >= 2);
  const currentMedEarly = canonicalizeServiceName(
    session.medium || getMediumKey(selected[0]) || '',
  );
  const placeLockedQuote =
    !!(session.placeHint || session.area) && !isMultiServiceBatch;
  const sameMediumTypeQueue =
    !isMultiServiceBatch
    && !!(session.workQueue?.length)
    && !!currentMedEarly
    && session.workQueue.every(
      (w) => canonicalizeServiceName(w.medium) === currentMedEarly,
    );

  // Sequential multi-city / true multi-service queue — continue before quote
  if (services && !placeLockedQuote && !sameMediumTypeQueue) {
    const pending = continuePendingWork(
      { ...session, pendingRows: undefined },
      collectedRows,
      collectedServiceIds,
      services,
    );
    if (pending) return pending;
  }

  // Batch multi-select already finished — never sequential "Next — pick"
  const isBatch = isMultiServiceBatch;

  const currentMed = currentMedEarly;
  const restMedia = isBatch
    ? []
    : (session.pendingMedia || []).filter(
        (m) => canonicalizeServiceName(m) !== currentMed,
      );

  // More media types left (legacy single-path multi only)
  if (restMedia.length > 0 && services) {
    return startMediumFlow(
      restMedia[0],
      {
        ...session,
        pendingMedia: restMedia.slice(1),
        collectedRows,
        collectedServiceIds,
        medium: canonicalizeServiceName(restMedia[0]),
        browseToken: canonicalizeServiceName(restMedia[0]),
        area: undefined,
        candidateServiceIds: undefined,
        pendingRows: undefined,
      },
      services,
      `Next — ${titleCase(restMedia[0])}${session.city ? ` in ${session.city}` : ''}.`,
    );
  }

  // Ask min-qty when user typed qty and any collected row is below DB minimum
  const anyExplicitQty =
    session.qty != null
    || Object.keys(session.qtyByServiceId || {}).length > 0;
  if (anyExplicitQty && restMedia.length === 0 && services) {
    const mergedRows = [...(session.collectedRows || []), ...rows];
    // Dedupe by serviceId keeping last
    const byId = new Map<string, ConfirmationRow>();
    for (const r of mergedRows) {
      if (r.serviceId) byId.set(r.serviceId, r);
      else byId.set(`${r.service}|${r.city}|${r.qty}`, r);
    }
    const allRows = [...byId.values()];
    const belowAll: Array<{ service: string; requested: number; minimum: number; serviceId?: string }> = [];
    const fixedRows = allRows.map((r) => {
      if (!r.serviceId) return r;
      const svc = services.find((s) => s.service_id === r.serviceId);
      if (!svc) return r;
      const minQty = getMinQuantityFromDbService(svc);
      const requested = typeof r.qty === 'number' ? r.qty : parseInt(String(r.qty), 10) || 0;
      const hasExplicit =
        session.qtyByServiceId?.[r.serviceId] != null
        || session.qty != null;
      if (hasExplicit && minQty && minQty > 1 && requested < minQty) {
        belowAll.push({
          service: (svc.service_name || '').split('·')[0].trim() || friendlyServiceLabel(svc),
          requested,
          minimum: minQty,
          serviceId: r.serviceId,
        });
        return { ...r, qty: minQty };
      }
      return r;
    });

    if (belowAll.length > 0) {
      return {
        step: 'min_qty_confirm',
        botText: minQtyConfirmBotText(belowAll),
        belowMinDetails: belowAll.map((b) => ({
          service: b.service,
          requested: b.requested,
          minimum: b.minimum,
          serviceId: b.serviceId,
        })),
        options: minQtyConfirmOptions(),
        session: {
          ...session,
          pendingRows: fixedRows,
          collectedRows: fixedRows,
          collectedServiceIds,
          candidateServiceIds: selected.map((s) => s.service_id),
        },
      };
    }

    return {
      step: 'quote_ready',
      botText: copyQuoteReady(),
      options: [],
      session: {
        ...session,
        pendingRows: allRows,
        collectedRows: allRows,
        collectedServiceIds,
        pendingMedia: [],
        segments: undefined,
      },
      quoteRows: allRows,
    };
  }

  if (anyExplicitQty && belowMin.length > 0 && restMedia.length === 0) {
    const fixedBatch = rows.map((r) => {
      const hit = belowMin.find((b) => b.svc.service_id === r.serviceId);
      return hit ? { ...r, qty: hit.minimum } : r;
    });
    const pendingRows = [
      ...(session.collectedRows || []),
      ...fixedBatch,
    ];
    const svcName = (svc: DbService) =>
      ((svc.service_name || '').split('·')[0] || friendlyServiceLabel(svc)).trim();
    return {
      step: 'min_qty_confirm',
      botText: minQtyConfirmBotText(
        belowMin.map((b) => ({
          service: svcName(b.svc),
          requested: b.requested,
          minimum: b.minimum,
        })),
      ),
      belowMinDetails: belowMin.map((b) => ({
        service: svcName(b.svc),
        requested: b.requested,
        minimum: b.minimum,
        serviceId: b.svc.service_id,
      })),
      options: minQtyConfirmOptions(),
      session: {
        ...session,
        pendingRows,
        collectedRows: pendingRows,
        collectedServiceIds,
        candidateServiceIds: selected.map((s) => s.service_id),
      },
    };
  }

  return {
    step: 'quote_ready',
    botText: copyQuoteReady(),
    options: [],
    session: {
      ...session,
      pendingRows: collectedRows,
      collectedRows,
      collectedServiceIds,
      pendingMedia: [],
      segments: undefined,
    },
    quoteRows: collectedRows,
  };
}

/**
 * Continue after chip / Yes-No selection.
 */
export function continueProgressiveAction(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  logFunnelReq('action', {
    action: actionId,
    selected: selectedIds,
    session,
  });
  const result = stampResultOpener(
    continueProgressiveActionInner(
      actionId,
      session,
      services,
      selectedIds,
    ),
  );
  logFunnelRes(result);
  return result;
}

function continueProgressiveActionInner(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  // Did you mean
  if (actionId === 'yes' && session.bestGuessKind === 'place' && session.bestGuessLabel) {
    const place = session.bestGuessLabel;
    // Batch list was stashed with a trailing place hint
    if (session.segments && session.segments.length >= 2) {
      return startBatchMultiSelect(
        session.segments,
        {
          ...session,
          placeHint: place,
          area: place,
          bestGuessKind: undefined,
          bestGuessLabel: undefined,
          pendingMedia: [],
        },
        services,
      );
    }
    return startPlaceTypeBrowse(
      place,
      false,
      {
        ...session,
        placeHint: place,
        area: place,
        bestGuessKind: undefined,
        bestGuessLabel: undefined,
      },
      services,
    );
  }
  if (actionId === 'yes' && session.bestGuessKind === 'service' && (session.bestGuessLabel || session.medium)) {
    const medium = session.bestGuessLabel || session.medium || '';
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(medium),
        browseToken: canonicalizeServiceName(medium),
        bestGuessKind: undefined,
        bestGuessLabel: undefined,
        bestGuessServiceId: undefined,
        // Full catalog for this service — never skip city when DB has many
        candidateServiceIds: undefined,
        city: undefined,
        area: session.placeHint || undefined,
        mediumType: undefined,
      },
      services,
    );
  }
  if (actionId === 'yes' && session.bestGuessServiceId) {
    const svc = services.find((s) => s.service_id === session.bestGuessServiceId);
    if (svc) {
      return advanceFunnel(
        {
          ...session,
          medium: getMediumKey(svc),
          browseToken: getMediumKey(svc),
          bestGuessServiceId: undefined,
          candidateServiceIds: undefined,
          city: undefined,
          area: session.placeHint || undefined,
          mediumType: undefined,
        },
        services,
      );
    }
  }
  if (actionId === 'no') {
    return softClarifyNeed(services, {
      ...session,
      bestGuessKind: undefined,
      bestGuessLabel: undefined,
      bestGuessServiceId: undefined,
    });
  }

  if (actionId === 'show_others') {
    return softClarifyNeed(
      services,
      session,
      'What advertising service are you looking for?',
    );
  }

  if (actionId === 'try_again') {
    return softClarifyNeed(services, session, copyWhichService());
  }

  if (actionId === 'yes_min' && session.pendingRows?.length) {
    return {
      step: 'quote_ready',
      botText: copyQuoteReady(),
      options: [],
      session,
      quoteRows: session.pendingRows,
    };
  }

  if (actionId === 'no_min') {
    const minQty = session.pendingRows?.[0]?.qty;
    return {
      step: 'no_match',
      botText: `Please enter a quantity of ${minQty || 'the minimum'} or more to continue.`,
      options: [],
      session: { ...session, pendingRows: undefined },
    };
  }

  // One-city confirm: continue Area → Direction → Quote
  if (actionId === 'yes_generate') {
    return advanceFunnel(
      {
        ...session,
        city: session.city || session.bestGuessLabel,
        needsContinueConfirm: false, // User confirmed — allow finalize
      },
      services,
    );
  }

  if (actionId === 'no_generate') {
    return softClarifyNeed(
      services,
      { ...session, city: undefined, needsContinueConfirm: false },
      'Sure!\n\nWhich city or advertising service do you need?',
    );
  }

  // Combined City · Area / locality place pick — supports multi Confirm
  if (
    actionId.startsWith('place:')
    || (selectedIds?.length && selectedIds.every((id) => id.startsWith('place:') || id.startsWith('area:') || id.startsWith('city:')))
  ) {
    const ids = (selectedIds?.length ? selectedIds : [actionId]).filter((id) =>
      id.startsWith('place:') || id.startsWith('area:') || id.startsWith('city:'),
    );
    const token = session.browseToken || session.medium || '';
    const pool = filterForBrowseOrFamily(services, token);
    let allHits: DbService[] = [];
    let lastSession = session;

    for (const id of ids) {
      if (id.startsWith('city:')) {
        const city = titleCase(id.slice(5));
        const nextSession: ProgressiveSession = { ...session, city, area: undefined, browseToken: token, medium: session.medium || token };
        const cityHits = filterHitsBySessionLocation(pool, nextSession);
        // If only city and many have direction → keep accumulating; else accumulate
        for (const h of cityHits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      if (id.startsWith('area:')) {
        const areaKey = id.slice(5);
        const areaPool = session.city
          ? areasForMediumCity(services, token, session.city)
          : pool;
        const areaLabel =
          areaPool
            .map((s) => getFunnelAreaLabel(s) || getAreaLabel(s) || getLocalityFromMetaCity(s))
            .find((a) => a && canonicalizeServiceName(a) === areaKey)
          || titleCase(areaKey.replace(/-/g, ' '));
        const nextSession: ProgressiveSession = {
          ...session,
          area: areaLabel,
          browseToken: token,
          medium: session.medium || token,
        };
        const hits = filterHitsBySessionLocation(areaPool.length ? areaPool : pool, nextSession);
        for (const h of hits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      // place:
      const payload = id.slice(6);
      const pipe = payload.indexOf('|');
      const cityKey = pipe >= 0 ? payload.slice(0, pipe) : payload;
      const areaKey = pipe >= 0 ? payload.slice(pipe + 1) : '';
      const isLocality = cityKey === 'locality';
      const areaLabel =
        pool
          .map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s))
          .find((a) => a && canonicalizeServiceName(a) === areaKey)
        || titleCase(areaKey.replace(/-/g, ' '));
      let city: string | undefined;
      if (isLocality) {
        const localityHits = pool.filter((s) => {
          const loc = getLocalityFromMetaCity(s) || getAreaLabel(s);
          return loc && canonicalizeServiceName(loc) === areaKey;
        });
        city = (localityHits.length > 0 ? extractRealCityFromDbService(localityHits[0]) : null) || undefined;
        // Prefer matching by locality for hits
        const locHits = filterByLocality(pool, areaLabel);
        for (const h of locHits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
      } else {
        city = titleCase(cityKey);
        const nextSession: ProgressiveSession = {
          ...session,
          city,
          area: areaLabel,
          browseToken: token || session.browseToken,
          medium: session.medium || token,
        };
        const hits = filterHitsBySessionLocation(pool, nextSession);
        for (const h of hits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      lastSession = {
        ...session,
        city,
        area: areaLabel,
        browseToken: token || session.browseToken,
        medium: session.medium || token,
      };
    }

    // Single city chip → continue funnel (Type → Area → Direction)
    if (ids.length === 1 && ids[0].startsWith('city:')) {
      const city = titleCase(ids[0].slice(5));
      const nextSession: ProgressiveSession = {
        ...session,
        city,
        area: undefined,
        placeHint: undefined,
        needsContinueConfirm: false,
        candidateServiceIds: undefined,
        pendingCityQueue: undefined,
      };
      if (token) {
        return advanceFunnel({
          ...nextSession,
          browseToken: token,
          medium: session.medium || token,
        }, services);
      }
      return advanceFunnel(
        nextSession,
        services,
        copyPlaceServices(city),
      );
    }

    // Multi-city / multi-area Confirm → ONE quote with a line per selection (RULE 5)
    if (ids.length > 1) {
      const uniqueCities: string[] = [];
      const uniqueAreas: string[] = [];
      const seenCity = new Set<string>();
      const seenArea = new Set<string>();
      for (const id of ids) {
        let cityLabel = '';
        if (id.startsWith('city:')) {
          cityLabel = titleCase(id.slice(5));
        } else if (id.startsWith('area:')) {
          const areaKey = id.slice(5);
          const areaPool = session.city
            ? areasForMediumCity(services, token, session.city)
            : pool;
          const areaLabel =
            areaPool
              .map((s) => getFunnelAreaLabel(s) || getAreaLabel(s) || getLocalityFromMetaCity(s))
              .find((a) => a && canonicalizeServiceName(a) === areaKey)
            || titleCase(areaKey.replace(/-/g, ' '));
          const ak = canonicalizeServiceName(areaLabel);
          if (areaLabel && !seenArea.has(ak)) {
            seenArea.add(ak);
            uniqueAreas.push(areaLabel);
          }
          continue;
        } else if (id.startsWith('place:')) {
          const payload = id.slice(6);
          const pipe = payload.indexOf('|');
          const cityKey = pipe >= 0 ? payload.slice(0, pipe) : payload;
          const areaKey = pipe >= 0 ? payload.slice(pipe + 1) : '';
          if (cityKey === 'locality' && areaKey) {
            const areaLabel =
              pool
                .map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s))
                .find((a) => a && canonicalizeServiceName(a) === areaKey)
              || titleCase(areaKey.replace(/-/g, ' '));
            const ak = canonicalizeServiceName(areaLabel);
            if (areaLabel && !seenArea.has(ak)) {
              seenArea.add(ak);
              uniqueAreas.push(areaLabel);
            }
            continue;
          }
          if (cityKey === 'locality') continue;
          cityLabel = titleCase(cityKey);
        }
        const key = cityLabel.toLowerCase();
        if (cityLabel && !seenCity.has(key)) {
          seenCity.add(key);
          uniqueCities.push(cityLabel);
        }
      }

      const medium = canonicalizeServiceName(
        session.medium || token || getMediumKey(allHits[0]) || '',
      );
      type WorkItem = {
        medium: string;
        browseToken?: string;
        qty: number | null;
        city?: string;
        area?: string;
        candidateServiceIds?: string[];
      };

      // Multi-area (same city) → site checkboxes (Area · direction), then quote
      if (uniqueAreas.length > 0 && uniqueCities.length === 0) {
        const readyReps: DbService[] = [];
        const seenRep = new Set<string>();
        const candPool = session.candidateServiceIds?.length
          ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
          : [];
        // Same pool Area chips use (medium + city), then optional candidate intersect
        let basePool = session.city && (token || medium)
          ? areasForMediumCity(services, token || medium, session.city)
          : token || medium
            ? filterForBrowseOrFamily(services, token || medium)
            : services;
        if (session.mediumType) {
          const mt = canonicalizeServiceName(session.mediumType);
          const typed = basePool.filter((s) => {
            const got = getMediumTypeFromDb(s);
            return !!got && canonicalizeServiceName(got) === mt;
          });
          if (typed.length) basePool = typed;
        }
        if (candPool.length) {
          const candSet = new Set(session.candidateServiceIds);
          const narrowed = basePool.filter((s) => candSet.has(s.service_id));
          if (narrowed.length) basePool = narrowed;
        }
        if (!basePool.length && candPool.length) basePool = candPool;

        for (const areaLabel of uniqueAreas) {
          const areaKey = canonicalizeServiceName(areaLabel);
          let hits = filterHitsBySessionLocation(basePool, {
            ...session,
            area: areaLabel,
            city: session.city,
          });
          if (!hits.length) {
            hits = basePool.filter((s) => {
              const labels = [
                getFunnelAreaLabel(s),
                getAreaLabel(s),
                getLocalityFromMetaCity(s),
                getMetaAreaRaw(s),
              ];
              return labels.some(
                (lab) => lab && canonicalizeServiceName(lab) === areaKey,
              );
            });
          }
          if (!hits.length) {
            hits = basePool.filter((s) => {
              const metaArea = canonicalizeServiceName(getMetaAreaRaw(s) || '');
              const label = canonicalizeServiceName(
                getFunnelAreaLabel(s) || getAreaLabel(s) || '',
              );
              return (
                (metaArea && (metaArea.includes(areaKey) || areaKey.includes(metaArea)))
                || (label && (label.includes(areaKey) || areaKey.includes(label)))
              );
            });
          }
          if (!hits.length) continue;

          for (const rep of hits) {
            if (!seenRep.has(rep.service_id)) {
              seenRep.add(rep.service_id);
              readyReps.push(rep);
            }
          }
        }

        if (readyReps.length === 0) {
          return {
            step: 'no_match',
            botText: copyUnknownArea('those areas'),
            options: [],
            session,
          };
        }

        // Exactly one site across selection → quote; 2+ → checkbox site pick (RULE 5 / 11)
        if (readyReps.length === 1) {
          return finalizeSelection(readyReps, {
            ...session,
            needsContinueConfirm: false,
            workQueue: undefined,
            pendingCityQueue: undefined,
          }, services);
        }

        return buildMultiAreaSitePicker(readyReps, {
          ...session,
          needsContinueConfirm: false,
          workQueue: undefined,
          pendingCityQueue: undefined,
        }, uniqueAreas);
      }

      if (uniqueCities.length === 0) {
        return afterLocationResolved(allHits, lastSession, services);
      }

      const readyReps: DbService[] = [];
      const needFunnel: WorkItem[] = [];

      for (const cityLabel of uniqueCities) {
        let hits =
          medium && isExactCatalogMedium(medium, services)
            ? filterByExactMedium(services, medium)
            : filterForBrowseOrFamily(services, token || medium);
        if (session.mediumType) {
          const mt = canonicalizeServiceName(session.mediumType);
          hits = hits.filter((s) => {
            const got = getMediumTypeFromDb(s);
            return !!got && canonicalizeServiceName(got) === mt;
          });
        }
        hits = hits.filter((s) => serviceMatchesCityLabel(s, cityLabel));
        if (!hits.length) continue;

        const withDir = hits.filter((s) => !!getDirectionLabel(s));
        const dirKeys = [
          ...new Set(
            withDir
              .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
              .filter(Boolean),
          ),
        ];

        if (dirKeys.length <= 1 || hits.length === 1) {
          const rep = (dirKeys.length === 1 && withDir[0]) || hits[0];
          if (rep) readyReps.push(rep);
        } else {
          needFunnel.push({
            medium: medium || token,
            browseToken: medium || token,
            qty: session.qty,
            city: cityLabel,
            candidateServiceIds: hits.map((s) => s.service_id),
          });
        }
      }

      if (readyReps.length > 0 && needFunnel.length === 0) {
        return finalizeSelection(readyReps, {
          ...session,
          needsContinueConfirm: false,
          workQueue: undefined,
          pendingCityQueue: undefined,
          area: undefined,
          placeHint: undefined,
        }, services);
      }

      let seedRows: ConfirmationRow[] = [...(session.collectedRows || [])];
      let seedIds: string[] = [...(session.collectedServiceIds || [])];
      if (readyReps.length > 0) {
        const built = buildRowsForServices(
          readyReps,
          session.qty,
          session.durationText,
          session.originalText,
          session.qtyByServiceId,
        );
        seedRows = [...seedRows, ...built.rows];
        seedIds = [...seedIds, ...readyReps.map((s) => s.service_id)];
      }

      if (!needFunnel.length) {
        if (seedRows.length) {
          return finalizeSelection([], {
            ...session,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
            pendingCityQueue: undefined,
            workQueue: undefined,
          }, services);
        }
        return {
          step: 'no_match',
          botText: copyUnknownCity('those cities'),
          options: [],
          session,
        };
      }

      const [first, ...rest] = needFunnel;
      return advanceFunnel(
        {
          ...session,
          medium: canonicalizeServiceName(first.medium),
          browseToken: canonicalizeServiceName(first.browseToken || first.medium),
          mediumType: session.mediumType,
          city: first.city,
          area: undefined,
          placeHint: undefined,
          qty: first.qty,
          candidateServiceIds: first.candidateServiceIds,
          workQueue: rest,
          pendingCityQueue: undefined,
          collectedRows: seedRows,
          collectedServiceIds: seedIds,
          needsContinueConfirm: false,
        },
        services,
        rest.length
          ? `Starting with ${first.city} (${rest.length} more after this).`
          : undefined,
      );
    }

    return afterLocationResolved(allHits, lastSession, services);
  }

  // City pick (single — multi already handled above when mixed with place/area)
  if (actionId.startsWith('city:') && !(selectedIds && selectedIds.length > 1)) {
    const city = titleCase(actionId.slice(5));
    const token = session.browseToken || session.medium || '';
    // Service-first city pick: clear stale area/place + candidates so Madurai isn't
    // filtered by a previous Vadapalani/Hosur session or a type-skewed id list
    const nextSession: ProgressiveSession = {
      ...session,
      city,
      area: undefined,
      placeHint: undefined,
      needsContinueConfirm: false,
      candidateServiceIds: undefined,
      pendingCityQueue: undefined,
    };
    if (token) {
      return advanceFunnel({
        ...nextSession,
        browseToken: token,
        medium: session.medium || token,
      }, services);
    }
    return advanceFunnel(
      nextSession,
      services,
      copyPlaceServices(city),
    );
  }

  // Area-only pick (after city) — single; multi handled in place block above
  if (actionId.startsWith('area:') && !(selectedIds && selectedIds.length > 1)) {
    const areaKey = actionId.slice(5);
    const token = session.browseToken || session.medium || '';
    const pool = session.city
      ? areasForMediumCity(services, token || session.medium || '', session.city)
      : (token ? filterForBrowseOrFamily(services, token) : services);
    const areaLabel =
      pool
        .map((s) => getAreaLabel(s))
        .find((a) => a && canonicalizeServiceName(a) === areaKey)
      || titleCase(areaKey.replace(/-/g, ' '));
    const nextSession: ProgressiveSession = {
      ...session,
      area: areaLabel,
      browseToken: token || session.browseToken,
      medium: session.medium || token || undefined,
    };
    return advanceFunnel(nextSession, services);
  }

  // Medium / type chip (from city type list or catalog) — after location, narrow to type
  if (actionId.startsWith('medium:') || (selectedIds?.length && selectedIds.every((id) => id.startsWith('medium:')))) {
    // Collect all selected medium tokens (multi-select confirm may send several)
    // Tokens may be "Metro Station" or "Metro Station|elevated" (medium + medium_type).
    const allChips = (selectedIds?.length ? selectedIds : [actionId])
      .filter((id) => id.startsWith('medium:'))
      .map((id) => parseMediumChipToken(id.slice(7)));
    const primary = allChips[0];
    const primaryMedium = primary?.medium || '';
    const pending = session.pendingMedia || [];

    // Multi-service Confirm → one quote with all lines when each medium can resolve
    if (allChips.length > 1) {
      const mediumKeys = [
        ...new Set(
          allChips
            .map((c) => canonicalizeServiceName(c.medium))
            .filter(Boolean),
        ),
      ];
      const typeKeys = [
        ...new Set(
          allChips
            .map((c) => (c.mediumType ? canonicalizeServiceName(c.mediumType) : ''))
            .filter(Boolean),
        ),
      ];
      // Same medium, multiple types (Frontlit + Nonlit / Elevated + Underground):
      // ONE union candidate set. Keep batch workQueue so remaining services still ask.
      const sameMediumMultiType =
        mediumKeys.length === 1
        && typeKeys.length >= 1;
      const isBatchMulti = !!(session.segments && session.segments.length >= 2);
      const placeLocked =
        !!(session.placeHint || session.area)
        && !isBatchMulti;

      if (sameMediumMultiType || placeLocked) {
        const seenIds = new Set<string>();
        const merged: DbService[] = [];
        for (const chip of allChips) {
          const med = canonicalizeServiceName(chip.medium);
          if (!med) continue;
          let hits = filterByExactMedium(services, med);
          if (!hits.length) {
            hits = services.filter((s) => serviceMatchesMediumChip(s, chip));
          }
          hits = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            area: session.area || session.placeHint,
            city: session.city,
          });
          if (chip.mediumType) {
            const mt = canonicalizeServiceName(chip.mediumType);
            const typed = hits.filter((s) => {
              const got = getMediumTypeFromDb(s);
              return !!got && canonicalizeServiceName(got) === mt;
            });
            if (typed.length) hits = typed;
          }
          for (const h of hits) {
            if (!seenIds.has(h.service_id)) {
              seenIds.add(h.service_id);
              merged.push(h);
            }
          }
        }
        if (!merged.length) {
          return softClarifyNeed(
            services,
            session,
            copyUnknownArea(
              session.area || session.placeHint || session.city || 'that place',
            ),
          );
        }
        const selectedLabels = allChips
          .map((c) => {
            const m = titleCase(c.medium);
            return c.mediumType ? `${m} — ${titleCase(c.mediumType)}` : m;
          })
          .join(', ');
        return advanceFunnel(
          {
            ...session,
            medium: canonicalizeServiceName(primaryMedium),
            browseToken: canonicalizeServiceName(primaryMedium),
            // Keep all selected types in candidates — do not lock mediumType to one
            mediumType: typeKeys.length === 1 ? typeKeys[0] : undefined,
            // Critical: skip type re-ask when mediumType is intentionally unset for union
            typesResolved: true,
            candidateServiceIds: merged.map((s) => s.service_id),
            // Batch: keep remaining services. Place-only: clear type leftovers.
            workQueue: isBatchMulti ? session.workQueue : undefined,
            pendingCityQueue: isBatchMulti ? session.pendingCityQueue : undefined,
            batchServiceLabels: isBatchMulti ? session.batchServiceLabels : undefined,
            needsContinueConfirm: placeLocked && !session.city,
            area: session.area || session.placeHint,
            placeHint: session.placeHint || session.area,
          },
          services,
          isBatchMulti
            ? `Added ${selectedLabels} to your quote.`
            : undefined,
        );
      }

      type WorkItem = {
        medium: string;
        browseToken?: string;
        qty: number | null;
        city?: string;
        candidateServiceIds?: string[];
      };
      const readyReps: DbService[] = [];
      const needFunnel: WorkItem[] = [];

      for (const chip of allChips) {
        const med = canonicalizeServiceName(chip.medium);
        if (!med) continue;
        let hits = filterByExactMedium(services, med);
        if (!hits.length) {
          hits = services.filter((s) => serviceMatchesMediumChip(s, chip));
        }
        if (session.city) {
          const scoped = filterHitsBySessionLocation(hits, { ...session, medium: med, city: session.city });
          if (scoped.length) hits = scoped;
        }
        if (session.area || session.placeHint) {
          const scoped = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            area: session.area || session.placeHint,
          });
          if (scoped.length) hits = scoped;
        }
        if (!hits.length) continue;

        if (chip.mediumType) {
          const mt = canonicalizeServiceName(chip.mediumType);
          const typed = hits.filter((s) => {
            const got = getMediumTypeFromDb(s);
            return !!got && canonicalizeServiceName(got) === mt;
          });
          if (typed.length) hits = typed;
        }

        const cities = uniqueCityOptionsFromPool(hits, med);
        // Shared city on session, or exactly one city in pool → try to pick a rep
        const cityLock =
          session.city
          || (cities.length === 1 ? (cities[0].city || cities[0].label) : undefined);

        let scoped = hits;
        if (cityLock) {
          scoped = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            city: cityLock,
          });
          if (!scoped.length) scoped = hits;
        }

        const withDir = scoped.filter((s) => !!getDirectionLabel(s));
        const dirKeys = [
          ...new Set(
            withDir
              .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
              .filter(Boolean),
          ),
        ];

        // Ready when city known and at most one direction (or no directions / single site)
        if (cityLock && (dirKeys.length <= 1 || scoped.length === 1)) {
          const rep =
            (dirKeys.length === 1 && withDir[0])
            || scoped[0];
          if (rep) readyReps.push(rep);
          continue;
        }

        needFunnel.push({
          medium: med,
          browseToken: med,
          qty: session.qty,
          city: cityLock,
          candidateServiceIds: scoped.map((s) => s.service_id),
        });
      }

      // All resolved → collect lines; keep batch workQueue so next services still ask
      if (readyReps.length > 0 && needFunnel.length === 0) {
        return finalizeSelection(readyReps, {
          ...session,
          needsContinueConfirm: false,
          // Do NOT clear workQueue — remaining batch services must continue
        }, services);
      }

      // Some need funnel — queue unmet chips AFTER remaining batch work
      let seedRows: ConfirmationRow[] = [...(session.collectedRows || [])];
      let seedIds: string[] = [...(session.collectedServiceIds || [])];
      if (readyReps.length > 0) {
        const built = buildRowsForServices(
          readyReps,
          session.qty,
          session.durationText,
          session.originalText,
          session.qtyByServiceId,
        );
        seedRows = [...seedRows, ...built.rows];
        seedIds = [...seedIds, ...readyReps.map((s) => s.service_id)];
      }

      if (needFunnel.length === 0) {
        if (seedRows.length) {
          return finalizeSelection([], {
            ...session,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
          }, services);
        }
      } else {
        const [first, ...rest] = needFunnel;
        const priorQueue = session.workQueue || [];
        return advanceFunnel(
          {
            ...session,
            medium: canonicalizeServiceName(first.medium),
            browseToken: canonicalizeServiceName(first.browseToken || first.medium),
            mediumType: undefined,
            city: first.city || session.city,
            area: session.area || session.placeHint,
            qty: first.qty,
            candidateServiceIds: first.candidateServiceIds,
            workQueue: [...rest, ...priorQueue],
            pendingCityQueue: undefined,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
            typesResolved: undefined,
          },
          services,
          rest.length || priorQueue.length
            ? `Added your selection. Next — ${titleCase(first.medium)}${
              first.city ? ` in ${first.city}` : ''
            } needs a choice because it has more than one option.`
            : undefined,
        );
      }
    }

    const nextMedium = canonicalizeServiceName(primaryMedium);
    const previousMedium = canonicalizeServiceName(
      session.medium || session.browseToken || '',
    );
    // RULE 8: type lock on same medium keeps place.
    // Place-first (OMR/ECR): picking a service MUST keep area/placeHint → city = that metro only.
    // Only clear place when switching medium with no locked place (stale city from earlier turn).
    const mediumChanged = !previousMedium || previousMedium !== nextMedium;
    const lockingType = !!primary?.mediumType;
    const keepPlace = !!(session.placeHint || session.area);

    const nextSession: ProgressiveSession = {
      ...session,
      medium: nextMedium,
      browseToken: nextMedium,
      needsContinueConfirm: keepPlace
        ? true
        : mediumChanged
          ? false
          : session.needsContinueConfirm,
      area: mediumChanged && !keepPlace ? undefined : (session.area || session.placeHint),
      placeHint: mediumChanged && !keepPlace ? undefined : (session.placeHint || session.area),
      city: mediumChanged && !keepPlace ? undefined : session.city,
      // Always re-scope candidates when medium changes; place filter reapplies in funnel
      candidateServiceIds: mediumChanged ? undefined : session.candidateServiceIds,
      pendingCityQueue: mediumChanged && !keepPlace ? undefined : session.pendingCityQueue,
      // Place-locked single type: never carry a stale workQueue into the site ask
      workQueue: keepPlace ? undefined : session.workQueue,
      batchServiceLabels: keepPlace ? undefined : session.batchServiceLabels,
      mediumType: lockingType
        ? canonicalizeServiceName(primary!.mediumType!)
        : mediumChanged
          ? undefined
          : session.mediumType,
      typesResolved: lockingType
        ? true
        : mediumChanged
          ? undefined
          : session.typesResolved,
      pendingMedia: pending.filter(
        (m) => !allChips.some((c) => canonicalizeServiceName(c.medium) === canonicalizeServiceName(m)),
      ),
    };

    // Continue strict funnel: Type → City → Area → Direction
    return advanceFunnel(nextSession, services);
  }

  // Product chip without serviceId — resolve by label against candidates (multi-select ok)
  if (actionId.startsWith('product:') || (selectedIds?.length && selectedIds.every((id) => id.startsWith('product:')))) {
    const keys = (selectedIds?.length ? selectedIds : [actionId])
      .filter((id) => id.startsWith('product:'))
      .map((id) => id.slice(8));
    const pool = session.candidateServiceIds?.length
      ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
      : services;
    const hits = pool.filter((s) => {
      const label = canonicalizeServiceName((s.service_name || '').split('·')[0] || '');
      return keys.some((key) => label === key || label.includes(key) || key.includes(label));
    });
    if (hits.length === 0) {
      return softPickTypes(
        services,
        session,
        session.city,
        copyAskType(session.browseToken || session.medium || 'that'),
      );
    }
    if (keys.length > 1) {
      // One rep per product key
      const reps: DbService[] = [];
      const seen = new Set<string>();
      for (const key of keys) {
        const match = hits.find((s) => {
          const label = canonicalizeServiceName((s.service_name || '').split('·')[0] || '');
          return label === key || label.includes(key) || key.includes(label);
        });
        if (match && !seen.has(match.service_id)) {
          seen.add(match.service_id);
          reps.push(match);
        }
      }
      if (reps.length) return finalizeSelection(reps, session, services);
    }
    // Need city?
    if (!session.city) {
      const cities = new Set(
        hits.map((s) => extractRealCityFromDbService(s)).filter(Boolean) as string[],
      );
      if (cities.size >= 1) {
        const medium = getMediumKey(hits[0]);
        const family = (medium || '').split(/\s+/)[0] || medium;
        return {
          step: 'pick_city',
          botText: copyAskCities(family || medium),
          options: [...cities].sort().map((c) => ({
            id: `city:${c.toLowerCase()}`,
            label: c,
            city: c,
            medium: family || medium,
          })),
          allowMulti: true,
          session: { ...session, medium: family || medium, candidateServiceIds: hits.map((s) => s.service_id) },
        };
      }
    }
    const city = session.city;
    const cityHits = city
      ? hits.filter((s) => (extractRealCityFromDbService(s) || '').toLowerCase() === city.toLowerCase())
      : hits;
    const use = cityHits.length ? cityHits : hits;
    const withAreas = use.filter((s) => {
      const a = getAreaLabel(s);
      return !!a && !isNumericOnlyLabel(a);
    });
    if (withAreas.length > 1) {
      return {
        step: 'pick_area',
        botText: copyAskArea(
          city || extractRealCityFromDbService(use[0]) || undefined,
          getMediumKey(use[0]),
        ),
        options: uniqueServiceOptions(withAreas),
        allowMulti: true,
        session: { ...session, medium: getMediumKey(use[0]), candidateServiceIds: withAreas.map((s) => s.service_id) },
      };
    }
    const withDir = use.filter((s) => !!getDirectionLabel(s));
    if (withDir.length > 1 && withAreas.length <= 1) {
      return buildDirectionPicker(withDir, session, city || session.area || '');
    }
    if (use.length > 1) {
      return {
        step: 'related_services',
        botText: 'Here are some related options that may fit your brief:',
        options: uniqueServiceOptions(use),
        allowMulti: true,
        session: { ...session, medium: getMediumKey(use[0]), candidateServiceIds: use.map((s) => s.service_id) },
      };
    }
    return finalizeSelection(use, session, services);
  }

  // Direction pick — single or multi confirm
  if (
    actionId.startsWith('direction:')
    || (selectedIds?.length && selectedIds.every((id) => id.startsWith('direction:')))
  ) {
    const ids = selectedIds?.length
      ? selectedIds.map((id) => (id.startsWith('direction:') ? id.slice(10) : id))
      : [actionId.slice(10)];
    const selected = services.filter((s) => ids.includes(s.service_id));
    if (selected.length) return finalizeSelection(selected, session, services);
  }

  // Batch-group confirm: compact id `batch-group:seg|place|idx` → look up session.batchGroupMap
  // Legacy ids still encode uuid lists: `batch-group:id1,id2,...`
  const hasBatchGroup = (selectedIds || [actionId]).some((id) => id.startsWith('batch-group:'));
  if (hasBatchGroup) {
    const selectedChips = (selectedIds || [actionId]).filter((id) => id.startsWith('batch-group:'));

    type WorkItem = {
      medium: string;
      browseToken?: string;
      qty: number | null;
      city?: string;
      candidateServiceIds: string[];
    };
    const workItems: WorkItem[] = [];

    for (const chipId of selectedChips) {
      const mapped = session.batchGroupMap?.[chipId];
      const ids = mapped?.length
        ? mapped
        : chipId.slice(12).split(',').filter((x) => x.length > 8 && !x.includes('|'));
      let candidates = services.filter((s) => ids.includes(s.service_id));
      if (!candidates.length && chipId.includes('|')) {
        // Compact id without map (e.g. restored history) — recover by seg/place label
        const parts = chipId.slice(12).split('|');
        const segKey = parts[0] || '';
        const placeKey = parts[1] || '';
        candidates = services.filter((s) => {
          const med = canonicalizeServiceName(getMediumKey(s));
          if (segKey && !med.includes(segKey) && !canonicalizeServiceName(s.service_name || '').includes(segKey)) {
            return false;
          }
          if (!placeKey) return true;
          const city = extractRealCityFromDbService(s);
          const loc = getLocalityFromMetaCity(s);
          return (
            (city && canonicalizeServiceName(city) === placeKey)
            || (loc && canonicalizeServiceName(loc) === placeKey)
          );
        });
      }
      if (!candidates.length) continue;
      const rep = candidates[0];
      const city =
        extractRealCityFromDbService(rep)
        || (rep && matchKnownCityLabel(getMetaCityRaw(rep) || '') ? matchKnownCityLabel(getMetaCityRaw(rep) || '') : null)
        || undefined;
      // Never lock work-item city to a locality (Anna Nagar) — only known metros
      const cityLock =
        city
        || (ids
          .map((id) => services.find((s) => s.service_id === id))
          .map((s) => (s ? extractRealCityFromDbService(s) : null))
          .find(Boolean) || undefined);
      const medium = getMediumKey(rep) || session.browseToken || session.medium || 'service';
      const family = canonicalizeServiceName(medium).split(/\s+/).filter(Boolean)[0] || medium;

      // Expand to ALL family rows in this real city so Metro shows Elevated/Underground/Wrap/Train Inside
      if (cityLock && family.length >= 3) {
        const broader = filterForBrowseOrFamily(services, family).filter((s) => {
          const real = extractRealCityFromDbService(s);
          if (real && canonicalizeServiceName(real) === canonicalizeServiceName(cityLock)) {
            return true;
          }
          // Locality-only rows promoted when sole city of this chip group
          return !real && ids.includes(s.service_id);
        });
        if (broader.length > candidates.length) candidates = broader;
      }

      let qty: number | null = session.qty;
      for (const id of ids) {
        if (session.qtyByServiceId?.[id] != null) {
          qty = session.qtyByServiceId[id];
          break;
        }
      }
      workItems.push({
        // Lock family token ("metro") so pool includes Station / Wrap / Train Inside
        medium: canonicalizeServiceName(family),
        browseToken: canonicalizeServiceName(family),
        qty,
        city: cityLock || undefined,
        candidateServiceIds: candidates.map((s) => s.service_id),
      });
    }

    // Autos already in collectedRows — keep them
    const autoRows = session.collectedRows || [];
    const autoIds = session.collectedServiceIds || [];

    if (!workItems.length) {
      if (autoIds.length) {
        const autoSvcs = services.filter((s) => autoIds.includes(s.service_id));
        const autoRepMap = new Map<string, DbService>();
        for (const svc of autoSvcs) {
          const gk = batchGroupKey(svc);
          if (!autoRepMap.has(gk)) autoRepMap.set(gk, svc);
        }
        if (autoRepMap.size) {
          return finalizeSelection([...autoRepMap.values()], {
            ...session,
            collectedRows: autoRows,
            collectedServiceIds: [],
            segments: undefined,
            workQueue: undefined,
          }, services);
        }
      }
      return {
        step: 'no_match',
        botText: copyWhichService(),
        options: [],
        session,
      };
    }

    // Deduplicate work by medium+city
    const uniqWork: WorkItem[] = [];
    const seenW = new Set<string>();
    for (const w of workItems) {
      const key = `${canonicalizeServiceName(w.medium)}|${(w.city || '').toLowerCase()}`;
      if (seenW.has(key)) continue;
      seenW.add(key);
      uniqWork.push(w);
    }

    const [first, ...rest] = uniqWork;
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(first.medium),
        browseToken: canonicalizeServiceName(first.browseToken || first.medium),
        mediumType: undefined,
        city: first.city,
        area: session.placeHint || undefined,
        qty: first.qty,
        candidateServiceIds: first.candidateServiceIds,
        workQueue: rest,
        pendingCityQueue: undefined,
        collectedRows: autoRows,
        collectedServiceIds: autoIds,
        segments: session.segments,
        typesResolved: undefined,
      },
      services,
      rest.length
        ? `Starting with ${titleCase(first.medium)}${first.city ? ` in ${first.city}` : ''} (${rest.length} more after this).`
        : undefined,
    );
  }

  // Direct service_id selection (area chips) — multi
  if (selectedIds && selectedIds.length > 0) {
    const selected = services.filter((s) => selectedIds.includes(s.service_id));
    if (selected.length) return finalizeSelection(selected, session, services);
  }

  const byId = services.find((s) => s.service_id === actionId);
  if (byId) return finalizeSelection([byId], session, services);

  return {
    step: 'no_match',
        botText: copyWhichService(),
    options: [],
    session,
  };
}
