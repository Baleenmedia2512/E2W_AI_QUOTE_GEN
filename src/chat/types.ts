/**
 * Phase 2 — structured parse output (AI + DB validation).
 * Turn handling stays in progressiveChatEngine until Phase 3+.
 */

import type { ProgressiveSession } from '../utils/progressiveChatEngine';

export type ParseKind =
  | 'greeting'
  | 'help'
  | 'quote'
  | 'clarify_type'
  | 'city_browse'
  | 'services_browse'
  | 'other';

/** One service clause after catalog validation (invalid → null fields). */
export interface ParsedSegment {
  /** Original clause text when batch-split. */
  raw: string;
  /** Validated catalog medium / family token; null when not in DB. */
  service: string | null;
  /** Validated metadata.city label; null when not in DB or unnamed. */
  city: string | null;
  qty: number | null;
  /** Locality / area hint (not validated against city list). */
  place: string | null;
}

export interface ParseResult {
  kind: ParseKind;
  segments: ParsedSegment[];
  /** Top-level city when not per-segment (city browse / shared city). */
  city: string | null;
  areaHint: string | null;
  directionHint: string | null;
  ambiguous: boolean;
  clarifyHint: string | null;
  qty: number | null;
  duration: string | null;
  /** local heuristics vs Gemini JSON. */
  source: 'local' | 'ai';
  originalText: string;
}

export type ParseSession = ProgressiveSession | null | undefined;
