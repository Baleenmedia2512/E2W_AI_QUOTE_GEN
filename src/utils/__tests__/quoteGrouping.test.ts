import { describe, it, expect } from 'vitest';

import { QuoteItem } from '../../types/quote';
import {
  extractServiceType,
  groupItemsByServiceType,
  isMultiServiceQuote,
  getGeneralTerms,
  filterTermsByServiceType,
  DEFAULT_GENERAL_TERMS,
} from '../quoteGrouping';

function makeItem(overrides: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: 'i1',
    description: 'Bus Semi Branding - Rental Price (per Bus month)',
    quantity: 1,
    rate: 1000,
    total: 1000,
    ...overrides,
  };
}

describe('extractServiceType', () => {
  it('strips price suffix and returns full service name', () => {
    expect(extractServiceType('Bus Semi Branding - Rental Price (per Bus month)')).toBe(
      'Bus Semi Branding',
    );
  });

  it('strips display price suffix with duration', () => {
    expect(
      extractServiceType('Bus Shelter Panel - Lit - Display Price (for 30 days)'),
    ).toBe('Bus Shelter Panel - Lit');
  });

  it('strips printing & fixing price suffix', () => {
    expect(extractServiceType('Auto Full Branding - Printing & Fixing Price')).toBe(
      'Auto Full Branding',
    );
  });

  it('falls back to keyword when description is single word', () => {
    expect(extractServiceType('bus')).toBe('Bus');
  });

  it('returns multi-word description as-is when no price suffix', () => {
    expect(extractServiceType('auto rickshaw')).toBe('auto rickshaw');
  });

  it('capitalizes first word when no keyword matches', () => {
    expect(extractServiceType('Custom Service')).toBe('Custom Service');
  });

  it('handles unknown single word with capitalization', () => {
    expect(extractServiceType('xyz')).toBe('Xyz');
  });
});

describe('groupItemsByServiceType', () => {
  it('groups items with same service type and sums totals', () => {
    const items: QuoteItem[] = [
      makeItem({ id: '1', total: 100 }),
      makeItem({ id: '2', total: 200 }),
    ];
    const groups = groupItemsByServiceType(items);

    expect(groups).toHaveLength(1);
    expect(groups[0].serviceType).toBe('Bus Semi Branding');
    expect(groups[0].subtotal).toBe(300);
    expect(groups[0].items).toHaveLength(2);
  });

  it('produces separate groups for distinct service types', () => {
    const items: QuoteItem[] = [
      makeItem({ id: '1', description: 'Bus Full Branding - Rental Price', total: 100 }),
      makeItem({ id: '2', description: 'Auto Full Branding - Printing Price', total: 50 }),
    ];
    const groups = groupItemsByServiceType(items);

    expect(groups).toHaveLength(2);
    const types = groups.map((g) => g.serviceType).sort();
    expect(types).toEqual(['Auto Full Branding', 'Bus Full Branding']);
  });

  it('returns empty array for empty input', () => {
    expect(groupItemsByServiceType([])).toEqual([]);
  });

  it('carries termsAndConditions from first item in group', () => {
    const items: QuoteItem[] = [
      makeItem({ id: '1', termsAndConditions: 'Term A', total: 100 }),
      makeItem({ id: '2', termsAndConditions: 'Term B', total: 100 }),
    ];
    const groups = groupItemsByServiceType(items);
    expect(groups[0].termsAndConditions).toBe('Term A');
  });
});

describe('isMultiServiceQuote', () => {
  it('returns false for single service type', () => {
    const items: QuoteItem[] = [makeItem({ id: '1' }), makeItem({ id: '2' })];
    expect(isMultiServiceQuote(items)).toBe(false);
  });

  it('returns true when multiple service types present', () => {
    const items: QuoteItem[] = [
      makeItem({ id: '1', description: 'Bus Full Branding - Rental Price' }),
      makeItem({ id: '2', description: 'Auto Full Branding - Printing Price' }),
    ];
    expect(isMultiServiceQuote(items)).toBe(true);
  });

  it('returns false for empty list', () => {
    expect(isMultiServiceQuote([])).toBe(false);
  });
});

describe('getGeneralTerms', () => {
  it('returns empty array for empty input', () => {
    expect(getGeneralTerms('')).toEqual([]);
  });

  it('splits input by newlines and trims', () => {
    const result = getGeneralTerms('Prices exclude GST\n100% upfront required');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('filterTermsByServiceType', () => {
  it('returns empty for empty input', () => {
    expect(filterTermsByServiceType('', 'Bus')).toEqual([]);
  });

  it('extracts terms under bus-specific section header', () => {
    const tc = 'Bus Branding:\n• Term one for bus\n• Term two for bus\nAuto Branding:\n• Auto term';
    const filtered = filterTermsByServiceType(tc, 'Bus Semi Branding');
    expect(filtered.some((t) => t.toLowerCase().includes('term one for bus'))).toBe(true);
    expect(filtered.some((t) => t.toLowerCase().includes('auto term'))).toBe(false);
  });
});

describe('DEFAULT_GENERAL_TERMS', () => {
  it('exports a non-empty array of strings', () => {
    expect(Array.isArray(DEFAULT_GENERAL_TERMS)).toBe(true);
    expect(DEFAULT_GENERAL_TERMS.length).toBeGreaterThan(0);
    DEFAULT_GENERAL_TERMS.forEach((t) => expect(typeof t).toBe('string'));
  });
});
