/**
 * Funnel shared — split from body.ts (Phase 8).
 */
import {
  ConfirmationRow,
  extractCityFromDbService,
  extractQueryWords,
  getMinQuantityFromDbService,
  geoNamesLooselyMatch,
  serviceCoversResolvedLocation,
  serviceMatchesQuery,
} from '../../utils/cloudQuoteValidation';
import { canonicalizeServiceName } from '../../utils/serviceNameUtils';
import { hasQuotablePricing, pickPreferredDbService } from '../../utils/dbPricingUtils';
import type { DbService } from '../../utils/serviceResolver';
import { formatServiceDisplayName } from '../../utils/serviceResolver';
import { getServiceScopedUserMessage, parseDurationFromUserText, toCampaignDays } from '../../utils/durationUtils';
import { resolveMediaAgainstCatalog } from '../../services/chatIntentAiService';
import {
  directionKeys,
  isStrongDirectionMatch,
  scoreDirectionMatch,
} from '../../utils/directionMatcher';
import type { ResolvedLocation } from '../../types/location';
import type {
  BatchSegment,
  CatalogueBrowseKind,
  IntentOverlay,
  ProgressiveOption,
  ProgressiveSession,
  ProgressiveStep,
  ProgressiveTurnResult,
} from './types';

export const STOP_WORDS = new Set([
  'need', 'for', 'the', 'a', 'an', 'in', 'at', 'of', 'and', 'i', 'want', 'please',
  'generate', 'quote', 'quotation', 'create', 'price', 'cost', 'rates', 'rate',
  'services', 'service', 'ads', 'advertising', 'outdoor', 'some', 'any', 'get', 'give',
  'me', 'my', 'to', 'with', 'looking', 'show', 'list', 'available', 'all', 'options',
  'days', 'day', 'months', 'month', 'weeks', 'week',
]);

export function titleCase(s: string): string {
  return s
    .split(/[\s_/]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^(led|lcd|fm|tv|ac)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export const FAMILY_NEEDS_ADS_WORD = new Set([
  'bus', 'auto', 'cab', 'taxi', 'car', 'van', 'metro', 'train', 'truck', 'bike',
]);

/**
 * Sales-facing product label.
 * "bus" → "bus advertising" (not vehicle type); "Police Booth" / "Bus Shelter" stay as-is.
 */
export function salesAdLabel(token: string | undefined | null): string {
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

export const MAX_REPLY_LINES = 2;
export const MAX_REPLY_WORDS = 22;

export const OPENER_POOL = [
  '',
  "Let's continue.",
  'Good choice.',
  'Hello!',
] as const;

export function countReplyWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function sessionFiveFields(s?: ProgressiveSession | null) {
  return {
    medium: s?.medium || null,
    mediumType: s?.mediumType || null,
    city: s?.city || null,
    area: s?.area || s?.placeHint || null,
    direction: s?.directionHint || null,
  };
}


export function logFunnelReq(
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


export function logFunnelRes(result: ProgressiveTurnResult): void {
  console.log('[funnel] RES', {
    step: result.step,
    botText: result.botText,
    chips: result.options.map((o) => o.label),
    session: sessionFiveFields(result.session),
  });
}

/** Temporary diagnostics for direction / media miss cases (filter console by this tag). */

export function logFunnelDebug(label: string, payload: Record<string, unknown>): void {
  console.log(`[funnel-debug] ${label}`, payload);
}



/** Short family tokens that sound like vehicles/things — clarify we mean advertising. */


/**
 * Response style: availability + next ask only.
 * Max 2 lines. Type-ask copy is a bit longer by product request.
 */



export function replyLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}


export function isCompactReply(text: string | null | undefined): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  const lines = replyLines(t);
  if (lines.length > MAX_REPLY_LINES) return false;
  return countReplyWords(lines.join(' ')) <= MAX_REPLY_WORDS;
}

/** Availability + ask, max two lines. User-facing copy is DB templates only. */

export function formatReply(avail?: string | null, ask?: string | null): string {
  const lines = [avail, ask]
    .map((s) => (s || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_REPLY_LINES);
  return lines.join('\n');
}

/** Join at most two lines. Keep full catalog names — never slice mid-word. */

export function compactFunnelReply(avail?: string | null, ask?: string | null): string {
  return formatReply(avail, ask);
}


export function clampReplyLines(text: string): string {
  return replyLines(text).slice(0, MAX_REPLY_LINES).join('\n');
}


export function extractAskLine(text: string | null | undefined): string {
  const lines = replyLines(text || '');
  const ask = [...lines].reverse().find((l) =>
    /^(which|please choose|now choosing|starting|did you mean|i have the below options|i understand you)/i.test(l),
  );
  return ask || lines[lines.length - 1] || '';
}


export function joinNoteAndAsk(note?: string | null, ask?: string | null): string {
  const n = replyLines(note || '')[0] || '';
  const a = extractAskLine(ask);
  if (n && a && canonicalizeServiceName(n) === canonicalizeServiceName(a)) {
    return n;
  }
  return compactFunnelReply(n || undefined, a && a !== n ? a : undefined);
}

/** Phase 1: botText is always DB-driven engine copy — never AI shortReply. */

export function preferEngineCopy(_reply: string | null | undefined, engineText: string): string {
  return engineText;
}


export function composeReply(
  _session: ProgressiveSession | null | undefined,
  parts: { avail?: string | null; ask?: string | null; preferredOpeners?: readonly string[] },
): { text: string; opener: string } {
  void parts.preferredOpeners;
  return { text: compactFunnelReply(parts.avail, parts.ask), opener: '' };
}


export function stampReplyMeta(
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


export function withComposedReply(
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


export function stampResultOpener(result: ProgressiveTurnResult): ProgressiveTurnResult {
  const botText = clampReplyLines(result.botText || '');
  const first = botText.split('\n')[0]?.trim() || '';
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
    || /^(Sure!|Great!|Perfect!|Hello!|Let's continue\.|Good choice\.)$/i.test(first)
      ? first
      : (result.session.lastOpener || '');
  return {
    ...result,
    botText,
    session: stampReplyMeta(result.session, opener),
  };
}

/**
 * Service / type chip ask only (Bus Semi vs Shelter, LED vs Non LED, …).
 * City line only when a city is locked/named — never invent “any city”.
 */

/** Strip qty, duration, and city tokens from free text for media/place matching. */
export function stripQtyCityDuration(text: string, city: string | null): string {
  let t = text;
  if (city) {
    t = t.replace(new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), ' ');
  }
  t = t.replace(/\b\d+\s*(days?|months?|weeks?)\b/gi, ' ');
  t = t.replace(/\b\d+\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
