import type { DbService } from '../utils/serviceResolver';
import {
  continueProgressiveActionLegacy,
  type ProgressiveSession,
  type ProgressiveTurnResult,
} from '../utils/progressiveChatEngine';
import { resolveCityGeography } from './geography';

/** Chip / Confirm — sync path (tests + progressiveChatEngine router). */
export function continueChatActionSync(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  return continueProgressiveActionLegacy(actionId, session, services, selectedIds);
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
