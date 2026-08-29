import type { ConfirmationRow } from '../utils/cloudQuoteValidation';
import type { DbService } from '../utils/serviceResolver';
import {
  continueBatchQueue,
  parseServiceSegments,
  resolveBatchFromSegments,
  type BatchSegment,
  type IntentOverlay,
  type ProgressiveSession,
  type ProgressiveTurnResult,
} from '../utils/progressiveChatEngine';

/** One pending batch job — mirrors ProgressiveSession.workQueue items. */
export type BatchWorkItem = NonNullable<ProgressiveSession['workQueue']>[number];

export interface BatchQueueBuild {
  segments: BatchSegment[];
  isBatch: boolean;
}

function baseSession(
  text: string,
  prior: ProgressiveSession | null | undefined,
  intent?: IntentOverlay | null,
): ProgressiveSession {
  return {
    ...prior,
    originalText: text,
    qty: intent?.qty ?? prior?.qty ?? null,
    durationText: intent?.duration ?? prior?.durationText,
    resolvedLocation: intent?.resolvedLocation ?? prior?.resolvedLocation ?? null,
    pendingMedia: [],
    collectedRows: prior?.collectedRows ?? [],
    collectedServiceIds: prior?.collectedServiceIds ?? [],
  };
}

/** Parse text → validated batch segments (2+ = batch). */
export function buildQueue(
  text: string,
  services: DbService[],
  _prior?: ProgressiveSession | null,
): BatchQueueBuild {
  const segments = parseServiceSegments(text, services);
  return { segments, isBatch: segments.length >= 2 };
}

/** Active service job — current funnel locks or first queued item. */
export function getActive(session: ProgressiveSession): BatchWorkItem | null {
  const medium = session.medium || session.browseToken;
  if (medium) {
    return {
      medium,
      browseToken: session.browseToken || session.medium,
      qty: session.qty ?? null,
      city: session.city,
      area: session.area,
      mediumType: session.mediumType,
      candidateServiceIds: session.candidateServiceIds,
    };
  }
  return session.workQueue?.[0] ?? null;
}

/** After one service completes, start the next queued job (or null when done). */
export function advanceQueue(
  session: ProgressiveSession,
  collectedRows: ConfirmationRow[],
  collectedServiceIds: string[],
  services: DbService[],
): ProgressiveTurnResult | null {
  return continueBatchQueue(session, collectedRows, collectedServiceIds, services);
}

/** Drop the head of workQueue and attach an unavailable note. */
export function skipActive(
  session: ProgressiveSession,
  unavailableLabel: string,
  city?: string,
): ProgressiveSession {
  const [, ...rest] = session.workQueue || [];
  const note = city
    ? `Not providing ${unavailableLabel} in ${city}.`
    : `Skipping ${unavailableLabel}.`;
  const priorNote = (session.batchUnavailableNote || '').trim();
  return {
    ...session,
    workQueue: rest.length ? rest : undefined,
    batchUnavailableNote: priorNote ? `${priorNote}\n${note}` : note,
    batchUnavailableSpoken: false,
  };
}

/** Multi-segment text turn — build queue then start batch funnel. */
export function runBatchTextTurn(
  text: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  const session = baseSession(text, prior, intent);
  const { segments } = buildQueue(text, services, session);
  return resolveBatchFromSegments(segments, session, services, null);
}
