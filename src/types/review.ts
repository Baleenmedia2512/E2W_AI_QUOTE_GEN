/** One editable card on the Manual / Review quote screen. */
export interface ReviewDraftItem {
  id: string;
  /** Typed / display service name (may be corrected by user). */
  service: string;
  /** Catalog id when known or picked from autocomplete. */
  serviceId?: string;
  /** One or more DB city / place labels. */
  cities: string[];
  quantity: number;
  durationDays: number;
  minimumQuantity?: number;
  minimumDurationDays?: number;
}

export type ReviewDraftSource = 'ai' | 'manual' | 'legacy';

/** Draft held between chat finalize and PDF preview. */
export interface ReviewDraft {
  items: ReviewDraftItem[];
  source: ReviewDraftSource;
  originalUserText?: string;
}
