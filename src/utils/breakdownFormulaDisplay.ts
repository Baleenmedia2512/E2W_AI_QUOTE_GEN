/** Muted spans inside pricing breakdown formula lines (per day, boards, days, etc.). */
export interface BreakdownFormulaSegment {
  text: string;
  muted: boolean;
}

/**
 * Split a breakdown formula into normal vs muted segments.
 * Muted: all parenthetical parts — (per day), (per qty), (boards), (days), …
 */
export function segmentBreakdownFormula(formula: string): BreakdownFormulaSegment[] {
  if (!formula) return [];

  const mutedRanges: Array<{ start: number; end: number }> = [];

  for (const m of formula.matchAll(/\([^)]+\)/g)) {
    if (m.index != null) mutedRanges.push({ start: m.index, end: m.index + m[0].length });
  }

  mutedRanges.sort((a, b) => a.start - b.start);

  const segments: BreakdownFormulaSegment[] = [];
  let cursor = 0;

  for (const range of mutedRanges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) {
      segments.push({ text: formula.slice(cursor, range.start), muted: false });
    }
    segments.push({ text: formula.slice(range.start, range.end), muted: true });
    cursor = range.end;
  }

  if (cursor < formula.length) {
    segments.push({ text: formula.slice(cursor), muted: false });
  }

  return segments.length > 0 ? segments : [{ text: formula, muted: false }];
}
