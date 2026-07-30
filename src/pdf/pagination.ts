/**
 * Table pagination engine — O(n) aggressive pack of measured rows into pages.
 *
 * Fit rule (safe but tight):
 *   remaining = available - used
 *   if nextRow <= remaining - safetyMargin  → Fits
 *   else if nextRow <= remaining            → FitsAggressive (one more row)
 *   else                                    → NewPage
 *
 * Continuation pages reserve thead + footer only (no company / client / title)
 * unless `repeatCompanyHeaderOnContinuation` is enabled.
 */

import { DEFAULT_PAGINATION_OPTIONS, PAGE_PACKING_BUFFER_PT } from './constants';
import { availableBodyHeight } from './measure';
import type {
  BuiltTablePage,
  MeasuredUnit,
  PageChromeHeights,
  PaginationDebugEvent,
  PaginateTableInput,
  PaginationOptions,
} from './types';
import { dynamicSafetyMargin } from './utils';

function resolveOptions(partial?: Partial<PaginationOptions>): PaginationOptions {
  return {
    ...DEFAULT_PAGINATION_OPTIONS,
    ...partial,
  };
}

function pageFlags(pageNumber: number, opts: PaginationOptions) {
  const isFirstPage = pageNumber === 1;
  return {
    isFirstPage,
    showCompanyHeader: isFirstPage || opts.repeatCompanyHeaderOnContinuation,
    showClientDetails: isFirstPage,
    showSectionHeading: isFirstPage,
    showTableHeader: true,
  };
}

function chromeForPage<TRow>(
  input: PaginateTableInput<TRow>,
  pageNumber: number,
): PageChromeHeights {
  if (pageNumber === 1 || !input.continuationChrome) {
    return input.chrome;
  }
  return {
    ...input.chrome,
    ...input.continuationChrome,
    clientDetails: input.continuationChrome.clientDetails ?? 0,
    sectionHeading: input.continuationChrome.sectionHeading ?? 0,
    companyHeader:
      input.continuationChrome.companyHeader ??
      (input.options?.repeatCompanyHeaderOnContinuation
        ? input.chrome.companyHeader
        : 0),
  };
}

function bodyCapacity(
  input: PaginateTableInput<unknown>,
  pageNumber: number,
  opts: PaginationOptions,
): number {
  const flags = pageFlags(pageNumber, opts);
  const raw = availableBodyHeight({
    geometry: input.geometry,
    chrome: chromeForPage(input, pageNumber),
    ...flags,
  });
  // Never pack into the last ~PAGE_PACKING_BUFFER_PT — prevents React-PDF
  // from spawning headerless overflow pages when Yoga is taller than estimate.
  return Math.max(0, raw - PAGE_PACKING_BUFFER_PT);
}

