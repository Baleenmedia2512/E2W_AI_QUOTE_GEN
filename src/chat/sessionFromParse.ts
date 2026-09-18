import { canonicalizeServiceName } from '../utils/serviceNameUtils';
import type { ResolvedLocation } from '../types/location';
import type { ProgressiveSession } from '../utils/progressiveChatEngine';
import type { ParseResult } from './types';

/** Build / merge session from a single-segment parse + optional prior locks. */
export function buildSessionFromParse(
  parsed: ParseResult,
  prior: ProgressiveSession | null | undefined,
  text: string,
  resolvedLocation?: ResolvedLocation | null,
): ProgressiveSession {
  const seg = parsed.segments[0];
  const service = seg?.service ? canonicalizeServiceName(seg.service) : undefined;
  const city = parsed.city || seg?.city || undefined;
  const place = parsed.areaHint || seg?.place || undefined;
  const qty = parsed.qty ?? seg?.qty ?? prior?.qty ?? null;

  const base: ProgressiveSession = {
    originalText: text,
    qty,
    durationText: parsed.duration ?? prior?.durationText,
    resolvedLocation: resolvedLocation ?? prior?.resolvedLocation,
    pendingMedia: [],
    collectedRows: prior?.collectedRows ?? [],
    collectedServiceIds: prior?.collectedServiceIds ?? [],
  };

  if (!prior) {
    return {
      ...base,
      medium: service,
      browseToken: service,
      city,
      area: place,
      placeHint: place,
      directionHint: parsed.directionHint || undefined,
    };
  }

  const priorMed = canonicalizeServiceName(prior.medium || prior.browseToken || '');
  const serviceChanged =
    !!service
    && !!priorMed
    && service !== priorMed
    && !service.startsWith(`${priorMed} `)
    && !priorMed.startsWith(`${service} `);

  if (serviceChanged) {
    return {
      ...base,
      medium: service,
      browseToken: service,
      city: city || undefined,
      area: place,
      placeHint: place,
      directionHint: parsed.directionHint || undefined,
      mediumType: undefined,
      typesResolved: undefined,
      candidateServiceIds: undefined,
      workQueue: undefined,
    };
  }

  const cityChanged =
    !!city
    && !!prior.city
    && canonicalizeServiceName(city) !== canonicalizeServiceName(prior.city);
  const areaChanged =
    !!place
    && canonicalizeServiceName(place)
      !== canonicalizeServiceName(prior.area || prior.placeHint || '');

  return {
    ...prior,
    ...base,
    medium: prior.medium || service,
    browseToken: prior.browseToken || prior.medium || service,
    city: city || (cityChanged ? undefined : prior.city),
    area: place || (cityChanged ? undefined : prior.area),
    placeHint: place || (cityChanged ? undefined : prior.placeHint),
    directionHint:
      parsed.directionHint
      || (areaChanged || cityChanged ? undefined : prior.directionHint),
    candidateServiceIds:
      areaChanged || cityChanged ? undefined : prior.candidateServiceIds,
  };
}
