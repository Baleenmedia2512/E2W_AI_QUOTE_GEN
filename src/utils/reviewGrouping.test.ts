import {
  areReviewsEqual,
  getSharedReviewIfAllSame,
  reviewIdentityKey,
  type CustomerReview,
} from './reviewGrouping';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const a: CustomerReview = {
  reviewerName: 'Ravi',
  starCount: 5,
  reviewText: 'Great service',
  reviewUrl: 'https://g.page/a',
};
const aClone: CustomerReview = {
  reviewerName: '  ravi ',
  starCount: 5,
  reviewText: 'Great   service',
  reviewUrl: 'https://g.page/a',
};
const b: CustomerReview = {
  reviewerName: 'Ravi',
  starCount: 5,
  reviewText: 'Different text',
  reviewUrl: 'https://g.page/a',
};

assert(areReviewsEqual(a, aClone), 'normalized equal');
assert(!areReviewsEqual(a, b), 'different text');
assert(reviewIdentityKey(a) === reviewIdentityKey(aClone), 'same key');

assert(getSharedReviewIfAllSame([a, a, a]) !== null, '10 same → group');
assert(getSharedReviewIfAllSame([a, a, b]) === null, 'one different → per service');
assert(getSharedReviewIfAllSame([a, a, null]) === null, 'one missing → per service');
assert(getSharedReviewIfAllSame([a]) !== null, 'single still groups');
assert(getSharedReviewIfAllSame([]) === null, 'empty');

console.log('reviewGrouping.test.ts: all passed');
