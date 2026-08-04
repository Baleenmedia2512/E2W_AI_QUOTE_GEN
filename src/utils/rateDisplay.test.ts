import {
  formatRecurringRateUnitLabel,
  formatUnitRateDisplay,
  formatUnitRateInr,
  roundRate2,
} from './rateDisplay';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(formatUnitRateDisplay(1700) === '1700', '1700');
assert(formatUnitRateDisplay(1700.0) === '1700', '1700.00');
assert(formatUnitRateDisplay(999.9) === '1000', '999.90');
assert(formatUnitRateDisplay(999.95) === '1000', '999.95');
assert(formatUnitRateDisplay(0.9) === '0.90', '0.90');
assert(formatUnitRateDisplay(1.2) === '1.20', '1.20');
assert(formatUnitRateDisplay(5) === '5.00', '5.00 small');
assert(formatUnitRateDisplay(3133.33) === '3133.33', '3133.33');
assert(formatUnitRateDisplay(1144) === '1144', '1144');
assert(formatUnitRateInr(999.9) === '₹ 1000', 'inr 999.90');
assert(roundRate2(1.205) === 1.21, 'roundRate2');
assert(
  formatRecurringRateUnitLabel('per_month', 'board') === '(per month per\nboard)',
  'per month per board wrap',
);
assert(
  formatRecurringRateUnitLabel('per_month', 'per shelter') === '(per month per\nshelter)',
  'strip per',
);
assert(
  formatRecurringRateUnitLabel('per_day', 'Screen') === '(per day per\nScreen)',
  'per day per unit',
);
assert(formatRecurringRateUnitLabel('per_month') === '(per month)', 'no unit');
assert(
  formatRecurringRateUnitLabel('per_month', 'board', { wrapUnit: false }) ===
    '(per month per board)',
  'no wrap',
);

console.log('rateDisplay tests passed');
