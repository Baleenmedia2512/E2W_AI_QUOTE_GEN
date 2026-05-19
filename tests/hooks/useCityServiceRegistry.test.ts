import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getCityServiceRegistry, KNOWN_CITY_LIST } from '../../src/hooks/useCityServiceRegistry';

// Mock the store
vi.mock('../../src/store', () => ({
  useAppStore: vi.fn((selector: any) =>
    selector({ activeProposals: [] })
  ),
}));

// Mock Gemini to prevent any API calls
vi.mock('../../src/services/geminiService', () => ({
  sendMessageToGemini: vi.fn().mockResolvedValue({ isQuoteGeneration: false }),
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

describe('useCityServiceRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Clear the module-level registry between tests
    getCityServiceRegistry().clear();
  });

  // ─────────────────────────────────────────────
  // getCityServiceRegistry (exported singleton)
  // ─────────────────────────────────────────────
  describe('getCityServiceRegistry', () => {
    it('returns an empty Map initially', () => {
      const registry = getCityServiceRegistry();
      expect(registry).toBeInstanceOf(Map);
      expect(registry.size).toBe(0);
    });

    it('returns the same Map reference on multiple calls (singleton)', () => {
      const r1 = getCityServiceRegistry();
      const r2 = getCityServiceRegistry();
      expect(r1).toBe(r2);
    });
  });

  // ─────────────────────────────────────────────
  // KNOWN_CITY_LIST
  // ─────────────────────────────────────────────
  describe('KNOWN_CITY_LIST', () => {
    it('is a non-empty array of lowercase city names', () => {
      expect(Array.isArray(KNOWN_CITY_LIST)).toBe(true);
      expect(KNOWN_CITY_LIST.length).toBeGreaterThan(0);
    });

    it('contains expected cities', () => {
      expect(KNOWN_CITY_LIST).toContain('chennai');
      expect(KNOWN_CITY_LIST).toContain('bangalore');
      expect(KNOWN_CITY_LIST).toContain('mumbai');
    });

    it('all entries are lowercase strings', () => {
      KNOWN_CITY_LIST.forEach(city => {
        expect(typeof city).toBe('string');
        expect(city).toBe(city.toLowerCase());
      });
    });
  });

  // ─────────────────────────────────────────────
  // Hook invocation with no proposals
  // ─────────────────────────────────────────────
  describe('useCityServiceRegistry hook', () => {
    it('does not throw when activeProposals is empty', async () => {
      const { useCityServiceRegistry } = await import('../../src/hooks/useCityServiceRegistry');

      expect(() => renderHook(() => useCityServiceRegistry())).not.toThrow();
    });

    it('does not modify registry when no proposals provided', async () => {
      const { useCityServiceRegistry } = await import('../../src/hooks/useCityServiceRegistry');

      renderHook(() => useCityServiceRegistry());
      expect(getCityServiceRegistry().size).toBe(0);
    });
  });
});
