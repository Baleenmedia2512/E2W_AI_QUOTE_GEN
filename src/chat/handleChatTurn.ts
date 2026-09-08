import type { ResolvedLocation } from '../types/location';

import type { DbService } from '../utils/serviceResolver';

import { compactFunnelReply, copyGreeting } from './funnel/copy';

import {

  detectUnresolvedPlaceAttempt,

  replyUnresolvedPlace,

  startCatalogueBrowse,

} from './funnel/location';

import { resolveTextTurn } from './funnel/textTurn';

import { parseMessage, parseMessageSync } from './parseIntent';

import { parseResultToIntent } from './parseToIntent';

import { buildQueue, runBatchTextTurn } from './queue';

import type { IntentOverlay, ParseResult, ProgressiveSession, ProgressiveTurnResult } from './types';



export function isBatchMessage(text: string, services: DbService[]): boolean {

  const { isBatch } = buildQueue(text, services);

  return isBatch;

}



function greetingOrHelpTurn(

  parsed: ParseResult,

  text: string,

  resolvedLocation?: ResolvedLocation | null,

): ProgressiveTurnResult | null {

  if (parsed.kind === 'greeting') {

    return {

      step: 'small_talk',

      botText: copyGreeting(text),

      options: [],

      session: { originalText: text, qty: null, resolvedLocation: resolvedLocation ?? undefined },

    };

  }

  if (parsed.kind === 'help') {

    return {

      step: 'small_talk',

      botText: compactFunnelReply('Tell me the service or city you need.'),

      options: [],

      session: { originalText: text, qty: null, resolvedLocation: resolvedLocation ?? undefined },

    };

  }

  return null;

}



function browseTurn(

  parsed: ParseResult,

  text: string,

  services: DbService[],

  prior?: ProgressiveSession | null,

  resolvedLocation?: ResolvedLocation | null,

): ProgressiveTurnResult | null {

  // Mid-funnel city token = city change, not catalogue browse

  if (prior?.medium || prior?.browseToken) return null;

  if (parsed.kind === 'services_browse') {

    return startCatalogueBrowse(

      'services',

      {

        ...(prior || {}),

        originalText: text,

        qty: prior?.qty ?? null,

        resolvedLocation: resolvedLocation ?? prior?.resolvedLocation,

      },

      services,

      null,

    );

  }

  if (parsed.kind === 'city_browse' && parsed.city) {

    return startCatalogueBrowse(

      'cities',

      {

        ...(prior || {}),

        originalText: text,

        city: parsed.city,

        qty: prior?.qty ?? null,

        resolvedLocation: resolvedLocation ?? prior?.resolvedLocation,

      },

      services,

      null,

    );

  }

  return null;

}



function singleServiceTurn(

  parsed: ParseResult,

  text: string,

  services: DbService[],

  prior?: ProgressiveSession | null,

  intent?: IntentOverlay | null,

  resolvedLocation?: ResolvedLocation | null,

): ProgressiveTurnResult {

  const greeting = greetingOrHelpTurn(parsed, text, resolvedLocation);

  if (greeting) return greeting;



  const browse = browseTurn(parsed, text, services, prior, resolvedLocation);

  if (browse) return browse;



  if (detectUnresolvedPlaceAttempt(text, services)) {

    const place = detectUnresolvedPlaceAttempt(text, services)!;

    return replyUnresolvedPlace(place, services, text, null);

  }



  const overlay: IntentOverlay = {

    ...parseResultToIntent(parsed, resolvedLocation),

    ...intent,

    shortReply: null,

  };



  return resolveTextTurn(text, services, prior, overlay);

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

  const resolvedLocation = intent?.resolvedLocation ?? prior?.resolvedLocation ?? undefined;



  return singleServiceTurn(parsed, text, services, prior, intent, resolvedLocation);

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



  const resolvedLocation =

    opts?.resolvedLocation

    ?? opts?.intent?.resolvedLocation

    ?? prior?.resolvedLocation

    ?? undefined;



  return singleServiceTurn(

    parsed,

    text,

    services,

    prior,

    {

      ...parseResultToIntent(parsed, resolvedLocation),

      ...opts?.intent,

      resolvedLocation,

      shortReply: null,

    },

    resolvedLocation,

  );

}


