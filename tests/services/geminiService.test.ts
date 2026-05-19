import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseQuoteFromResponse } from '../../src/services/geminiService';

// Mock the Gemini API and rate limiter to avoid real network calls
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => 'AI Response' },
      }),
    }),
  })),
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

describe('geminiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // parseQuoteFromResponse
  // ─────────────────────────────────────────────
  describe('parseQuoteFromResponse', () => {
    it('extracts JSON from a clean JSON response', () => {
      const response = '{"quoteGenerated":true,"items":[{"description":"Bus Branding","rate":1000}]}';
      const result = parseQuoteFromResponse(response);
      expect(result).not.toBeNull();
      expect(result?.quoteGenerated).toBe(true);
    });

    it('extracts JSON embedded in surrounding text', () => {
      const response = 'Here is the quote: {"quoteGenerated":true,"items":[]} Hope this helps!';
      const result = parseQuoteFromResponse(response);
      expect(result).not.toBeNull();
      expect(result?.quoteGenerated).toBe(true);
    });

    it('returns null for plain text with no JSON', () => {
      const response = 'Sorry, I could not find that service in the proposal.';
      const result = parseQuoteFromResponse(response);
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseQuoteFromResponse('')).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      const response = '{broken json: [missing quotes}';
      expect(parseQuoteFromResponse(response)).toBeNull();
    });

    it('parses multipleMatch response correctly', () => {
      const response = JSON.stringify({
        multipleMatch: true,
        groupedServices: [{ name: 'Bus', items: [] }],
      });
      const result = parseQuoteFromResponse(response);
      expect(result?.multipleMatch).toBe(true);
      expect(result?.groupedServices).toHaveLength(1);
    });

    it('parses partialMatch response correctly', () => {
      const response = JSON.stringify({
        partialMatch: true,
        closestServices: ['Bus Branding', 'Auto Branding'],
        requestedService: 'Train Branding',
      });
      const result = parseQuoteFromResponse(response);
      expect(result?.partialMatch).toBe(true);
      expect(result?.closestServices).toHaveLength(2);
    });

    it('parses noMatch response correctly', () => {
      const response = JSON.stringify({
        noMatch: true,
        allServicesGrouped: [],
        requestedService: 'Rocket Branding',
      });
      const result = parseQuoteFromResponse(response);
      expect(result?.noMatch).toBe(true);
    });

    it('handles JSON with numeric price fields', () => {
      const response = JSON.stringify({
        quoteGenerated: true,
        items: [
          { description: 'Bus Semi Branding - Rental Price', rate: 2000, quantity: 5, total: 10000 },
        ],
        subtotal: 10000,
        gstAmount: 1800,
        total: 11800,
      });
      const result = parseQuoteFromResponse(response);
      expect(result?.items[0].total).toBe(10000);
      expect(typeof result?.items[0].rate).toBe('number');
    });
  });
});
