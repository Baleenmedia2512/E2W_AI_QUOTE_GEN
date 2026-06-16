import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseQuoteFromResponse, sendMessageToGemini } from '../../src/services/geminiService';

// ── Shared mock factory ────────────────────────────────────────────────────────
const makeGeminiModel = (responseText: string) => ({
  generateContent: vi.fn().mockResolvedValue({
    response: { text: () => responseText },
  }),
});

let mockGenerateContent = vi.fn().mockResolvedValue({
  response: { text: () => 'plain conversational reply' },
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      get generateContent() {
        return mockGenerateContent;
      },
    }),
  })),
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

// Silence logger noise in test output
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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

  // ─────────────────────────────────────────────
  // sendMessageToGemini
  // ─────────────────────────────────────────────
  describe('sendMessageToGemini', () => {
    // Helper: make Gemini return a specific JSON string
    const setGeminiResponse = (json: object | string) => {
      const text = typeof json === 'string' ? json : JSON.stringify(json);
      mockGenerateContent = vi.fn().mockResolvedValue({
        response: { text: () => text },
      });
    };

    it('returns isQuoteGeneration=true when Gemini responds with valid quoteGenerated JSON', async () => {
      setGeminiResponse({
        quoteGenerated: true,
        items: [
          {
            title: 'Bus Semi Branding',
            lineItems: [
              { description: 'Bus Semi Branding - Rental Price', quantity: 10, unitPrice: 5000, total: 50000 },
            ],
          },
        ],
        gstEnabled: true,
        gstPercentage: 18,
        termsAndConditions: '• GST 18% extra',
      });

      const result = await sendMessageToGemini({
        userMessage: 'Give me a quote for Bus Semi Branding for 3 months',
      });

      expect(result.isQuoteGeneration).toBe(true);
      expect(result.quoteData).not.toBeNull();
      expect(result.quoteData.quoteGenerated).toBe(true);
      expect(result.matchType).toBe('exact');
    });

    it('returns isQuoteGeneration=false for plain conversational reply (no JSON)', async () => {
      setGeminiResponse('Sure! What city and quantity do you need?');

      const result = await sendMessageToGemini({
        userMessage: 'Tell me about your services',
      });

      expect(result.isQuoteGeneration).toBe(false);
      expect(result.quoteData).toBeNull();
    });

    it('returns isMultipleMatch=true when Gemini returns multipleMatch response', async () => {
      setGeminiResponse({
        multipleMatch: true,
        groupedServices: [
          {
            vehicleType: 'Bus',
            services: [
              { name: 'Bus Semi Branding', category: 'Outdoor' },
              { name: 'Bus Full Branding', category: 'Outdoor' },
            ],
          },
        ],
      });

      const result = await sendMessageToGemini({
        userMessage: 'Quote for bus branding',
      });

      expect(result.isMultipleMatch).toBe(true);
      expect(result.isQuoteGeneration).toBe(false);
      expect(result.matchType).toBe('multiple');
      expect(result.groupedServices).toHaveLength(1);
    });

    it('returns isPartialMatch=true when Gemini returns partialMatch response', async () => {
      setGeminiResponse({
        partialMatch: true,
        requestedService: 'Train Branding',
        requestedQuantity: 10,
        closestServices: [
          { name: 'Bus Semi Branding', category: 'Outdoor', similarity: 'medium' },
        ],
        alternativeServices: [],
      });

      const result = await sendMessageToGemini({
        userMessage: 'Quote for train branding',
      });

      expect(result.isPartialMatch).toBe(true);
      expect(result.isQuoteGeneration).toBe(false);
      expect(result.matchType).toBe('partial');
      expect(result.requestedService).toBe('Train Branding');
      expect(result.closestServices).toHaveLength(1);
    });

    it('returns isNoMatch=true when Gemini returns noMatch response', async () => {
      setGeminiResponse({
        noMatch: true,
        requestedService: 'Rocket Branding',
        allServicesGrouped: [
          { category: 'Outdoor', services: [{ name: 'Bus Semi Branding' }] },
        ],
      });

      const result = await sendMessageToGemini({
        userMessage: 'Quote for rocket branding',
      });

      expect(result.isNoMatch).toBe(true);
      expect(result.isQuoteGeneration).toBe(false);
      expect(result.matchType).toBe('none');
      expect(result.requestedService).toBe('Rocket Branding');
    });

    it('throws when Gemini API key is not configured', async () => {
      vi.stubEnv('VITE_GEMINI_API_KEY', '');
      await expect(
        sendMessageToGemini({ userMessage: 'any message' })
      ).rejects.toThrow();
      vi.unstubAllEnvs();
    });

    it('includes proposalTexts document content in the context sent to Gemini', async () => {
      setGeminiResponse('Which service are you looking for?');

      await sendMessageToGemini({
        userMessage: 'What services do you have?',
        proposalTexts: [{ fileName: 'test.pdf', content: 'Bus Semi Branding rate is ₹5000 per month.' }],
      });

      // generateContent must have been called with a prompt containing the proposal
      const calledArg: string = mockGenerateContent.mock.calls[0][0];
      expect(calledArg).toContain('Bus Semi Branding rate is ₹5000 per month.');
    });

    it('includes all proposalTexts documents in the context when multi-doc is provided', async () => {
      setGeminiResponse('Here are the available services.');

      await sendMessageToGemini({
        userMessage: 'Give me all services',
        proposalTexts: [
          { fileName: 'Chennai_Rate_Card.pdf', content: 'Chennai outdoor advertising rates' },
          { fileName: 'Bangalore_Rate_Card.pdf', content: 'Bangalore outdoor advertising rates' },
        ],
      });

      const calledArg: string = mockGenerateContent.mock.calls[0][0];
      expect(calledArg).toContain('Chennai_Rate_Card.pdf');
      expect(calledArg).toContain('Bangalore_Rate_Card.pdf');
    });

    it('includes the user message in the prompt sent to Gemini', async () => {
      setGeminiResponse('Sure, here is the info.');

      await sendMessageToGemini({
        userMessage: 'UNIQUE_USER_TEST_MESSAGE_12345',
      });

      const calledArg: string = mockGenerateContent.mock.calls[0][0];
      expect(calledArg).toContain('UNIQUE_USER_TEST_MESSAGE_12345');
    });

    it('returns a message string in all response types', async () => {
      setGeminiResponse('Hello, how can I help?');

      const result = await sendMessageToGemini({ userMessage: 'Hi' });

      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // validateAndFixQuoteDescriptions (indirect — via sendMessageToGemini)
  // Cannot be tested directly as it is not exported. Tested via the
  // EXACT_MATCH code path of sendMessageToGemini which calls it internally.
  // ─────────────────────────────────────────────
  describe('validateAndFixQuoteDescriptions (via sendMessageToGemini)', () => {
    const setGeminiResponse = (json: object) => {
      mockGenerateContent = vi.fn().mockResolvedValue({
        response: { text: () => JSON.stringify(json) },
      });
    };

    it('prepends the item title when description is missing the service prefix', async () => {
      setGeminiResponse({
        quoteGenerated: true,
        items: [
          {
            title: 'Bus Semi Branding',
            lineItems: [
              // ❌ Description does NOT start with the title
              { description: 'Rental Price (per bus month)', quantity: 10, unitPrice: 5000, total: 50000 },
            ],
          },
        ],
      });

      const result = await sendMessageToGemini({ userMessage: 'quote for bus semi branding' });

      const desc = result.quoteData?.items[0].lineItems[0].description;
      // ✅ Should now start with the service title
      expect(desc).toContain('Bus Semi Branding');
      expect(desc?.startsWith('Bus Semi Branding')).toBe(true);
    });

    it('does NOT modify description when it already starts with the service title', async () => {
      setGeminiResponse({
        quoteGenerated: true,
        items: [
          {
            title: 'Bus Semi Branding',
            lineItems: [
              // ✅ Already correct
              { description: 'Bus Semi Branding - Rental Price', quantity: 10, unitPrice: 5000, total: 50000 },
            ],
          },
        ],
      });

      const result = await sendMessageToGemini({ userMessage: 'quote for bus semi branding' });

      const desc = result.quoteData?.items[0].lineItems[0].description;
      // Should NOT produce doubled prefix like "Bus Semi Branding - Bus Semi Branding - ..."
      expect(desc).toBe('Bus Semi Branding - Rental Price');
    });

    it('fixes descriptions across multiple items in a single quote', async () => {
      setGeminiResponse({
        quoteGenerated: true,
        items: [
          {
            title: 'Auto Back Stickers',
            lineItems: [
              { description: 'Display Price', quantity: 50, unitPrice: 800, total: 40000 },
            ],
          },
          {
            title: 'Bus Full Branding',
            lineItems: [
              { description: 'Printing Cost', quantity: 5, unitPrice: 12000, total: 60000 },
            ],
          },
        ],
      });

      const result = await sendMessageToGemini({ userMessage: 'quote for auto and bus' });

      const desc0 = result.quoteData?.items[0].lineItems[0].description;
      const desc1 = result.quoteData?.items[1].lineItems[0].description;
      expect(desc0).toContain('Auto Back Stickers');
      expect(desc1).toContain('Bus Full Branding');
    });

    it('returns quote unchanged when lineItems array is empty', async () => {
      setGeminiResponse({
        quoteGenerated: true,
        items: [
          {
            title: 'Bus Semi Branding',
            lineItems: [],
          },
        ],
      });

      const result = await sendMessageToGemini({ userMessage: 'quote for bus semi' });

      expect(result.isQuoteGeneration).toBe(true);
      expect(result.quoteData.items[0].lineItems).toHaveLength(0);
    });

    it('preserves unitPrice, quantity and total when fixing description', async () => {
      setGeminiResponse({
        quoteGenerated: true,
        items: [
          {
            title: 'Auto Full Branding',
            lineItems: [
              { description: 'Rental Price', quantity: 20, unitPrice: 3000, total: 60000 },
            ],
          },
        ],
      });

      const result = await sendMessageToGemini({ userMessage: 'quote for auto full branding' });

      const lineItem = result.quoteData?.items[0].lineItems[0];
      expect(lineItem.quantity).toBe(20);
      expect(lineItem.unitPrice).toBe(3000);
      expect(lineItem.total).toBe(60000);
    });

    it('does NOT double-prefix when city is already part of description', async () => {
      setGeminiResponse({
        quoteGenerated: true,
        items: [
          {
            title: 'Auto Back Stickers',
            lineItems: [
              // Contains the title name inside (Chennai - Auto Back Stickers pattern)
              { description: 'Chennai - Auto Back Stickers - Display Price', quantity: 100, unitPrice: 500, total: 50000 },
            ],
          },
        ],
      });

      const result = await sendMessageToGemini({ userMessage: 'quote' });

      const desc = result.quoteData?.items[0].lineItems[0].description;
      // Should not prepend again
      expect(desc).toBe('Chennai - Auto Back Stickers - Display Price');
    });
  });
});
