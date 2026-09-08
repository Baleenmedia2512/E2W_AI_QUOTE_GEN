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

/** Irregular / media plurals → singular (shared by tokenizers). */
export const MEDIA_PLURAL_MAP: Record<string, string> = {
  buses: 'bus',
  autos: 'auto',
  cabs: 'cab',
  tempos: 'tempo',
  vans: 'van',
  trucks: 'truck',
  bikes: 'bike',
  taxis: 'taxi',
  cars: 'car',
  metros: 'metro',
  trains: 'train',
  hoardings: 'hoarding',
  shelters: 'shelter',
  booths: 'booth',
  poles: 'pole',
  kiosks: 'kiosk',
  posters: 'poster',
  pamphlets: 'pamphlet',
  newspapers: 'newspaper',
  boards: 'board',
  banners: 'banner',
  stickers: 'sticker',
  screens: 'screen',
  stations: 'station',
  frames: 'frame',
  wraps: 'wrap',
  panels: 'panel',
  lifts: 'lift',
  lobbies: 'lobby',
  apartments: 'apartment',
  appartments: 'apartment',
  vehicles: 'vehicle',
  ads: 'ad',
  copies: 'copy',
  billboards: 'billboard',
  barricades: 'barricade',
};

function normalizeSvc(s: string): string {
  let out = s
    .toLowerCase()
    .replace(/\(\d+\s*\/\s*\d+\)/g, ' ')
    .replace(/[\u2013\u2014\u2212–—\-\/]/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Word-level plural → singular for known media tokens
  out = out
    .split(/\s+/)
    .map((w) => MEDIA_PLURAL_MAP[w] || w)
    .join(' ');

  // Trailing regular plural on known roots (hoardingss avoided via map)
  out = out.replace(
    /\b(board|hoarding|poster|screen|station|ad|copy|sticker|banner|frame|cab|auto|bus|van|metro|train|booth|pole|kiosk|shelter|wrap|panel|lift|vehicle|billboard|barricade|newspaper|pamphlet)s\b/g,
    '$1',
  );

  return out.replace(/\s+/g, ' ').trim();
}

const SYNONYMS: Array<[RegExp, string]> = [
  [/\bad\b/g, 'branding'],
  [/\badvertising\b/g, 'branding'],
  [/\bawarness\b/g, 'awareness'],
  [/\bappartment\b/g, 'apartment'],
  [/\bapartments?\b/g, 'apartment'],
  [/\bunderground metro\b/g, 'underground'],
  [/\bunderground station\b/g, 'underground'],
  // Common media typos (silent normalize)
  [/\bhordings?\b/g, 'hoarding'],
  [/\bhoordings?\b/g, 'hoarding'],
  [/\bhourdings?\b/g, 'hoarding'],
  [/\bsheltrs?\b/g, 'shelter'],
  [/\bsheltors?\b/g, 'shelter'],
  [/\bsheltores?\b/g, 'shelter'],
  [/\bnewpapers?\b/g, 'newspaper'],
  [/\bpamplets?\b/g, 'pamphlet'],
  [/\bpanphlets?\b/g, 'pamphlet'],
  [/\bpamplates?\b/g, 'pamphlet'],
  [/\bbuss(es)?\b/g, 'bus'],
  [/\bmobles?\b/g, 'mobile'],
  [/\bmoblile\b/g, 'mobile'],
  [/\bmetors?\b/g, 'metro'],
  [/\bmetroo\b/g, 'metro'],
  [/\bpolise\b/g, 'police'],
  [/\bpollice\b/g, 'police'],
  [/\bpoilece\b/g, 'police'],
  [/\bsignel\b/g, 'signal'],
  [/\bsignals?\b/g, 'signal'],
  [/\belevetaed\b/g, 'elevated'],
  [/\beleveted\b/g, 'elevated'],
  [/\bundergorund\b/g, 'underground'],
  [/\bfrontlight\b/g, 'frontlit'],
  [/\bfront\s*lit\b/g, 'frontlit'],
  [/\bnon\s*lit\b/g, 'nonlit'],
  [/\bnot\s*lit\b/g, 'nonlit'],
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