function logDecision(opts: PaginationOptions, event: PaginationDebugEvent): void {
  if (!opts.debug) return;
  // eslint-disable-next-line no-console
  console.log('[pdf-pagination]', {
    page: event.pageNumber,
    available: round2(event.availableHeight),
    used: round2(event.usedHeight),
    remaining: round2(event.remainingHeight),
    currentRow: round2(event.currentRowHeight),
    nextRow: event.nextRowHeight == null ? null : round2(event.nextRowHeight),
    safetyMargin: event.safetyMargin,
    decision: event.decision,
    rowId: event.rowId,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type FitKind = 'Fits' | 'NewPage';

/**
 * Place only when the block fits under the dynamic safety margin.
 * No "aggressive" zero-margin fit — that caused React-PDF overflow pages
 * with a single row and no table header.
 */
export function classifyFit(need: number, remaining: number, rowHeightForMargin: number): FitKind {
  const margin = dynamicSafetyMargin(rowHeightForMargin);
  if (need <= remaining - margin) return 'Fits';
  return 'NewPage';
}

export function paginateTableRows<TRow>(
  input: PaginateTableInput<TRow>,
): BuiltTablePage<TRow>[] {
  const opts = resolveOptions(input.options);
  const rows = input.rows;
  const n = rows.length;
  const pages: BuiltTablePage<TRow>[] = [];
  const totalsH = input.chrome.totals;

  if (n === 0) {
    const flags = pageFlags(1, opts);
    const available = bodyCapacity(input, 1, opts);
    pages.push({
      pageNumber: 1,
      isLastPage: true,
      ...flags,
      showTotals: true,
      rowStartIndex: 0,
      rows: [],
      availableBodyHeight: available,
      usedBodyHeight: totalsH,
    });
    return pages;
  }

  let index = 0;

  while (index < n) {
    const pageNumber = pages.length + 1;
    const flags = pageFlags(pageNumber, opts);
    const available = bodyCapacity(input, pageNumber, opts);
    const pageRows: MeasuredUnit<TRow>[] = [];
    const rowStartIndex = index;
    let used = 0;

    while (index < n) {
      const row = rows[index];
      const remaining = available - used;
      const next = index + 1 < n ? rows[index + 1] : null;
      const remainingAfterThis = n - index - 1;
      const wouldFinishRows = remainingAfterThis === 0;
      const margin = dynamicSafetyMargin(row.height);

      // Need: row alone, or row+totals when this placement finishes the table.
      const needWithTotals = row.height + totalsH;
      const tryWithTotals = wouldFinishRows;
      const need = tryWithTotals ? needWithTotals : row.height;

      let decision = classifyFit(need, remaining, row.height);

      // Last row + totals don't fit together: do NOT leave the row here and
      // orphan totals on the next page. Keep the row for the next page with totals.
      if (tryWithTotals && decision === 'NewPage') {
        if (pageRows.length === 0) {
          // Page is empty — forced to place the oversized last row; totals follow.
          logDecision(opts, {
            pageNumber,
            availableHeight: available,
            usedHeight: used,
            remainingHeight: remaining,
            currentRowHeight: row.height,
            nextRowHeight: null,
            safetyMargin: margin,
            decision: 'ForceOversized',
            rowId: row.id,
          });
          pageRows.push(row);
          used += row.height;
          index += 1;
        } else {
          logDecision(opts, {
            pageNumber,
            availableHeight: available,
            usedHeight: used,
            remainingHeight: remaining,
            currentRowHeight: row.height,
            nextRowHeight: null,
            safetyMargin: margin,
            decision: 'NewPage',
            rowId: row.id,
          });
        }
        break;
      }

      if (decision === 'NewPage') {
        if (pageRows.length === 0) {
          logDecision(opts, {
            pageNumber,
            availableHeight: available,
            usedHeight: used,
            remainingHeight: remaining,
            currentRowHeight: row.height,
            nextRowHeight: next?.height ?? null,
            safetyMargin: margin,
            decision: 'ForceOversized',
            rowId: row.id,
          });
          pageRows.push(row);
          used += row.height;
          index += 1;
        } else {
          logDecision(opts, {
            pageNumber,
            availableHeight: available,
            usedHeight: used,
            remainingHeight: remaining,
            currentRowHeight: row.height,
            nextRowHeight: next?.height ?? null,
            safetyMargin: margin,
            decision: 'NewPage',
            rowId: row.id,
          });
        }
        break;
      }

      logDecision(opts, {
        pageNumber,
        availableHeight: available,
        usedHeight: used,
        remainingHeight: remaining,
        currentRowHeight: row.height,
        nextRowHeight: next?.height ?? null,
        safetyMargin: margin,
        decision,
        rowId: row.id,
      });

      pageRows.push(row);
      used += row.height;
      index += 1;

      if (wouldFinishRows) break;
    }

    const canFitTotals = index >= n && used + totalsH <= available;
    const showTotals = canFitTotals;

    pages.push({
      pageNumber,
      isLastPage: showTotals,
      ...flags,
      showTotals,
      rowStartIndex,
      rows: pageRows,
      availableBodyHeight: available,
      usedBodyHeight: used + (showTotals ? totalsH : 0),
    });

    // Totals need their own page — always carry ≥1 trailing data row with them
    // (never render thead + totals alone).
    if (index >= n && !showTotals) {
      const prevPage = pages[pages.length - 1];
      const companion: MeasuredUnit<TRow>[] = [];
      let companionH = totalsH;
      // Only 1 trailing row is required with totals (ERP keep-with-next).
      // Pulling minRows (2+) here left page 1 half-empty.
      const wantCompanions = 1;

      // Capacity for the upcoming totals page (continuation chrome).
      const peekTotalsPageNumber = pages.length + 1;
      const totalsAvailable = bodyCapacity(input, peekTotalsPageNumber, opts);

      while (
        prevPage.rows.length > 0 &&
        companion.length < wantCompanions
      ) {
        if (prevPage.rows.length <= 1 && companion.length >= 1) break;

        const candidate = prevPage.rows[prevPage.rows.length - 1];
        const margin = dynamicSafetyMargin(candidate.height);
        if (companionH + candidate.height > totalsAvailable - margin) {
          if (
            companion.length === 0 &&
            companionH + candidate.height <= totalsAvailable
          ) {
            prevPage.rows.pop();
            companion.unshift(candidate);
            companionH += candidate.height;
            prevPage.usedBodyHeight -= candidate.height;
          }
          break;
        }

        prevPage.rows.pop();
        companion.unshift(candidate);
        companionH += candidate.height;
        prevPage.usedBodyHeight -= candidate.height;
      }

      if (prevPage.rows.length === 0) {
        pages.pop();
      } else {
        prevPage.isLastPage = false;
        prevPage.showTotals = false;
      }

      const totalsFlags = pageFlags(pages.length + 1, opts);
      pages.push({
        pageNumber: pages.length + 1,
        isLastPage: true,
        ...totalsFlags,
        showTotals: true,
        rowStartIndex: n - companion.length,
        rows: companion,
        availableBodyHeight: bodyCapacity(input, pages.length + 1, opts),
        usedBodyHeight: companionH,
      });
    }
  }

  applyWidowOrphanControl(pages, input, opts);
  return pages;
}

/**
 * Widow/orphan control:
 * - Absorb a short final page into the previous when height allows (fill).
 * - If a non-final page would leave the next page with &lt; minRows, peel the
 *   last row(s) forward so the next page starts with ≥ minRows (when possible).
 * - Attach totals-only last page to previous when room exists.
 *
 * O(pages × minRows).
 */
function applyWidowOrphanControl<TRow>(
  pages: BuiltTablePage<TRow>[],
  input: PaginateTableInput<TRow>,
  opts: PaginationOptions,
): void {
  const minRows = Math.max(1, opts.minRowsPerPage);
  if (pages.length < 2) return;

  const totalsH = input.chrome.totals;

  // 1) Absorb short last page into previous only when the WHOLE last page
  //    (rows + totals) fits — do not require minRows on the totals page.
  {
    const lastIdx = pages.length - 1;
    const last = pages[lastIdx];
    const prev = pages[lastIdx - 1];
    if (last.showTotals && last.rows.length > 0 && prev.rows.length > 0) {
      const moveH = last.rows.reduce((s, r) => s + r.height, 0);
      const prevBody =
        prev.usedBodyHeight - (prev.showTotals ? totalsH : 0);
      const needed = prevBody + moveH + totalsH;
      if (needed <= prev.availableBodyHeight) {
        prev.rows.push(...last.rows);
        prev.usedBodyHeight = needed;
        prev.showTotals = true;
        prev.isLastPage = true;
        pages.pop();
      }
    }
  }

  if (pages.length < 2) return;

  // 2) Totals-only last page → attach to previous if room.
  {
    const lastIdx = pages.length - 1;
    const last = pages[lastIdx];
    const prev = pages[lastIdx - 1];
    if (last.showTotals && last.rows.length === 0) {
      const prevBody =
        prev.usedBodyHeight - (prev.showTotals ? totalsH : 0);
      if (prevBody + totalsH <= prev.availableBodyHeight) {
        prev.showTotals = true;
        prev.isLastPage = true;
        prev.usedBodyHeight = prevBody + totalsH;
        pages.pop();
      }
    }
  }

  if (pages.length < 2) return;

  // 3) Avoid a continuation page with a single orphan row — but NEVER peel
  //    extra rows onto a totals page that already has ≥1 companion row.
  //    That was emptying page 1 to satisfy minRows on the totals page.
  for (let p = 1; p < pages.length; p++) {
    const prev = pages[p - 1];
    const cur = pages[p];
    if (cur.rows.length === 0) continue;
    if (cur.showTotals && cur.rows.length >= 1) continue;
    if (cur.rows.length >= minRows) continue;
    if (prev.rows.length <= minRows) continue;

    while (cur.rows.length < minRows && prev.rows.length > minRows) {
      const donor = prev.rows[prev.rows.length - 1];
      const curBody =
        cur.usedBodyHeight - (cur.showTotals ? totalsH : 0) + donor.height;
      if (curBody + (cur.showTotals ? totalsH : 0) > cur.availableBodyHeight) {
        break;
      }
      prev.rows.pop();
      cur.rows.unshift(donor);
      cur.rowStartIndex = Math.max(0, cur.rowStartIndex - 1);
      prev.usedBodyHeight -= donor.height;
      cur.usedBodyHeight += donor.height;
    }
  }
}
