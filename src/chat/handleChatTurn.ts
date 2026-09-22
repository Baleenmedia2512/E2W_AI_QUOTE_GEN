import type { ResolvedLocation } from '../types/location';
import type { DbService } from '../utils/serviceResolver';
import {
  detectUnresolvedPlaceAttempt,
  parseServiceSegments,
  resolveProgressiveTextLegacy,
  type IntentOverlay,
  type ProgressiveSession,
  type ProgressiveTurnResult,
} from '../utils/progressiveChatEngine';
import { filterCatalog } from './filterCatalog';
import { parseMessage, parseMessageSync } from './parseIntent';
import { parseResultToIntent } from './parseToIntent';
import { runBatchTextTurn } from './queue';
import { resolveNextStep } from './resolveNextStep';
import { buildSessionFromParse } from './sessionFromParse';
import type { ParseResult } from './types';

export function isBatchMessage(text: string, services: DbService[]): boolean {
  return parseServiceSegments(text, services).length >= 2;
}

function shouldTryGoldenRule(
  parsed: ParseResult,
  text: string,
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): boolean {
  if (parsed.kind !== 'quote') return false;
  if (parsed.ambiguous) return false;
  if (parsed.segments.length !== 1) return false;
  const seg = parsed.segments[0];
  if (!seg?.service) return false;

  const hasResolved = !!(intent?.resolvedLocation ?? prior?.resolvedLocation);
  const city = parsed.city || seg.city || prior?.city;
  const place = parsed.areaHint || seg.place || prior?.area || prior?.placeHint;

  // Geocode-only or place-first → legacy buildPlaceOfferTurn / locality lock
  if (hasResolved && !city) return false;
  if (place && !city) return false;
  if (place && city) return false;

  // Type keywords + combined city/area → legacy detectExactCatalogSelection
  if (/\b(front\s*lit|non\s*lit|back\s*lit|\bnl\b|\bfl\b)\b/i.test(text)) return false;

  // Near-place phrasing needs legacy direction/area split
  if (/\bnear\b/i.test(text)) return false;

  // Mid-funnel session → legacy continuation rules
  if (prior?.medium || prior?.city || prior?.area) return false;

  return true;
}

function runSingleServiceTurn(
  parsed: ParseResult,
  text: string,
  services: DbService[],
  prior: ProgressiveSession | null | undefined,
  resolvedLocation?: ResolvedLocation | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult | null {
  if (!shouldTryGoldenRule(parsed, text, prior, intent)) return null;

  const session = buildSessionFromParse(parsed, prior, text, resolvedLocation);
  const pool = filterCatalog(services, session);
  if (!pool.length) return null;

  return resolveNextStep(
    {
      ...session,
      candidateServiceIds: pool.map((s) => s.service_id),
    },
    services,
    { allowAutoFinalize: !prior },
  );
}

/** Sync turn resolver — used when USE_NEW_CHAT_ENGINE routes via resolveProgressiveText. */
export function handleChatTurnSync(
  text: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  if (isBatchMessage(text, services)) {
    return runBatchTextTurn(text, services, prior, intent);
  }

  const parsed = parseMessageSync(text, prior, services);
  const overlay: IntentOverlay = {
    ...parseResultToIntent(parsed, intent?.resolvedLocation ?? prior?.resolvedLocation),
    ...intent,
    shortReply: null,
  };

  if (parsed.kind === 'greeting' || parsed.kind === 'help' || parsed.ambiguous) {
    return resolveProgressiveTextLegacy(text, services, prior, overlay);
  }

  if (detectUnresolvedPlaceAttempt(text, services)) {
    return resolveProgressiveTextLegacy(text, services, prior, overlay);
  }

  const golden = runSingleServiceTurn(
    parsed,
    text,
    services,
    prior,
    overlay.resolvedLocation ?? undefined,
    overlay,
  );
  if (golden && golden.step !== 'no_match') {
    return golden;
  }

  return resolveProgressiveTextLegacy(text, services, prior, overlay);
}

export async function handleChatTurn(
  text: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  opts?: {
    resolvedLocation?: ResolvedLocation | null;
    skipAi?: boolean;
    intent?: IntentOverlay | null;
  },
): Promise<ProgressiveTurnResult> {
  if (isBatchMessage(text, services)) {
    return runBatchTextTurn(text, services, prior, {
      ...opts?.intent,
      resolvedLocation: opts?.resolvedLocation ?? opts?.intent?.resolvedLocation,
      shortReply: null,
    });
  }

  const parsed = await parseMessage(text, prior, services, {
    skipAi: opts?.skipAi,
  });

  if (parsed.segments.length >= 2) {
    return runBatchTextTurn(text, services, prior, {
      ...parseResultToIntent(parsed, opts?.resolvedLocation),
      ...opts?.intent,
      resolvedLocation: opts?.resolvedLocation ?? opts?.intent?.resolvedLocation,
      shortReply: null,
    });
  }

  return handleChatTurnSync(text, services, prior, {
    ...parseResultToIntent(parsed, opts?.resolvedLocation),
    ...opts?.intent,
    resolvedLocation: opts?.resolvedLocation ?? opts?.intent?.resolvedLocation,
    shortReply: null,
  });
}
