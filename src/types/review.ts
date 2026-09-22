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
  /**
   * Campaign days for this line.
   * 0 = no user duration and no DB min_days (NA) — Review list hides the days badge.
   * Sourced from chat duration or metadata.min_days via vendorMinDays().
   */
  durationDays: number;
  minimumQuantity?: number;
  /** From metadata.min_days (legacy min_duration). Undefined when NA / missing. */
  minimumDurationDays?: number;
}

export type ReviewDraftSource = 'ai' | 'manual' | 'legacy';

/** Draft held between chat finalize and PDF preview. */
export interface ReviewDraft {
  items: ReviewDraftItem[];
  source: ReviewDraftSource;
  originalUserText?: string;
}
