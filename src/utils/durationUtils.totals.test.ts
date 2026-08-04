/**
 * Month-display totals must match the rounded monthly formula (no daily×days drift).
 * Run: npx tsx src/utils/durationUtils.totals.test.ts
 */
import {
  computeQuoteItemTotal,
  computeRecurringLineTotal,
  toDisplayRecurringRate,
} from './durationUtils';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// The screenshot bug: 466.67/day × 10 × 30 = 1,40,001 but formula shows ₹14000 × 10 × 1
assert(10 * 466.67 * 30 === 140001, 'raw daily×days is 140001');
assert(Math.round(466.67 * 30) === 14000, 'monthly rounds to 14000');
assert(toDisplayRecurringRate(466.67, 30).rate === 14000, 'monthly display 14000');
assert(computeRecurringLineTotal(10, 466.67, 30) === 140000, 'amount matches formula 14000×10×1');

// Exact 14000/30 daily
const daily14000 = 14000 / 30;
assert(toDisplayRecurringRate(daily14000, 30).rate === 14000, 'exact monthly 14000');
assert(computeRecurringLineTotal(10, daily14000, 30) === 140000, 'exact 14000×10×1');

// Non-month (34 days): keep qty × daily × days
assert(computeRecurringLineTotal(10, 466.67, 34) === 10 * 466.67 * 34, '34 days day-wise');

// Quote item helper
assert(
  computeQuoteItemTotal({
    quantity: 10,
    rate: 466.67,
    duration: 30,
    durationUnit: 'days',
    description: 'Bus Full Branding - Display Price',
  }) === 140000,
  'computeQuoteItemTotal display month',
);

assert(
  computeQuoteItemTotal({
    quantity: 10,
    rate: 5000,
    description: 'Printing & Mounting for buses',
  }) === 50000,
  'one-time no duration',
);

// 2 months = 60 days
assert(computeRecurringLineTotal(5, 466.67, 60) === 5 * 14000 * 2, '2 months');

console.log('durationUtils.totals tests passed');
