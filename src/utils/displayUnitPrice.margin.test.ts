/**
 * Day-wise unit price preference + package margin helpers.
 * Run: npx tsx src/utils/displayUnitPrice.margin.test.ts
 */
import {
  minSellingForMargin,
  computePackageCost,
  computePackageSell,
  isPackageMarginOk,
  resolveDisplayUnitCostPerDay,
  resolveDisplayUnitPricePerDay,
} from './marginUtils';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Prefer display_unit_price_per_day over display_price
assert(
  resolveDisplayUnitPricePerDay(
    { display_unit_price_per_day: 1523.53, display_price: 75000 },
    {},
  ) === 1523.53,
  'prefer unit price per day',
);
assert(
  resolveDisplayUnitPricePerDay({ display_price: 75000 }, {}) === 75000,
  'fallback to display_price',
);

assert(
  resolveDisplayUnitCostPerDay({
    display_unit_cost_per_day: 3000,
    display_cost: 90000,
    display_cost_measurement_unit: 'MONTH',
  }) === 3000,
  'prefer unit cost per day',
);

// Package: Edayarpalayam numbers
const pkg = {
  quantity: 1,
  durationDays: 30,
  displayDailyRate: 3608.82,
  pfUnitRate: 13500,
  displayUnitCostPerDay: 3000,
  pfUnitCost: 13500,
};
assert(computePackageCost(pkg) === 103500, 'package cost');
assert(Math.abs(computePackageSell(pkg) - 121764.6) < 1, 'package sell');
assert(isPackageMarginOk(computePackageSell(pkg), computePackageCost(pkg)), 'margin ~15% ok');

// Cut display to monthly 100000 → daily 100000/30
const cut = { ...pkg, displayDailyRate: 100000 / 30 };
assert(isPackageMarginOk(computePackageSell(cut), computePackageCost(cut)), '100k/mo ok');

// Below 4% package floor: sell at cost → 0% margin
const low = { ...pkg, displayDailyRate: 90000 / 30 }; // 90k + 13.5k = 103.5k
assert(!isPackageMarginOk(computePackageSell(low), computePackageCost(low)), 'at cost blocked');

const minSell = minSellingForMargin(103500);
assert(Math.abs(minSell - 103500 / 0.96) < 1e-6, 'package 4% floor');

console.log('displayUnitPrice.margin tests passed');
