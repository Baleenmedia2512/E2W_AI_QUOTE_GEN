/**
 * Geographic location resolver using Nominatim (OpenStreetMap).
 * Converts town names to hierarchical location data (town → district → state).
 *
 * NO external dependencies required (uses native fetch).
 * FREE API with 1 req/sec rate limit.
 * Caches results in localStorage to minimize API calls.
 */

import type { ResolvedLocation } from '../types/location';

/**
 * Resolve a location string to its geographic hierarchy.
 * Returns {town, district, state} or null if not found.
 *
 * Example:
 *   "Karaikudi" → {town: "Karaikudi", district: "Sivaganga", state: "Tamil Nadu"}
 *   "Chennai" → {town: "Chennai", district: null, state: "Tamil Nadu"}
 */
export async function resolveLocation(
  locationString: string,
  forceRefresh = false,
): Promise<ResolvedLocation | null> {
  // Filter console by `[locationResolver]` — if you never see this during chat,
  // the Nominatim library is NOT on the progressive-chat path.
  // eslint-disable-next-line no-console
  console.log('[locationResolver] CALLED', {
    locationString,
    forceRefresh,
    stack: new Error().stack?.split('\n').slice(1, 6).map((l) => l.trim()),
  });

  if (!locationString || typeof locationString !== 'string') {
    // eslint-disable-next-line no-console
    console.log('[locationResolver] SKIP invalid input');
    return null;
  }

  const trimmed = locationString.trim();
  if (trimmed.length < 2) {
    // eslint-disable-next-line no-console
    console.log('[locationResolver] SKIP too short', { trimmed });
    return null;
  }

  // Check cache first (unless forceRefresh)
  if (!forceRefresh) {
    const cached = getLocationCache(trimmed);
    if (cached !== undefined) {
      // eslint-disable-next-line no-console
      console.log('[locationResolver] CACHE HIT', { trimmed, cached });
      return cached;
    }
  }

  try {
    // Call Nominatim API
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', trimmed);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '1');

    // eslint-disable-next-line no-console
    console.log('[locationResolver] FETCH Nominatim', { q: trimmed, url: url.toString() });

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'QuoteBuddy/1.0 (geographic-resolver)',
      },
    });

    if (!response.ok) {
      console.warn(`[locationResolver] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      // Location not found - cache null
      setLocationCache(trimmed, null);
      // eslint-disable-next-line no-console
      console.log('[locationResolver] NOT FOUND', { trimmed });
      return null;
    }

    const result = data[0];
    const address = result.address || {};

    const resolved: ResolvedLocation = {
      town:
        address.town || address.village || address.city || trimmed,
      district: address.district || address.county || null,
      state: address.state || null,
      country: address.country || null,
      confidence: Math.min(1.0, Number(result.importance) || 0.5),
    };

    // Cache successful result
    setLocationCache(trimmed, resolved);

    // eslint-disable-next-line no-console
    console.log('[locationResolver] RESOLVED', { trimmed, resolved });
    return resolved;
  } catch (err) {
    console.warn('[locationResolver] Failed to resolve location:', {
      location: trimmed,
      error: String(err),
    });
    return null;
  }
}

/**
 * Get location from localStorage cache.
 * Returns undefined if not cached, null if previously not found.
 */
function getLocationCache(key: string): ResolvedLocation | null | undefined {
  try {
    const cached = localStorage.getItem(`__qb_location_cache:${key}`);
    if (cached === null) {
      return undefined;
    }
    if (cached === '__null__') {
      return null; // Previously not found
    }
    return JSON.parse(cached);
  } catch {
    return undefined;
  }
}

/**
 * Store location in localStorage cache.
 * Stores '__null__' for not-found results so we don't retry.
 */
function setLocationCache(key: string, value: ResolvedLocation | null): void {
  try {
    if (value === null) {
      localStorage.setItem(`__qb_location_cache:${key}`, '__null__');
    } else {
      localStorage.setItem(`__qb_location_cache:${key}`, JSON.stringify(value));
    }
  } catch (err) {
    console.warn('[locationResolver] Cache failed:', err);
  }
}

/**
 * Clear all location cache (useful after testing or data refresh).
 */
export function clearLocationCache(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith('__qb_location_cache:')) {
        localStorage.removeItem(key);
      }
    });
  } catch (err) {
    console.warn('[locationResolver] Clear cache failed:', err);
  }
}
