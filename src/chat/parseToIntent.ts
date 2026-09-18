import type { ResolvedLocation } from '../types/location';
import type { IntentOverlay } from '../utils/progressiveChatEngine';
import type { ParseResult } from './types';

/** Map validated parse output → legacy intent overlay for batch fallback. */
export function parseResultToIntent(
  parsed: ParseResult,
  resolvedLocation?: ResolvedLocation | null,
): IntentOverlay {
  const seg = parsed.segments[0];
  const media = parsed.segments
    .map((s) => s.service)
    .filter((s): s is string => !!s);

  return {
    kind: parsed.kind,
    media: media.length ? media : (seg?.service ? [seg.service] : []),
    medium: seg?.service ?? null,
    city: parsed.city ?? seg?.city ?? null,
    areaHint: parsed.areaHint ?? seg?.place ?? null,
    directionHint: parsed.directionHint ?? null,
    ambiguous: parsed.ambiguous,
    clarifyHint: parsed.clarifyHint ?? null,
    qty: parsed.qty ?? seg?.qty ?? null,
    duration: parsed.duration ?? null,
    shortReply: null,
    resolvedLocation: resolvedLocation ?? null,
  };
}
