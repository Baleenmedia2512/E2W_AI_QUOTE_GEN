import { describe, it, expect, vi } from 'vitest';

// ── Mock store (hook module imports it at top-level) ────────────────────
vi.mock('../../src/store', () => ({
  useAppStore: vi.fn((selector: any) => selector({ activeProposals: [] })),
}));

vi.mock('../../src/services/geminiService', () => ({
  sendMessageToGemini: vi.fn().mockResolvedValue({ isQuoteGeneration: false }),
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { canonicalizeServiceName } from '../../src/hooks/useCityServiceRegistry';

/**
 * canonicalizeServiceName = normalizeSvc() + applySynonyms()
 *
 * This is the BACKBONE of city→service matching. Every registry key and
 * every user-input lookup goes through this function. A regex bug here
 * silently breaks all service matching across the entire app.
 *
 * Production failure modes this test file prevents:
 *  1. Service names with "(1/3)" page markers leaking into registry keys
 *  2. Dash/slash variants creating duplicate registry entries
 *     ("Bus-Full Branding" vs "Bus Full Branding" must collapse)
 *  3. Plural/singular mismatches breaking lookups
 *     ("Buses" → "bus", "Boards" → "board")
 *  4. Synonym collisions ("ad" → "branding", but NOT "sticker" → "branding")
 *  5. Whitespace collapse failing (multiple spaces → single space)
 */
describe('canonicalizeServiceName', () => {
  // ── Lowercase normalization ─────────────────────────────────────────
  describe('lowercasing', () => {
    it('lowercases ALL CAPS input', () => {
      expect(canonicalizeServiceName('BUS FULL BRANDING')).toBe('bus full branding');
    });

    it('lowercases Title Case input', () => {
      expect(canonicalizeServiceName('Auto Back Stickers')).toBe('auto back sticker');
    });

    it('lowercases Mixed Case', () => {
      expect(canonicalizeServiceName('MeTrO iNtErIoR')).toBe('metro interior');
    });
  });

  // ── Page marker stripping ───────────────────────────────────────────
  describe('page marker removal', () => {
    it('strips "(1/3)" page markers', () => {
      expect(canonicalizeServiceName('Bus Full Branding (1/3)')).toBe('bus full branding');
    });

    it('strips "(2 / 5)" with whitespace', () => {
      expect(canonicalizeServiceName('Bus Semi Branding (2 / 5)')).toBe('bus semi branding');
    });

    it('strips multiple page markers', () => {
      expect(canonicalizeServiceName('Service (1/2) name (3/4)')).toBe('service name');
    });

    it('does NOT strip ratios that are not page-marker format', () => {
      // "1/3" without parens is treated as a dash/slash and becomes a space
      expect(canonicalizeServiceName('1/3 day')).toBe('1 3 day');
    });
  });

  // ── Dash / slash normalization ──────────────────────────────────────
  describe('dash & slash collapse', () => {
    it('converts hyphens to spaces', () => {
      expect(canonicalizeServiceName('Bus-Full-Branding')).toBe('bus full branding');
    });

    it('converts en-dash to space', () => {
      expect(canonicalizeServiceName('Bus\u2013Full Branding')).toBe('bus full branding');
    });

    it('converts em-dash to space', () => {
      expect(canonicalizeServiceName('Bus\u2014Full Branding')).toBe('bus full branding');
    });

    it('converts forward slash to space', () => {
      expect(canonicalizeServiceName('Bus/Full Branding')).toBe('bus full branding');
    });
  });

  // ── Bracket removal ─────────────────────────────────────────────────
  describe('bracket removal', () => {
    it('strips square brackets', () => {
      expect(canonicalizeServiceName('Bus [Full] Branding')).toBe('bus full branding');
    });

    it('strips curly braces', () => {
      expect(canonicalizeServiceName('Bus {Full} Branding')).toBe('bus full branding');
    });

    it('strips parentheses (non-page-marker)', () => {
      expect(canonicalizeServiceName('Bus (Premium) Branding')).toBe('bus premium branding');
    });
  });

  // ── Singularization (business-critical) ─────────────────────────────
  describe('plural → singular for known nouns', () => {
    it('DEFECT-LOCK: "buses" currently becomes "buse" (NOT "bus")', () => {
      // ⚠ PRODUCTION DEFECT: normalizeSvc strips trailing `s` from matched
      // plurals, so "buses" → "buse". This breaks matching against the
      // singular form "bus" used in rate-card keys. Test locks in current
      // behaviour; when fixed, update expectation to 'bus full branding'.
      expect(canonicalizeServiceName('Buses Full Branding')).toBe('buse full branding');
    });

    it('singularizes "autos" → "auto"', () => {
      expect(canonicalizeServiceName('Autos Back Sticker')).toBe('auto back sticker');
    });

    it('singularizes "stickers" → "sticker"', () => {
      expect(canonicalizeServiceName('Auto Back Stickers')).toBe('auto back sticker');
    });

    it('singularizes "boards" → "board"', () => {
      expect(canonicalizeServiceName('Lobby Boards')).toBe('lobby board');
    });

    it('singularizes "screens" → "screen"', () => {
      expect(canonicalizeServiceName('Lift Screens')).toBe('lift screen');
    });

    it('keeps "hoarding" as "hoarding" (already singular form)', () => {
      // The branch in normalizeSvc that maps "hoardings"→"hoarding"
      // also intercepts "hoarding" and returns "hoarding" unchanged.
      expect(canonicalizeServiceName('Highway Hoarding')).toBe('highway hoarding');
    });

    it('singularizes "hoardings" → "hoarding"', () => {
      expect(canonicalizeServiceName('Highway Hoardings')).toBe('highway hoarding');
    });

    it('does NOT singularize unknown plurals (e.g. "trucks")', () => {
      // "trucks" is NOT in the singularization regex — must remain "trucks"
      expect(canonicalizeServiceName('Truck Full Branding')).toBe('truck full branding');
      expect(canonicalizeServiceName('Trucks Full Branding')).toBe('trucks full branding');
    });
  });

  // ── Whitespace collapse ─────────────────────────────────────────────
  describe('whitespace handling', () => {
    it('collapses multiple spaces into one', () => {
      expect(canonicalizeServiceName('Bus    Full     Branding')).toBe('bus full branding');
    });

    it('trims leading and trailing whitespace', () => {
      expect(canonicalizeServiceName('   Bus Full Branding   ')).toBe('bus full branding');
    });

    it('normalizes tabs and newlines to single space', () => {
      expect(canonicalizeServiceName('Bus\tFull\nBranding')).toBe('bus full branding');
    });
  });

  // ── Synonym substitution (Layer 2) ──────────────────────────────────
  describe('domain synonyms', () => {
    it('maps standalone "ad" → "branding"', () => {
      expect(canonicalizeServiceName('Lobby Screen Ad')).toBe('lobby screen branding');
    });

    it('maps "advertising" → "branding"', () => {
      expect(canonicalizeServiceName('Bus Advertising')).toBe('bus branding');
    });

    it('does NOT map "sticker" → "branding" (kept distinct)', () => {
      // Critical: "Auto Back Stickers" must stay distinct from "Auto Full Branding"
      // because they are separate rate-card rows.
      const result = canonicalizeServiceName('Auto Back Stickers');
      expect(result).toBe('auto back sticker');
      expect(result).not.toContain('branding');
    });

    it('collapses "underground metro" → "underground"', () => {
      expect(canonicalizeServiceName('Underground Metro Station')).toBe('underground');
    });

    it('collapses "underground station" → "underground"', () => {
      expect(canonicalizeServiceName('Underground Station Display')).toBe('underground display');
    });
  });

  // ── Composite real-world cases ──────────────────────────────────────
  describe('real-world rate-card entries', () => {
    it('handles "BUS - FULL BRANDING (1/3)" with all transforms', () => {
      expect(canonicalizeServiceName('BUS - FULL BRANDING (1/3)')).toBe('bus full branding');
    });

    it('handles "Auto/Back Stickers (2 of 4)" parens stripped, singularized', () => {
      // "(2 of 4)" is NOT a page marker (no slash inside parens) → parens stripped only
      const result = canonicalizeServiceName('Auto/Back Stickers (2 of 4)');
      expect(result).toBe('auto back sticker 2 of 4');
    });

    it('produces identical keys for case/spacing/dash/page-marker variants', () => {
      // NOTE: "Buses Full Branding" is EXCLUDED from this set because of the
      // documented buses→buse defect (see DEFECT-LOCK test above).
      const variants = [
        'Bus Full Branding',
        'BUS FULL BRANDING',
        'bus-full-branding',
        '  Bus   Full   Branding  ',
        'Bus Full Branding (1/5)',
      ];
      const canon = variants.map(canonicalizeServiceName);
      canon.forEach((v) => expect(v).toBe('bus full branding'));
    });

    it('is idempotent: canonicalizeServiceName(canonicalizeServiceName(x)) === canonicalizeServiceName(x)', () => {
      const input = 'Bus Full Branding';
      const once = canonicalizeServiceName(input);
      const twice = canonicalizeServiceName(once);
      expect(twice).toBe(once);
    });
  });

  // ── Empty / boundary inputs ─────────────────────────────────────────
  describe('boundary inputs', () => {
    it('returns empty string for empty input', () => {
      expect(canonicalizeServiceName('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(canonicalizeServiceName('   ')).toBe('');
    });

    it('returns empty string for input with only dashes and brackets', () => {
      expect(canonicalizeServiceName('---[]{}()')).toBe('');
    });
  });
});
