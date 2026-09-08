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

} from './funnel';

import type { ProgressiveOption, ProgressiveSession, ProgressiveTurnResult } from './types';

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



/** One free-text progressive turn — golden-rule engine (Phase 6 default). */

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


