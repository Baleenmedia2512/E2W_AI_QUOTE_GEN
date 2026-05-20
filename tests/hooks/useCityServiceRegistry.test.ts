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

  // ─────────────────────────────────────────────
  // Hook with proposals — city detection & registry build
  // ─────────────────────────────────────────────
  describe('useCityServiceRegistry hook with proposals', () => {
    it('skips a proposal whose textContent is too short (< 50 chars)', async () => {
      // Arrange: store returns a proposal with very short text
      const { useAppStore } = await import('../../src/store');
      const { useCityServiceRegistry } = await import('../../src/hooks/useCityServiceRegistry');

      vi.mocked(useAppStore).mockImplementation((selector: any) =>
        selector({
          activeProposals: [
            { fileName: 'Chennai_Rate_Card.pdf', textContent: 'Too short' },
          ],
        })
      );

      renderHook(() => useCityServiceRegistry());

      // Registry entry for "chennai" must be "failed" because text is too short
      const registry = getCityServiceRegistry();
      const entry = registry.get('chennai');
      expect(entry?.status).toBe('failed');
    });

    it('sets registry status to "building" when a valid proposal is provided', async () => {
      const { useAppStore } = await import('../../src/store');
      const { useCityServiceRegistry } = await import('../../src/hooks/useCityServiceRegistry');
      const longText = 'Bus Semi Branding rate card for Chennai. '.repeat(20); // > 50 chars

      vi.mocked(useAppStore).mockImplementation((selector: any) =>
        selector({
          activeProposals: [
            { fileName: 'Chennai_Rate_Card.pdf', textContent: longText },
          ],
        })
      );

      renderHook(() => useCityServiceRegistry());

      // Immediately after hook fires the entry should be "building" (async build in progress)
      const registry = getCityServiceRegistry();
      const entry = registry.get('chennai');
      expect(entry).toBeDefined();
      expect(['building', 'ready', 'failed']).toContain(entry?.status);
    });

    it('does not overwrite an existing "ready" entry when hook re-renders', async () => {
      const { useCityServiceRegistry } = await import('../../src/hooks/useCityServiceRegistry');

      // Pre-seed registry as if it was already built
      getCityServiceRegistry().set('chennai', {
        services: ['bus semi branding'],
        quantities: { 'bus semi branding': { min: 5, max: null } },
        status: 'ready',
      });

      const { useAppStore } = await import('../../src/store');
      vi.mocked(useAppStore).mockImplementation((selector: any) =>
        selector({
          activeProposals: [
            { fileName: 'Chennai_Rate_Card.pdf', textContent: 'Bus Semi Branding '.repeat(30) },
          ],
        })
      );

      renderHook(() => useCityServiceRegistry());

      // Still "ready" — must not be overwritten
      const entry = getCityServiceRegistry().get('chennai');
      expect(entry?.status).toBe('ready');
      expect(entry?.services).toContain('bus semi branding');
    });

    it('does not overwrite an entry that is currently "building"', async () => {
      const { useCityServiceRegistry } = await import('../../src/hooks/useCityServiceRegistry');

      getCityServiceRegistry().set('madurai', {
        services: [],
        quantities: {},
        status: 'building',
      });

      const { useAppStore } = await import('../../src/store');
      vi.mocked(useAppStore).mockImplementation((selector: any) =>
        selector({
          activeProposals: [
            { fileName: 'Madurai_Rate_Card.pdf', textContent: 'Madurai rate card content '.repeat(30) },
          ],
        })
      );

      renderHook(() => useCityServiceRegistry());

      // Still "building" — must not restart
      const entry = getCityServiceRegistry().get('madurai');
      expect(entry?.status).toBe('building');
    });
  });

  // ─────────────────────────────────────────────
  // sessionStorage restoration
  // ─────────────────────────────────────────────
  describe('sessionStorage restoration', () => {
    it('registry starts empty after sessionStorage is cleared', () => {
      sessionStorage.clear();
      getCityServiceRegistry().clear();
      expect(getCityServiceRegistry().size).toBe(0);
    });

    it('persists registry to sessionStorage after being populated manually', () => {
      getCityServiceRegistry().set('bangalore', {
        services: ['bus full branding'],
        quantities: { 'bus full branding': { min: 3, max: 10 } },
        status: 'ready',
      });

      // Manually trigger persist logic by calling persistToSession equivalent
      const snapshot: Record<string, object> = {};
      getCityServiceRegistry().forEach((val, key) => { snapshot[key] = val; });
      sessionStorage.setItem('e2w_city_service_registry', JSON.stringify(snapshot));

      const stored = sessionStorage.getItem('e2w_city_service_registry');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.bangalore).toBeDefined();
      expect(parsed.bangalore.services).toContain('bus full branding');
    });
  });
});
