/**
 * Public chat API (Phase 7.2).
 *
 * UI / tests: import from `src/chat` (this file) only.
 * Internals live under `./funnel/*` and should not be imported from app code.
 */

export { USE_NEW_CHAT_ENGINE } from './config';

export { continueChatAction, continueChatActionSync } from './continueChatAction';
export { handleChatTurn, handleChatTurnSync, isBatchMessage } from './handleChatTurn';
export { continueProgressiveAction, resolveProgressiveText } from './progressiveApi';
export { resolvePriorSession, runProgressiveUserText } from './runProgressiveUserText';
export type { ProgressiveMessageSnapshot } from './runProgressiveUserText';

export { parseMessage, parseMessageSync } from './parseIntent';
export { parseResultToIntent } from './parseToIntent';
export { buildSessionFromParse } from './sessionFromParse';
export { formatReply } from './copy';
export { filterCatalog } from './filterCatalog';
export { resolveNextStep } from './resolveNextStep';
export { resolveCityGeography } from './geography';
export {
  advanceQueue,
  buildQueue,
  getActive,
  runBatchTextTurn,
  skipActive,
} from './queue';
export type { BatchQueueBuild, BatchWorkItem } from './queue';

export type { ParsedSegment, ParseKind, ParseResult, ParseSession } from './types';
export type {
  BatchSegment,
  IntentOverlay,
  ProgressiveOption,
  ProgressiveSession,
  ProgressiveStep,
  ProgressiveTurnResult,
} from './funnel/types';

/** Catalog / matching helpers used by tests and ChatInterface. */
export {
  batchResolve,
  canSkipChatIntentAi,
  continueBatchQueue,
  detectCatalogueBrowseQuery,
  detectCitiesInText,
  detectCityInText,
  detectDirectionInText,
  detectLocalityInText,
  detectMediaLocal,
  detectUnresolvedPlaceAttempt,
  extractGeocodePlaceHint,
  filterPoolBySession,
  friendlyServiceLabel,
  getAreaLabel,
  getCatalogCities,
  getCatalogLocalities,
  getCatalogTypeKeys,
  getDbCityLabel,
  getDirectionLabel,
  getMediumKey,
  getMediumTypeFromDb,
  matchFreeTextToProgressiveOption,
  parseQtyFromText,
  parseServiceSegments,
  resolveMinQtyEdits,
} from './funnel';
