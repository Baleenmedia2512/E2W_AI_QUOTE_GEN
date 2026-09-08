import type { IntentOverlay } from './funnel/types';
import type { ParseResult } from './types';

/** Map Phase-2 parse output → legacy intent overlay for session merge. */
export function parseResultToIntent(
  parsed: ParseResult,
  resolvedLocation?: import('../types/location').ResolvedLocation | null,
): IntentOverlay {
  const seg = parsed.segments[0];
  return {
    kind: parsed.kind,
    media: seg?.service ? [seg.service] : null,
    medium: seg?.service ?? null,
    city: parsed.city || seg?.city || null,
    areaHint: parsed.areaHint || seg?.place || null,
    directionHint: parsed.directionHint,
    ambiguous: parsed.ambiguous,
    clarifyHint: parsed.clarifyHint,
    qty: parsed.qty ?? seg?.qty ?? null,
    duration: parsed.duration,
    shortReply: null,
    resolvedLocation: resolvedLocation ?? null,
  };
}
