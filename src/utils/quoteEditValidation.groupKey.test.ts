/**
 * P&F-only edits must pin to primary item id (Auto Full ≠ Auto Semi).
 * Mirrors applyOneTimeComponentEdit’s P&F-only branch.
 * Run: npx tsx src/utils/quoteEditValidation.groupKey.test.ts
 */
import { isOneTimeLineDescription, computeQuoteItemTotal } from './durationUtils';
import type { QuoteItem } from '../types/quote';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function applyOneTimePfOnlyPin(
  items: QuoteItem[],
  primaryItemId: string,
  newAmount: number,
): QuoteItem[] {
  const primary = items.find((i) => i.id === primaryItemId);
  if (!primary || !isOneTimeLineDescription(primary.description)) {
    throw new Error('expected P&F-only primary');
  }
  return items.map((item) => {
    if (item.id !== primary.id) return item;
    const next = {
      ...item,
      rate: newAmount,
      oneTimeComponents: [{ label: 'Printing & Mounting', amount: newAmount }],
    };
    return { ...next, total: computeQuoteItemTotal(next) };
  });
}

const full: QuoteItem = {
  id: 'full-pf',
  description: 'Auto Full Branding - Printing & Fixing Price',
  serviceId: 'chennai-auto-shared',
  serviceName: 'Auto Full Branding',
  city: 'Chennai',
  quantity: 50,
  rate: 100,
  total: 5000,
};
const semi: QuoteItem = {
  id: 'semi-pf',
  description: 'Auto Semi Branding - Printing & Fixing Price',
  serviceId: 'chennai-auto-shared', // same bad catalog id
  serviceName: 'Auto Semi Branding',
  city: 'Chennai',
  quantity: 50,
  rate: 100,
  total: 5000,
};

const next = applyOneTimePfOnlyPin([full, semi], 'full-pf', 2);
assert(next.find((i) => i.id === 'full-pf')!.rate === 2, 'Full updated');
assert(next.find((i) => i.id === 'semi-pf')!.rate === 100, 'Semi untouched');
assert(
  next.find((i) => i.id === 'semi-pf')!.oneTimeComponents == null,
  'Semi has no shared components',
);

console.log('quoteEditValidation.groupKey.test.ts: all passed');
