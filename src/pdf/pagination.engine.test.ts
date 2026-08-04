/**
 * Unit checks for the PDF pagination engine (O(n) packing).
 * Run: npx tsx src/pdf/pagination.engine.test.ts
 */

import { paginateTableRows, classifyFit, packOverfillSlack } from './pagination';
import { DEFAULT_PAGE_GEOMETRY, PACK_OVERFILL_SLACK_PT } from './constants';
import { dynamicSafetyMargin, countServiceIdWrappedLines } from './utils';
import type { MeasuredUnit, PageChromeHeights } from './types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const chrome: PageChromeHeights = {
  footerReserve: 0,
  companyHeader: 200,
  clientDetails: 60,
  sectionHeading: 50,
  tableHeader: 70,
  totals: 80,
};

function makeRows(count: number, height: number): MeasuredUnit<number>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    height,
    data: i,
  }));
}

assert(dynamicSafetyMargin(38) === 2, 'small safety');
assert(dynamicSafetyMargin(50) === 4, 'medium safety');
assert(dynamicSafetyMargin(58) === 4, 'medium safety 2-line unit');
assert(dynamicSafetyMargin(70) === 6, 'large safety');
assert(classifyFit(40, 50, 40) === 'Fits', 'soft fit');
assert(classifyFit(40, 44, 40) === 'Fits', 'soft pack leftover gap');
assert(classifyFit(40, 28, 40) === 'Fits', 'overfill slack allows near miss');
assert(classifyFit(40, 27, 40) === 'NewPage', 'must break');

assert(packOverfillSlack(40) === PACK_OVERFILL_SLACK_PT, 'short slack fixed');
assert(packOverfillSlack(100) === PACK_OVERFILL_SLACK_PT, 'tall slack same (no over-pack)');
assert(classifyFit(100, 88, 100) === 'Fits', 'tall row packs when leftover is real');
assert(classifyFit(100, 80, 100) === 'NewPage', 'tall row moves when truly cannot fit');

// Tall rows on page 1 must pack a second tall row when body room exists
{
  const tallChrome: PageChromeHeights = {
    footerReserve: 0,
    companyHeader: 200,
    clientDetails: 60,
    sectionHeading: 50,
    tableHeader: 70,
    totals: 80,
  };
  const tall = makeRows(4, 150);
  const tallPages = paginateTableRows({
    geometry: DEFAULT_PAGE_GEOMETRY,
    chrome: tallChrome,
    continuationChrome: { companyHeader: 0, clientDetails: 0, sectionHeading: 0 },
    rows: tall,
    options: { minRowsPerPage: 2, repeatCompanyHeaderOnContinuation: false },
  });
  assert(tallPages[0].rows.length >= 2, `tall page1 should pack ≥2 rows, got ${tallPages[0].rows.length}`);
  console.log('tall-row pack: OK', {
    pages: tallPages.length,
    rowsPerPage: tallPages.map((p) => p.rows.length),
  });
}

assert(
  countServiceIdWrappedLines(
    'Police-Booth-Chennai',
    92,
    { fontSize: 14, avgCharWidthFactor: 0.5 },
  ) <=
    countServiceIdWrappedLines(
      'Police Booth Chennai',
      92,
      { fontSize: 14, avgCharWidthFactor: 0.5 },
    ) + 2,
  'kebab wrap sane',
);

// Page body ≈ 841.89 - 27 - 32 = 782.89
// First page available ≈ 782.89 - 200 - 60 - 50 - 70 = 402.89 → 10×40
// Continuation (no company header): 782.89 - 70 = 712.89 → 17×40
const rows = makeRows(25, 40);

const pages = paginateTableRows({
  geometry: DEFAULT_PAGE_GEOMETRY,
  chrome,
  continuationChrome: {
    companyHeader: 0,
    clientDetails: 0,
    sectionHeading: 0,
  },
  rows,
  options: {
    minRowsPerPage: 2,
    repeatCompanyHeaderOnContinuation: false,
    debug: false,
  },
});

assert(pages.length >= 2, `expected multiple pages, got ${pages.length}`);
assert(pages[0].showCompanyHeader === true, 'first page shows company header');
assert(pages[0].showClientDetails === true, 'first page shows client');
assert(pages[0].showSectionHeading === true, 'first page shows section');
assert(pages[0].showTableHeader === true, 'first page shows thead');

for (let i = 1; i < pages.length; i++) {
  assert(pages[i].showCompanyHeader === false, `page ${i + 1} must not show company`);
  assert(pages[i].showClientDetails === false, `page ${i + 1} must not show client`);
  assert(pages[i].showSectionHeading === false, `page ${i + 1} must not show section`);
  assert(pages[i].showTableHeader === true, `page ${i + 1} must show thead`);
}

const last = pages[pages.length - 1];
assert(last.showTotals === true, 'last page shows totals');
assert(
  pages.slice(0, -1).every((p) => !p.showTotals),
  'non-last pages must not show totals',
);

const totalRows = pages.reduce((n, p) => n + p.rows.length, 0);
assert(totalRows === 25, `row count mismatch: ${totalRows}`);

// Fill: non-last pages should not leave large gaps (skip page before totals —
// that page intentionally holds back the last row(s) for keep-with-totals).
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  if (p.isLastPage || p.showTotals) continue;
  if (pages[i + 1]?.showTotals) continue;
  const slack = p.availableBodyHeight - p.usedBodyHeight;
  assert(slack < 40 * 1.6 + 0.01, `page ${p.pageNumber} left too much slack (${slack})`);
}

console.log('pagination.engine.test.ts: OK', {
  pages: pages.length,
  rowsPerPage: pages.map((p) => p.rows.length),
  continuationHasCompany: pages.slice(1).map((p) => p.showCompanyHeader),
});

// --- Keep last row with totals (never thead + totals alone) ---
{
  // First page can fit a few rows but not last-row+totals; next page must
  // get the trailing row(s) together with totals.
  const shortChrome: PageChromeHeights = {
    footerReserve: 0,
    companyHeader: 400,
    clientDetails: 80,
    sectionHeading: 50,
    tableHeader: 70,
    totals: 100,
  };
  // available page1 ≈ 782 - 400 - 80 - 50 - 70 - 12buf = 170 → ~4×40
  // last row + totals = 140 — if 4 rows packed without totals room, companion peels
  const many = makeRows(5, 40);
  const pgs = paginateTableRows({
    geometry: DEFAULT_PAGE_GEOMETRY,
    chrome: shortChrome,
    continuationChrome: { companyHeader: 0, clientDetails: 0, sectionHeading: 0 },
    rows: many,
    options: { minRowsPerPage: 2, repeatCompanyHeaderOnContinuation: false },
  });
  const last = pgs[pgs.length - 1];
  assert(last.showTotals === true, 'companion case: last has totals');
  assert(last.rows.length >= 1, 'companion case: totals page has ≥1 data row');
  assert(
    pgs.every((p) => !(p.showTotals && p.rows.length === 0)),
    'never thead+totals with zero rows',
  );
  // Prefer filling earlier pages: with room for 3 body rows on page 1,
  // we should not peel a second companion onto the totals page.
  assert(pgs[0].rows.length >= 3, `page1 should keep ≥3 rows, got ${pgs[0].rows.length}`);
  console.log('keep-with-totals: OK', {
    pages: pgs.length,
    rowsPerPage: pgs.map((p) => p.rows.length),
    lastRows: last.rows.length,
  });
}
