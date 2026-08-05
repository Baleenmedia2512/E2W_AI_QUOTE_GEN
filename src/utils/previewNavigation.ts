import { QuoteItem } from '../types/quote';
import {
  getQuoteItemGroupKey,
  getServiceGroupHeading,
  groupItemsByServiceType,
  isMultiServiceQuote,
  type ServiceGroup,
} from './quoteGrouping';

export const PREVIEW_SECTION_SUMMARY = 'pdf-page-summary';
export const PREVIEW_SECTION_TERMS = 'pdf-page-terms';
export const PREVIEW_SECTION_SINGLE = 'pdf-page-1';
export const PREVIEW_SECTION_BANK = 'preview-bank-details';

export interface PreviewTocItem {
  id: string;
  label: string;
  kind: 'summary' | 'service' | 'terms' | 'bank';
}

/** DOM-safe id segment from a group key (may contain `|`). */
export function slugifyPreviewKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\|/g, '--')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function previewServiceSectionIdFromKey(groupKey: string): string {
  return `preview-service-${slugifyPreviewKey(groupKey)}`;
}

export function previewServiceSectionId(group: ServiceGroup): string {
  const first = group.items[0];
  if (!first) return previewServiceSectionIdFromKey(group.serviceType);
  return previewServiceSectionIdFromKey(getQuoteItemGroupKey(first));
}

export function previewServiceSectionIdFromItem(item: QuoteItem): string {
  return previewServiceSectionIdFromKey(getQuoteItemGroupKey(item));
}

/** Resolve which service section an executive-summary row should jump to. */
export function previewSectionIdForExecRow(
  row: { id: string; catalogServiceId?: string },
  items: QuoteItem[],
): string | null {
  const byId = items.find((i) => i.id === row.id);
  if (byId) return previewServiceSectionIdFromItem(byId);

  const catalog = (row.catalogServiceId || '').trim().toLowerCase();
  if (catalog) {
    const byCatalog = items.find(
      (i) => (i.serviceId || '').trim().toLowerCase() === catalog,
    );
    if (byCatalog) return previewServiceSectionIdFromItem(byCatalog);
  }

  return null;
}

export function buildPreviewTocItems(items: QuoteItem[]): PreviewTocItem[] {
  if (!items.length) return [];

  if (!isMultiServiceQuote(items)) {
    const groups = groupItemsByServiceType(items);
    const toc: PreviewTocItem[] = [
      { id: PREVIEW_SECTION_SINGLE, label: 'Executive Pricing Summary', kind: 'summary' },
    ];
    if (groups[0]) {
      toc.push({
        id: previewServiceSectionId(groups[0]),
        label: getServiceGroupHeading(groups[0]),
        kind: 'service',
      });
    }
    toc.push({ id: 'preview-terms-single', label: 'Terms & Conditions', kind: 'terms' });
    toc.push({ id: PREVIEW_SECTION_BANK, label: 'Bank Details', kind: 'bank' });
    return toc;
  }

  const toc: PreviewTocItem[] = [
    { id: PREVIEW_SECTION_SUMMARY, label: 'Executive Pricing Summary', kind: 'summary' },
  ];

  groupItemsByServiceType(items).forEach((group) => {
    toc.push({
      id: previewServiceSectionId(group),
      label: getServiceGroupHeading(group),
      kind: 'service',
    });
  });

  toc.push({ id: PREVIEW_SECTION_TERMS, label: 'Terms & Conditions', kind: 'terms' });
  toc.push({ id: PREVIEW_SECTION_BANK, label: 'Bank Details', kind: 'bank' });
  return toc;
}

/**
 * Scroll a section into view inside `.preview-container`, compensating for CSS zoom scale.
 */
export function scrollToPreviewSection(
  sectionId: string,
  options?: { zoom?: number; container?: HTMLElement | null; offsetPx?: number },
): void {
  const container =
    options?.container ||
    (document.querySelector('.preview-container') as HTMLElement | null);
  const target = document.getElementById(sectionId);
  if (!container || !target) return;

  const zoomFactor = (options?.zoom ?? 100) / 100;
  const offsetPx = options?.offsetPx ?? 12;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextTop =
    (targetRect.top - containerRect.top) / zoomFactor + container.scrollTop - offsetPx;

  container.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
}
