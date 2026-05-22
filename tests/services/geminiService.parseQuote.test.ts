import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock heavy deps so importing geminiService doesn't make API calls ─────
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn(),
      startChat: vi.fn(),
    }),
  })),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { parseQuoteFromResponse } from '../../src/services/geminiService';
import { logger } from '../../src/utils/logger';

/**
 * parseQuoteFromResponse extracts the first JSON object found in a Gemini text response.
 * Regex: /\{[\s\S]*\}/   → greedy match from first `{` to last `}`.
 *
 * Production failure modes this test file prevents:
 *  1. Silent quote loss when Gemini wraps JSON in markdown fences or prose
 *  2. Silent quote loss when Gemini returns truncated/invalid JSON
 *  3. Silent acceptance of partial JSON (the regex IS greedy — must verify behaviour)
 */
describe('parseQuoteFromResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────
  describe('valid JSON extraction', () => {
    it('parses a pure JSON object string', () => {
      const response = '{"items":[],"deliveryTimeline":"7 days"}';
      const result = parseQuoteFromResponse(response);
      expect(result).not.toBeNull();
      expect(result.items).toEqual([]);
      expect(result.deliveryTimeline).toBe('7 days');
    });

    it('extracts JSON wrapped in surrounding prose', () => {
      const response = 'Here is your quote: {"items":[{"title":"Branding"}]} Hope this helps!';
      const result = parseQuoteFromResponse(response);
      expect(result).not.toBeNull();
      expect(result.items[0].title).toBe('Branding');
    });

    it('extracts JSON inside markdown code fences', () => {
      const response = '```json\n{"items":[],"total":1000}\n```';
      const result = parseQuoteFromResponse(response);
      expect(result).not.toBeNull();
      expect(result.total).toBe(1000);
    });

    it('parses nested structures (items with lineItems)', () => {
      const response = `{
        "items": [
          {
            "title": "Bus Branding",
            "lineItems": [
              { "description": "Full wrap", "quantity": 10, "unitPrice": 50000 }
            ]
          }
        ]
      }`;
      const result = parseQuoteFromResponse(response);
      expect(result.items[0].lineItems[0].quantity).toBe(10);
      expect(result.items[0].lineItems[0].unitPrice).toBe(50000);
    });

    it('preserves duration field for multi-month pricing', () => {
      const response = '{"items":[{"lineItems":[{"duration":3,"durationUnit":"months"}]}]}';
      const result = parseQuoteFromResponse(response);
      expect(result.items[0].lineItems[0].duration).toBe(3);
      expect(result.items[0].lineItems[0].durationUnit).toBe('months');
    });

    it('preserves minimumQuantity field (business rule)', () => {
      const response = '{"items":[{"lineItems":[{"minimumQuantity":10,"quantity":5}]}]}';
      const result = parseQuoteFromResponse(response);
      expect(result.items[0].lineItems[0].minimumQuantity).toBe(10);
    });
  });

  // ── Error paths ─────────────────────────────────────────────────────────
  describe('malformed input returns null (must NOT throw)', () => {
    it('returns null for empty string', () => {
      expect(parseQuoteFromResponse('')).toBeNull();
    });

    it('returns null when response contains no JSON', () => {
      expect(parseQuoteFromResponse('I cannot generate a quote for that.')).toBeNull();
    });

    it('returns null for truncated JSON', () => {
      // Greedy match from { to } — truncated JSON has no closing brace, so no match
      const result = parseQuoteFromResponse('{"items":[{"title":"Incomplete"');
      expect(result).toBeNull();
    });

    it('returns null for JSON with syntax error (invalid quote)', () => {
      // Has both { and } but JSON.parse will throw
      const result = parseQuoteFromResponse('{"items":[invalid_token]}');
      expect(result).toBeNull();
    });

    it('logs the error when JSON.parse throws', () => {
      parseQuoteFromResponse('{not valid json at all}');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to parse quote data:',
        expect.any(Error),
      );
    });

    it('does NOT log when there is simply no JSON to extract', () => {
      // No match found → return null WITHOUT logging (no error happened)
      parseQuoteFromResponse('just plain text');
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty JSON object', () => {
      const result = parseQuoteFromResponse('{}');
      expect(result).toEqual({});
    });

    it('extracts only the OUTERMOST braces when multiple JSON blocks exist', () => {
      // Greedy match means /\{[\s\S]*\}/ spans from first { to last }
      // This is the documented (and risky) behaviour we must lock in.
      const response = '{"a":1} ignore {"b":2}';
      const result = parseQuoteFromResponse(response);
      // The regex greedily matches '{"a":1} ignore {"b":2}', which is not valid JSON
      // → JSON.parse throws → returns null. Locking in this real behaviour.
      expect(result).toBeNull();
    });

    it('handles JSON with Unicode characters (Indian Rupee symbol)', () => {
      const response = '{"items":[{"description":"₹50,000 banner"}]}';
      const result = parseQuoteFromResponse(response);
      expect(result.items[0].description).toBe('₹50,000 banner');
    });

    it('handles JSON with escaped quotes', () => {
      const response = '{"description":"He said \\"hello\\""}';
      const result = parseQuoteFromResponse(response);
      expect(result.description).toBe('He said "hello"');
    });

    it('returns null for null input (try/catch swallows the TypeError)', () => {
      // null.match() throws TypeError → caught by the function's try/catch
      // → returns null. Verifying the safety net works as a null guard.
      // @ts-expect-error — runtime safety check
      expect(parseQuoteFromResponse(null)).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
