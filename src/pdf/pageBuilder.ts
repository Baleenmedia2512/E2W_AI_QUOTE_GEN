/**
 * Page builder — orchestrates measure → paginate → BuiltTablePage[].
 */

import { DEFAULT_PAGE_GEOMETRY } from './constants';
import { paginateTableRows } from './pagination';
import type {
  BuiltTablePage,
  MeasuredUnit,
  PageChromeHeights,
  PageGeometry,
  PaginationOptions,
} from './types';

export interface BuildTablePagesArgs<TRow> {
  rows: MeasuredUnit<TRow>[];
  chrome: PageChromeHeights;
  continuationChrome?: Partial<PageChromeHeights>;
  geometry?: PageGeometry;
  options?: Partial<PaginationOptions>;
}

/**
 * Build the list of logical pages for a measured table.
 * Callers render one React-PDF `<Page>` per entry.
 */
export function buildTablePages<TRow>(
  args: BuildTablePagesArgs<TRow>,
): BuiltTablePage<TRow>[] {
  return paginateTableRows({
    geometry: args.geometry ?? DEFAULT_PAGE_GEOMETRY,
    chrome: args.chrome,
    continuationChrome: args.continuationChrome,
    rows: args.rows,
    options: args.options,
  });
}

/**
 * Convenience: map built pages to a serializable debug snapshot (tests / logs).
 */
export function summarizeBuiltPages<TRow>(
  pages: BuiltTablePage<TRow>[],
): Array<{
  pageNumber: number;
  rowCount: number;
  showTotals: boolean;
  showClientDetails: boolean;
  usedBodyHeight: number;
  availableBodyHeight: number;
  fillRatio: number;
}> {
  return pages.map((p) => ({
    pageNumber: p.pageNumber,
    rowCount: p.rows.length,
    showTotals: p.showTotals,
    showClientDetails: p.showClientDetails,
    usedBodyHeight: p.usedBodyHeight,
    availableBodyHeight: p.availableBodyHeight,
    fillRatio:
      p.availableBodyHeight > 0 ? p.usedBodyHeight / p.availableBodyHeight : 0,
  }));
}
