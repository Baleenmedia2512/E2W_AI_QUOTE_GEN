/** Customer review shape used in preview + PDF. */
export interface CustomerReview {
  reviewerName: string;
  starCount: number;
  reviewText: string;
  reviewUrl: string | null;
}

/** Stable key for equality (trim + case-fold + collapse whitespace). */
export function reviewIdentityKey(review: CustomerReview): string {
  return [
    review.reviewerName.trim().toLowerCase(),
    String(review.starCount ?? 0),
    review.reviewText.trim().toLowerCase().replace(/\s+/g, ' '),
    (review.reviewUrl || '').trim().toLowerCase(),
  ].join('\u0001');
}

export function areReviewsEqual(a: CustomerReview, b: CustomerReview): boolean {
  return reviewIdentityKey(a) === reviewIdentityKey(b);
}

/**
 * Group reviews only when EVERY entry is present and identical.
 * - All same → return that review (show once above bank details).
 * - Any missing or any different → return null (show per service).
 */
export function getSharedReviewIfAllSame(
  reviews: Array<CustomerReview | null | undefined>,
): CustomerReview | null {
  if (reviews.length === 0) return null;
  if (reviews.some((r) => !r)) return null;

  const first = reviews[0] as CustomerReview;
  for (let i = 1; i < reviews.length; i++) {
    if (!areReviewsEqual(first, reviews[i] as CustomerReview)) return null;
  }
  return first;
}
