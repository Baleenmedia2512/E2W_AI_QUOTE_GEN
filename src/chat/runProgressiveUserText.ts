import type { ChatIntentHint } from '../services/chatIntentAiService';
import { canonicalizeServiceName } from '../utils/serviceNameUtils';
import type { DbService } from '../utils/serviceResolver';
import {
  canSkipChatIntentAi,
  detectCityInText,
  detectLocalityInText,
  detectMediaLocal,
  extractGeocodePlaceHint,
  isNewServiceSwitch,
  matchFreeTextToProgressiveOption,
  resolveProgressiveText,
  type ProgressiveOption,
  type ProgressiveSession,
  type ProgressiveTurnResult,
} from '../utils/progressiveChatEngine';
import { USE_NEW_CHAT_ENGINE } from './config';
import { continueChatAction } from './continueChatAction';
import { resolveCityGeography } from './geography';
import { handleChatTurn } from './handleChatTurn';

export interface ProgressiveMessageSnapshot {
  role: string;
  content?: string;
  progressiveSession?: ProgressiveSession;
  progressiveOptions?: ProgressiveOption[];
}

/** Prior funnel session — cleared after a completed quote. */
export function resolvePriorSession(
  progressiveSession: ProgressiveSession | null,
  messages: ProgressiveMessageSnapshot[],
): ProgressiveSession | null {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const completedQuoteSession =
    !!lastAssistant
    && /your quotation is ready\./i.test(lastAssistant.content || '');
  if (completedQuoteSession) return null;
  const lastProgMsg = [...messages].reverse().find(
    (m) => m.role === 'assistant' && m.progressiveSession,
  );
  return progressiveSession || lastProgMsg?.progressiveSession || null;
}

async function resolveGeographyForText(
  text: string,
  dbServices: DbService[],
  priorSession: ProgressiveSession | null,
  intent: ChatIntentHint | null,
): Promise<ResolvedLocation | null> {
  const textCity =
    detectCityInText(text, dbServices)
    || (intent?.city ? String(intent.city) : null)
    || null;
  const placeToResolve =
    textCity
    || extractGeocodePlaceHint(text, dbServices)
    || priorSession?.city
    || null;
  if (!placeToResolve) {
    return priorSession?.resolvedLocation ?? null;
  }
  return resolveCityGeography(placeToResolve, priorSession);
}

type ResolvedLocation = import('../types/location').ResolvedLocation;

function shouldSkipChipTextMatch(
  text: string,
  priorSession: ProgressiveSession,
  dbServices: DbService[],
): boolean {
  const localMedia = detectMediaLocal(text, dbServices);
  if (isNewServiceSwitch(priorSession, localMedia)) return true;
  const mediaKey = canonicalizeServiceName(localMedia[0] || '');
  const textKey = canonicalizeServiceName(text);
  const priorMedKey = canonicalizeServiceName(
    priorSession.medium || priorSession.browseToken || '',
  );
  if (detectLocalityInText(text, dbServices)) return true;
  const sameServiceBareEcho =
    !!mediaKey
    && !!priorMedKey
    && (
      textKey === priorMedKey
      || mediaKey === priorMedKey
    )
    && !(
      textKey.length > priorMedKey.length
      && (
        textKey.startsWith(`${priorMedKey} `)
        || mediaKey.startsWith(`${priorMedKey} `)
      )
    );
  return sameServiceBareEcho;
}

async function tryTypedChipMatch(
  text: string,
  priorSession: ProgressiveSession,
  dbServices: DbService[],
  lastProgOptions?: ProgressiveOption[],
): Promise<ProgressiveTurnResult | null> {
  if (!lastProgOptions?.length) return null;
  if (shouldSkipChipTextMatch(text, priorSession, dbServices)) return null;
  const matched = matchFreeTextToProgressiveOption(text, lastProgOptions);
  if (!matched) return null;
  const cityFromChip = matched.city || (
    matched.id.startsWith('city:')
      ? (matched.label || matched.id.replace(/^city:/i, ''))
      : undefined
  );
  return continueChatAction(matched.id, priorSession, dbServices, undefined, cityFromChip);
}

function intentToOverlay(
  intent: ChatIntentHint | null,
  resolvedLocation: ResolvedLocation | null,
) {
  if (!intent) return { resolvedLocation, shortReply: null as null };
  return {
    kind: intent.kind,
    media: intent.media,
    medium: intent.medium,
    city: intent.city,
    areaHint: intent.areaHint,
    directionHint: intent.directionHint,
    ambiguous: intent.ambiguous,
    clarifyHint: intent.clarifyHint,
    qty: intent.qty,
    duration: intent.duration,
    resolvedLocation,
    shortReply: null as null,
  };
}

async function runLegacyProgressiveText(
  text: string,
  dbServices: DbService[],
  priorSession: ProgressiveSession | null,
  lastProgOptions?: ProgressiveOption[],
): Promise<ProgressiveTurnResult> {
  const skipAi = canSkipChatIntentAi(text, dbServices);
  let intent: ChatIntentHint | null = null;
  if (!skipAi) {
    try {
      const { parseChatIntentWithAi } = await import('../services/chatIntentAiService');
      const { getCatalogTypeKeys, getCatalogCities } = await import('../utils/progressiveChatEngine');
      intent = await parseChatIntentWithAi(
        text,
        { types: getCatalogTypeKeys(dbServices), cities: getCatalogCities(dbServices) },
        10000,
        priorSession
          ? {
              medium: priorSession.medium || priorSession.browseToken,
              mediumType: priorSession.mediumType,
              city: priorSession.city,
              area: priorSession.area || priorSession.placeHint,
              directionHint: priorSession.directionHint,
            }
          : null,
      );
    } catch {
      intent = null;
    }
  }

  if (priorSession && lastProgOptions?.length) {
    const chipResult = await tryTypedChipMatch(text, priorSession, dbServices, lastProgOptions);
    if (chipResult) return chipResult;
  }

  const resolvedLocation = await resolveGeographyForText(text, dbServices, priorSession, intent);
  const sessionWithGeo = priorSession
    ? { ...priorSession, resolvedLocation: resolvedLocation ?? priorSession.resolvedLocation }
    : (resolvedLocation ? { originalText: text, qty: null, resolvedLocation } : priorSession);

  return resolveProgressiveText(
    text,
    dbServices,
    sessionWithGeo,
    intentToOverlay(intent, resolvedLocation),
  );
}

/** One free-text progressive turn — new engine or legacy fallback. */
export async function runProgressiveUserText(
  text: string,
  dbServices: DbService[],
  priorSession: ProgressiveSession | null,
  lastProgOptions?: ProgressiveOption[],
): Promise<ProgressiveTurnResult> {
  if (priorSession && lastProgOptions?.length) {
    const chipResult = await tryTypedChipMatch(text, priorSession, dbServices, lastProgOptions);
    if (chipResult) return chipResult;
  }

  if (USE_NEW_CHAT_ENGINE) {
    const skipAi = canSkipChatIntentAi(text, dbServices);
    const resolvedLocation = await resolveGeographyForText(text, dbServices, priorSession, null);
    const sessionWithGeo = priorSession
      ? { ...priorSession, resolvedLocation: resolvedLocation ?? priorSession.resolvedLocation }
      : (resolvedLocation ? { originalText: text, qty: null, resolvedLocation } : priorSession);
    return handleChatTurn(text, dbServices, sessionWithGeo, {
      resolvedLocation,
      skipAi,
    });
  }

  return runLegacyProgressiveText(text, dbServices, priorSession, lastProgOptions);
}
