/**
 * P&F-only margin / catalog floor cascade (mirrors validatePfOnlyRate).
 * Run: npx tsx src/utils/pfOnlyMargin.test.ts
 */
import { minSellingForMargin, isPackageMarginOk, computePackageCost, computePackageSell } from './marginUtils';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Cost = sell → 0% margin → not ok
assert(!isPackageMarginOk(100, 100), '0% margin fails');
assert(!isPackageMarginOk(100, 97), '3% margin fails');
assert(isPackageMarginOk(100, 96), '4% margin ok');

// Package P&F-only: qty 50, rate 2, cost 100/unit
const pkg = {
  quantity: 50,
  durationDays: 0,
  displayDailyRate: 0,
  pfUnitRate: 2,
  displayUnitCostPerDay: null as number | null,
  pfUnitCost: 100,
};
assert(computePackageCost(pkg) === 5000, 'pf cost');
assert(computePackageSell(pkg) === 100, 'pf sell');
assert(!isPackageMarginOk(computePackageSell(pkg), computePackageCost(pkg)), '₹2 below margin');

// Catalog selling floor fallback
const catalog = 100;
const edited = 2;
assert(edited < catalog, 'below catalog selling');
const minFromCost = minSellingForMargin(100);
assert(minFromCost > 100, '4% above cost 100');
assert(2 < minFromCost, '₹2 below cost+margin floor');

console.log('pfOnlyMargin.test.ts: all passed');
