import type { DbService } from '../utils/serviceResolver';
import {
  advanceFunnel,
  type ProgressiveSession,
  type ProgressiveTurnResult,
} from '../utils/progressiveChatEngine';

/**
 * Golden rule funnel: Type → City → Area → Direction → Quote.
 * 0 options → no_match; 1 → auto-lock; 2+ → chips (via advanceFunnel).
 */
export function resolveNextStep(
  session: ProgressiveSession,
  services: DbService[],
  opts?: { allowAutoFinalize?: boolean },
): ProgressiveTurnResult {
  return advanceFunnel(session, services, null, opts);
}
