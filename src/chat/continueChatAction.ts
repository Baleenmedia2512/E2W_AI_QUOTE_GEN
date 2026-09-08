import type { DbService } from '../utils/serviceResolver';

import { continueProgressiveAction } from './funnel/actions';

import { resolveCityGeography } from './geography';

import type { ProgressiveSession, ProgressiveTurnResult } from './types';



/** Chip / Confirm — sync path (tests + progressiveApi router). */

export function continueChatActionSync(

  actionId: string,

  session: ProgressiveSession,

  services: DbService[],

  selectedIds?: string[],

): ProgressiveTurnResult {

  return continueProgressiveAction(actionId, session, services, selectedIds);

}



/** Chip / Confirm with optional city geocode before funnel advance. */

export async function continueChatAction(

  actionId: string,

  session: ProgressiveSession,

  services: DbService[],

  selectedIds?: string[],

  cityLabel?: string | null,

): Promise<ProgressiveTurnResult> {

  let sessionForAction = session;

  if (cityLabel) {

    const resolved = await resolveCityGeography(cityLabel, session);

    sessionForAction = { ...session, resolvedLocation: resolved };

  }

  return continueChatActionSync(actionId, sessionForAction, services, selectedIds);

}


