import {
  formatRecurringRateUnitLabel,
  formatUnitRateDisplay,
  formatUnitRateInr,
  parseRateInput,
  roundRate2,
} from './rateDisplay';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(formatUnitRateDisplay(1700) === '1,700', '1700');
assert(formatUnitRateDisplay(1700.0) === '1,700', '1700.00');
assert(formatUnitRateDisplay(999.9) === '1,000', '999.90');
assert(formatUnitRateDisplay(999.95) === '1,000', '999.95');
assert(formatUnitRateDisplay(0.9) === '0.90', '0.90');
assert(formatUnitRateDisplay(1.2) === '1.20', '1.20');
assert(formatUnitRateDisplay(5) === '5.00', '5.00 small');
assert(formatUnitRateDisplay(3133.33) === '3,133.33', '3133.33');
assert(formatUnitRateDisplay(1144) === '1,144', '1144');
assert(formatUnitRateDisplay(12500) === '12,500', '12500');
assert(formatUnitRateDisplay(100000) === '1,00,000', '100000 indian');
assert(formatUnitRateInr(999.9) === '₹1,000', 'inr 999.90');
assert(formatUnitRateInr(12500) === '₹12,500', 'inr 12500');
assert(parseRateInput('₹12,500') === 12500, 'parse ₹12,500');
assert(parseRateInput('1,00,000') === 100000, 'parse indian');
assert(parseRateInput('₹ 5,000') === 5000, 'parse spaced');
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
