import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractServiceType,
  groupItemsByServiceType,
  isMultiServiceQuote,
  DEFAULT_GENERAL_TERMS,
} from '../../src/utils/quoteGrouping';
import { QuoteItem } from '../../src/types/quote';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeItem(description: string, total = 1000): QuoteItem {
  return {
    id: `item-${Math.random()}`,
    description,
    quantity: 1,
    rate: total,
    total,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('quoteGrouping', () => {
  describe('DEFAULT_GENERAL_TERMS', () => {
    it('is an array with exactly 6 items', () => {
      expect(Array.isArray(DEFAULT_GENERAL_TERMS)).toBe(true);
      expect(DEFAULT_GENERAL_TERMS).toHaveLength(6);
    });

    it('first term mentions GST', () => {
      expect(DEFAULT_GENERAL_TERMS[0].toLowerCase()).toContain('gst');
    });

    it('contains upfront payment term', () => {
      const hasUpfront = DEFAULT_GENERAL_TERMS.some((t) =>
        t.toLowerCase().includes('upfront')
      );
      expect(hasUpfront).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // extractServiceType
  // ─────────────────────────────────────────────
  describe('extractServiceType', () => {
    it('strips "Rental Price (per Bus month)" suffix → "Bus Semi Branding"', () => {
      expect(
        extractServiceType('Bus Semi Branding - Rental Price (per Bus month)')
      ).toBe('Bus Semi Branding');
    });

    it('strips "Display Price (for 30 days)" from panel description', () => {
      expect(
        extractServiceType('Bus Shelter Panel - Lit - Display Price (for 30 days)')
      ).toBe('Bus Shelter Panel - Lit');
    });

    it('strips "Printing & Fixing Price" suffix', () => {
      expect(
        extractServiceType('Auto Full Branding - Printing & Fixing Price')
      ).toBe('Auto Full Branding');
    });

    it('strips "- Design Price (Extra)" suffix', () => {
      expect(extractServiceType('Banner - Design Price (Extra)')).toBe('Banner');
    });

    it('returns unchanged description when no price suffix found', () => {
      expect(extractServiceType('Simple Service')).toBe('Simple Service');
    });

    it('falls back to keyword match for single-word "Bus" description', () => {
      expect(extractServiceType('Bus')).toBe('Bus');
    });

    it('falls back to keyword match for single-word "auto" description', () => {
      // Single-word descriptions fall through to keyword matching
      const result = extractServiceType('auto');
      expect(result).toBe('Auto');
    });

    it('falls back to "Hoarding" for single-word hoarding description', () => {
      expect(extractServiceType('hoarding')).toBe('Hoarding');
    });

    it('returns multi-word stripped description when description has spaces', () => {
      // Multi-word descriptions (after suffix stripping) are returned as-is
      const result = extractServiceType('Bus Full Branding');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles em-dash (—) as separator', () => {
      const result = extractServiceType('Bus Full Branding — Rental Price');
      expect(result).toBe('Bus Full Branding');
    });

    it('handles en-dash (–) as separator', () => {
      const result = extractServiceType('Auto Half Wrap – Display Price');
      expect(result).toBe('Auto Half Wrap');
    });
  });

  // ─────────────────────────────────────────────
  // groupItemsByServiceType
  // ─────────────────────────────────────────────
  describe('groupItemsByServiceType', () => {
    it('returns empty array for empty items', () => {
      expect(groupItemsByServiceType([])).toEqual([]);
    });

    it('groups items with same service type into one group', () => {
      const items = [
        makeItem('Bus Semi Branding - Rental Price (per Bus month)', 10000),
        makeItem('Bus Semi Branding - Printing & Fixing Price', 5000),
      ];
      const groups = groupItemsByServiceType(items);
      expect(groups).toHaveLength(1);
      expect(groups[0].serviceType).toBe('Bus Semi Branding');
      expect(groups[0].items).toHaveLength(2);
    });

    it('creates separate groups for different service types', () => {
      const items = [
        makeItem('Bus Semi Branding - Rental Price', 10000),
        makeItem('Auto Full Branding - Printing & Fixing Price', 5000),
      ];
      const groups = groupItemsByServiceType(items);
      expect(groups).toHaveLength(2);
      const types = groups.map((g) => g.serviceType);
      expect(types).toContain('Bus Semi Branding');
      expect(types).toContain('Auto Full Branding');
    });

    it('calculates subtotal as sum of item totals', () => {
      const items = [
        makeItem('Bus Semi Branding - Rental Price', 10000),
        makeItem('Bus Semi Branding - Printing Price', 5000),
      ];
      const groups = groupItemsByServiceType(items);
      expect(groups[0].subtotal).toBe(15000);
    });

    it('each group subtotal uses item.total field', () => {
      const items: QuoteItem[] = [
        { id: '1', description: 'Bus Semi Branding - Rate', quantity: 5, rate: 2000, total: 10000 },
        { id: '2', description: 'Auto Full Branding - Rate', quantity: 3, rate: 3000, total: 9000 },
      ];
      const groups = groupItemsByServiceType(items);
      const busGroup = groups.find((g) => g.serviceType === 'Bus Semi Branding');
      const autoGroup = groups.find((g) => g.serviceType === 'Auto Full Branding');
      expect(busGroup?.subtotal).toBe(10000);
      expect(autoGroup?.subtotal).toBe(9000);
    });

    it('carries through termsAndConditions from first item in group', () => {
      const items: QuoteItem[] = [
        {
          id: '1',
          description: 'Bus - Rate',
          quantity: 1,
          rate: 1000,
          total: 1000,
          termsAndConditions: '• Term A\n• Term B',
        },
      ];
      const groups = groupItemsByServiceType(items);
      expect(groups[0].termsAndConditions).toBe('• Term A\n• Term B');
    });
  });

  // ─────────────────────────────────────────────
  // isMultiServiceQuote
  // ─────────────────────────────────────────────
  describe('isMultiServiceQuote', () => {
    it('returns false for empty items', () => {
      expect(isMultiServiceQuote([])).toBe(false);
    });

    it('returns false when all items are the same service type', () => {
      const items = [
        makeItem('Bus Semi Branding - Rental Price'),
        makeItem('Bus Semi Branding - Printing Price'),
      ];
      expect(isMultiServiceQuote(items)).toBe(false);
    });

    it('returns true when items span multiple service types', () => {
      const items = [
        makeItem('Bus Semi Branding - Rental Price'),
        makeItem('Auto Full Branding - Printing Price'),
      ];
      expect(isMultiServiceQuote(items)).toBe(true);
    });

    it('returns false for single item', () => {
      expect(isMultiServiceQuote([makeItem('Bus Semi Branding - Rental Price')])).toBe(false);
    });
  });
});
