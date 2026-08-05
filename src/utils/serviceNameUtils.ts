/**
 * Pure service-name helpers (no AI / no PDF registry).
 * Used by DB-backed quote matching and catalog resolution.
 */

export interface ServiceQuantity {
  min: number;
  max: number | null;
}

export const KNOWN_CITY_LIST = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tirupur',
  'erode', 'vellore', 'tirunelveli', 'tenkasi', 'bangalore', 'hyderabad', 'mumbai', 'delhi', 'kochi',
];

function normalizeSvc(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(\d+\s*\/\s*\d+\)/g, ' ')
    .replace(/[\u2013\u2014\u2212–—\-\/]/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(
      /\b(boards|hoardings|posters|screens|stations|ads|copies|stickers|banners|frames|cabs|autos|buses|vans|metros|hoarding)\b/g,
      (m) => (m === 'hoarding' ? 'hoarding' : m.replace(/s$/, '')),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const SYNONYMS: Array<[RegExp, string]> = [
  [/\bad\b/g, 'branding'],
  [/\badvertising\b/g, 'branding'],
  [/\bawarness\b/g, 'awareness'],
  [/\bappartment\b/g, 'apartment'],
  [/\bunderground metro\b/g, 'underground'],
  [/\bunderground station\b/g, 'underground'],
];

function applySynonyms(s: string): string {
  let out = s;
  for (const [re, to] of SYNONYMS) out = out.replace(re, to);
  return out.replace(/\s+/g, ' ').trim();
}

/** Normalize + synonyms — used for catalog matching. */
export function canonicalizeServiceName(s: string): string {
  return applySynonyms(normalizeSvc(s));
}
