/**
 * Catalog-driven matching helpers for direction_remarks.
 *
 * This intentionally contains no landmark, city, or service aliases. It only
 * makes user formatting comparable with the exact values stored in the DB.
 */

export interface DirectionKey {
  spaced: string;
  compact: string;
  words: string[];
}

const GENERIC_DIRECTION_WORDS = new Set([
  'at',
  'area',
  'for',
  'direction',
  'feet',
  'get',
  'i',
  'location',
  'looking',
  'main',
  'need',
  'near',
  'opposite',
  'place',
  'please',
  'road',
  'site',
  'signal',
  'street',
  'the',
  'to',
  'towards',
  'want',
  'with',
]);

export function directionKeys(value: string): DirectionKey {
  const spaced = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\w\s]+/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    spaced,
    compact: spaced.replace(/\s/g, ''),
    words: spaced.split(' ').filter(Boolean),
  };
}

function meaningfulWords(words: string[]): string[] {
  return words.filter(
    (word) => word.length >= 3 && !GENERIC_DIRECTION_WORDS.has(word),
  );
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(diagonal, previous[j - 1], above) + 1;
      diagonal = above;
    }
  }

  return previous[b.length];
}

/**
 * Scores a user direction against one DB direction.
 *
 * Scores below 0.86 are intentionally not considered strong matches. The
 * compact-key comparison handles spacing/ punctuation differences, while the
 * bounded edit-distance fallback handles only small catalog-safe typos.
 */
export function scoreDirectionMatch(
  query: string,
  catalogDirection: string,
  ignoredQueryWords: ReadonlySet<string> = new Set(),
): number {
  const q = directionKeys(query);
  const d = directionKeys(catalogDirection);
  const qWords = meaningfulWords(q.words).filter((word) => !ignoredQueryWords.has(word));
  const dWords = meaningfulWords(d.words);

  if (!q.compact || !d.compact || qWords.length === 0 || dWords.length === 0) {
    return 0;
  }

  // Single-word sites are valid when they are distinctive enough; generic
  // words such as "road" were removed above and cannot match alone.
  if (
    (qWords.length === 1 || dWords.length === 1)
    && (qWords.length !== 1 || qWords[0].length < 5)
    && (dWords.length !== 1 || dWords[0].length < 5)
  ) {
    return 0;
  }

  if (q.spaced === d.spaced) return 1;
  if (q.compact === d.compact) return 0.98;

  // A longer user sentence may contain the catalog direction after removing
  // punctuation and spacing (for example, "need ... near Gemini Fly Over").
  const qMeaningfulCompact = qWords.join('');
  const dMeaningfulCompact = dWords.join('');
  if (
    qWords.length >= 2
    && dWords.length >= 2
    && (
      qMeaningfulCompact.includes(dMeaningfulCompact)
      || dMeaningfulCompact.includes(qMeaningfulCompact)
    )
  ) {
    return 0.97;
  }

  // Compact containment can still succeed when DB has a compound token
  // ("flyover") and the user typed spaced tokens ("fly" + "over").
  if (
    qMeaningfulCompact.length >= 8
    && dMeaningfulCompact.length >= 8
    && (
      qMeaningfulCompact.includes(dMeaningfulCompact)
      || dMeaningfulCompact.includes(qMeaningfulCompact)
    )
  ) {
    return 0.96;
  }

  // Landmark tokens may be a subset of a longer DB direction/area label.
  const matchedWords = dWords.filter((word) =>
    qWords.includes(word)
    || qMeaningfulCompact.includes(word)
    || qWords.some((qw) => word.includes(qw) && qw.length >= 4),
  );
  const landmarkHits = matchedWords.length;
  if (landmarkHits >= 2) {
    return 0.92;
  }
  if (
    landmarkHits === 1
    && matchedWords[0].length >= 6
    && qWords.length <= 4
  ) {
    return 0.88;
  }
  const wordScore = landmarkHits / Math.max(qWords.length, dWords.length);
  if (landmarkHits >= 2 && wordScore >= 0.8) {
    return 0.9;
  }

  // Keep fuzzy matching conservative and only compare similarly shaped,
  // multi-word directions.
  if (qWords.length !== dWords.length) return 0;
  if (qWords.length === 1 && dWords.length === 1) {
    if (qWords[0].length < 5 || dWords[0].length < 5) return 0;
  }
  const maxDistance = Math.max(1, Math.floor(Math.min(q.compact.length, d.compact.length) * 0.12));
  const distance = levenshteinDistance(q.compact, d.compact);
  return distance <= maxDistance ? 0.87 : 0;
}

export function isStrongDirectionMatch(score: number): boolean {
  return score >= 0.86;
}
