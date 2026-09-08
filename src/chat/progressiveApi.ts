/**
 * Phase 6 public turn API — routes through handleChatTurn / continueChatAction.
 * Tests and legacy import sites should use these instead of engine internals.
 */
import type { DbService } from '../utils/serviceResolver';
import { continueChatActionSync } from './continueChatAction';
import type { IntentOverlay, ProgressiveSession, ProgressiveTurnResult } from './types';
import { handleChatTurnSync } from './handleChatTurn';

function safeServices(services: DbService[]): DbService[] {
  return (services || []).filter(
    (s): s is DbService => !!s && !!(s.service_id || s.service_name),
  );
}

export function resolveProgressiveText(
  userText: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  return handleChatTurnSync(userText, safeServices(services), prior, intent);
}

export function continueProgressiveAction(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  return continueChatActionSync(actionId, session, safeServices(services), selectedIds);
}
