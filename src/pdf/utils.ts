/**
 * Low-level PDF measurement utilities (pure, O(n) over characters / lines).
 */

import type { TextMeasureStyle } from './types';
import {
  SAFETY_MARGIN_LARGE_PT,
  SAFETY_MARGIN_MEDIUM_PT,
  SAFETY_MARGIN_SMALL_PT,
  SAFETY_ROW_MEDIUM_MAX_PT,
  SAFETY_ROW_SMALL_MAX_PT,
} from './constants';
import { hyphenateLongWords } from '../utils/hyphenateLongWords';

/** Usable content width inside page padding. */
export function contentWidth(geometry: {
  pageWidth: number;
  paddingLeft: number;
  paddingRight: number;
}): number {
  return geometry.pageWidth - geometry.paddingLeft - geometry.paddingRight;
}

/** Usable content height inside page padding (before chrome). */
export function contentHeight(geometry: {
  pageHeight: number;
  paddingTop: number;
  paddingBottom: number;
}): number {
  return geometry.pageHeight - geometry.paddingTop - geometry.paddingBottom;
}

/**
 * Estimate wrapped line count for a string in a fixed column.
 * Does not hyphenate mid-word; breaks on whitespace or explicit soft points.
 * Explicit `\n` is always a hard line break.
 */
export function countWrappedLines(
  text: string,
  maxWidth: number,
  style: Pick<TextMeasureStyle, 'fontSize' | 'avgCharWidthFactor'>,
): number {
  const raw = (text ?? '').trim();
  if (!raw) return 1;

  const avgChar = Math.max(0.01, style.fontSize * style.avgCharWidthFactor);
  // floor → fewer chars/line → more lines → safer (never under-measure wrap)
  const charsPerLine = Math.max(1, Math.floor(maxWidth / avgChar));

  let totalLines = 0;
  const paragraphs = raw.split('\n');

  for (const para of paragraphs) {
    const segment = para.trim();
    if (!segment) {
      totalLines += 1;
      continue;
    }

    const tokens = segment.split(/(\s+|-)/).filter((t) => t.length > 0);
    let lines = 1;
    let col = 0;

    for (const token of tokens) {
      const len = token.length;
      if (col === 0 && len > charsPerLine) {
        const used = Math.ceil(len / charsPerLine);
        lines += used - 1;
        col = len % charsPerLine;
        if (col === 0) {
          lines += 1;
        }
        continue;
      }
      if (col + len > charsPerLine) {
        lines += 1;
        col = /^\s+$/.test(token) ? 0 : len;
      } else {
        col += len;
      }
    }

    totalLines += Math.max(1, lines);
  }

  return Math.max(1, totalLines);
}

/**
 * Match CorporateMinimalPDF `ServiceIdText`: hyphen-break words longer than 13 chars,
 * then wrap on kebab segments / whitespace. Falls back to normal wrap when
 * there are no hyphens.
 */
export function countServiceIdWrappedLines(
  text: string,
  maxWidth: number,
  style: Pick<TextMeasureStyle, 'fontSize' | 'avgCharWidthFactor'>,
): number {
  const raw = hyphenateLongWords((text ?? '').trim());
  if (!raw) return 1;

  // Hard newlines from long-word breaks — measure each line and sum.
  if (raw.includes('\n')) {
    let total = 0;
    for (const line of raw.split('\n')) {
      total += countServiceIdWrappedLines(line, maxWidth, style);
    }
    return Math.max(1, total);
  }

  const parts = raw.split('-').filter((p) => p.length > 0);
  if (parts.length <= 1) {
    return countWrappedLines(raw, maxWidth, style);
  }

  const avgChar = Math.max(0.01, style.fontSize * style.avgCharWidthFactor);
  const charsPerLine = Math.max(1, Math.floor(maxWidth / avgChar));

  let lines = 1;
  let col = 0;
  for (let i = 0; i < parts.length; i++) {
    const seg = i < parts.length - 1 ? `${parts[i]}-` : parts[i];
    const len = seg.length;
    if (col === 0) {
      // Segment longer than a line still occupies at least one line.
      if (len > charsPerLine) {
        lines += Math.ceil(len / charsPerLine) - 1;
        col = len % charsPerLine;
        if (col === 0) {
          lines += 1;
          col = 0;
        }
      } else {
        col = len;
      }
      continue;
    }
    if (col + len > charsPerLine) {
      lines += 1;
      col = len > charsPerLine ? len % charsPerLine || charsPerLine : len;
      if (len > charsPerLine) {
        lines += Math.ceil(len / charsPerLine) - 1;
      }
    } else {
      col += len;
    }
  }

  return Math.max(1, lines);
}

/** Height of N text lines given fontSize × lineHeight. */
export function textBlockHeight(
  lineCount: number,
  style: Pick<TextMeasureStyle, 'fontSize' | 'lineHeight'>,
): number {
  return Math.max(1, lineCount) * style.fontSize * style.lineHeight;
}

/**
 * Height of a stacked cell (value + optional unit label) including vertical padding.
 */
export function measureStackedCellHeight(args: {
  primaryText: string;
  primaryStyle: TextMeasureStyle;
  secondaryText?: string | null;
  secondaryStyle?: TextMeasureStyle;
  paddingVertical: number;
  columnWidth: number;
  /** Use kebab-segment wrap (SERVICE & LOCATION) instead of generic wrap. */
  primaryWrap?: 'default' | 'serviceId';
}): number {
  const padX = args.primaryStyle.paddingHorizontal ?? 0;
  const innerW = Math.max(1, args.columnWidth - padX * 2);

  const primaryLines =
    args.primaryWrap === 'serviceId'
      ? countServiceIdWrappedLines(args.primaryText, innerW, args.primaryStyle)
      : countWrappedLines(args.primaryText, innerW, args.primaryStyle);
  let h = textBlockHeight(primaryLines, args.primaryStyle);

  if (args.secondaryText && args.secondaryStyle) {
    const secPad = args.secondaryStyle.paddingHorizontal ?? padX;
    const secW = Math.max(1, args.columnWidth - secPad * 2);
    const secLines = countWrappedLines(args.secondaryText, secW, args.secondaryStyle);
    h += 1; // marginTop between value and unit
    h += textBlockHeight(secLines, args.secondaryStyle);
  }

  return h + args.paddingVertical * 2;
}

/** Clamp a measured height to a minimum (e.g. CSS minHeight). */
export function atLeast(height: number, minHeight: number): number {
  return Math.max(height, minHeight);
}

/** Sum heights in O(n). */
export function sumHeights(heights: number[]): number {
  let total = 0;
  for (let i = 0; i < heights.length; i++) total += heights[i];
  return total;
}

/**
 * Dynamic safety margin by row height band.
 * Small / medium / large — kept modest so leftover page gap can take 1–2 more rows.
 */
export function dynamicSafetyMargin(rowHeight: number): number {
  if (rowHeight <= SAFETY_ROW_SMALL_MAX_PT) return SAFETY_MARGIN_SMALL_PT;
  if (rowHeight <= SAFETY_ROW_MEDIUM_MAX_PT) return SAFETY_MARGIN_MEDIUM_PT;
  return SAFETY_MARGIN_LARGE_PT;
}
