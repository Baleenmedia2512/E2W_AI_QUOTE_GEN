import type { ResolvedLocation } from '../types/location';
import { resolveLocation } from '../utils/locationResolver';
import { canonicalizeServiceName } from '../utils/serviceNameUtils';
import type { ProgressiveSession } from './funnel/types';

/**
 * Resolve a city/place via Nominatim (cached). Used so statewide DB rows covering the
 * same state count as available in that city — no hardcoded city lists.
 */
export async function resolveCityGeography(
  city: string | null | undefined,
  prior?: ProgressiveSession | null,
): Promise<ResolvedLocation | null> {
  const label = (city || '').trim();
  if (!label) return prior?.resolvedLocation ?? null;
  const existing = prior?.resolvedLocation ?? null;
  if (
    existing
    && prior?.city
    && canonicalizeServiceName(prior.city) === canonicalizeServiceName(label)
  ) {
    return existing;
  }
  try {
    const resolved = await resolveLocation(label);
    return resolved || existing;
  } catch {
    return existing;
  }
}
