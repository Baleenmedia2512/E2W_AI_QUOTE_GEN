/**
 * Cost ₹850 → min sell ≈ ₹885; ₹200 must fail; ₹900 ok.
 * Run: npx tsx src/utils/pfCost850.test.ts
 */
import {
  minSellingForMargin,
  resolvePfCostFloor,
  isPackageMarginOk,
  computePackageCost,
  computePackageSell,
} from './marginUtils';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const minSell = minSellingForMargin(850);
assert(Math.abs(minSell - 850 / 0.96) < 1e-9, 'min sell formula');
assert(minSell > 885 && minSell < 886, `minSell≈885.42 got ${minSell}`);
assert(200 < minSell, '₹200 below floor');
assert(900 >= minSell, '₹900 above floor');

assert(
  resolvePfCostFloor({ printing_and_mounting_cost: 850 }) === 850,
  'plain cost',
);
assert(
  resolvePfCostFloor({ printing_and_mounting_cost: '₹850' }) === 850,
  'rupee string cost',
);
assert(
  resolvePfCostFloor({
    pricing: { printing_and_mounting_cost: '850' },
  }) === 850,
  'pricing nested',
);
assert(
  resolvePfCostFloor({ printingAndMountingCost: 850 }) === 850,
  'camelCase',
);

const pkg = {
  quantity: 50,
  durationDays: 0,
  displayDailyRate: 0,
  pfUnitRate: 200,
  displayUnitCostPerDay: null as number | null,
  pfUnitCost: 850,
};
assert(computePackageCost(pkg) === 42500, 'cost total');
assert(computePackageSell(pkg) === 10000, 'sell total');
assert(
  !isPackageMarginOk(computePackageSell(pkg), computePackageCost(pkg)),
  '₹200 must fail margin',
);

const okPkg = { ...pkg, pfUnitRate: 900 };
assert(
  isPackageMarginOk(computePackageSell(okPkg), computePackageCost(okPkg)),
  '₹900 must pass margin',
);

console.log('pfCost850.test.ts: all passed');
