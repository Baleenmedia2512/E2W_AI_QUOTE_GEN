/**
 * Bullet Normalization Utilities
 *
 * Centralises the regex patterns used across templates, quote grouping,
 * and Gemini parsing to detect / strip list markers (•, -, *, 1., etc.).
 *
 * Business Rule: BULLET_PREFIX_NORMALIZATION
 * See: .governance/BUSINESS_RULES.md (Part 2)
 *
 * DO NOT inline these regexes anywhere else — call the helpers below.
 */

/** Matches leading bullet glyphs (•, -, *) plus surrounding whitespace. */
const BULLET_PREFIX_RE = /^[•\-*]\s*/;

/** Matches leading list markers including numbered ("1.", "2.") and bullets. */
const LIST_PREFIX_RE = /^[•\-*\d+.\s]+/;

/** Matches a line that *starts* with a bullet glyph (no consumption). */
const BULLET_START_RE = /^[•\-*]/;

/** Matches a line that *starts* with a numbered list marker like "1." */
const NUMBERED_START_RE = /^\d+\./;

/**
 * Strip a leading bullet glyph (•, -, *) and surrounding whitespace.
 * Use for cleaning individual term lines before display.
 */
export function stripBulletPrefix(line: string): string {
  return line.replace(BULLET_PREFIX_RE, '');
}

/**
 * Strip leading list markers including bullets AND numbered prefixes
 * ("1.", "2. ", "- ", "* ", "• "). Use when normalising a term for
 * heuristic comparison (e.g. duplicate detection).
 */
export function stripListPrefix(line: string): string {
  return line.replace(LIST_PREFIX_RE, '');
}

/**
 * Returns true when the line begins with a bullet glyph or numbered marker.
 * Used by Gemini output parser to detect structured terms.
 */
export function isBulletedLine(line: string): boolean {
  return BULLET_START_RE.test(line) || NUMBERED_START_RE.test(line);
}

/**
 * Convenience: split a multi-line terms blob, strip bullet prefixes,
 * trim, and drop empty entries. Used by every quote template.
 */
export function normalizeTermsBlob(blob: string | null | undefined): string[] {
  if (!blob) return [];
  return blob
    .split('\n')
    .map((line) => stripBulletPrefix(line.trim()).trim())
    .filter(Boolean);
}
