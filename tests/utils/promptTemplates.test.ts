import { describe, it, expect } from 'vitest';
import {
  QUOTE_GENERATION_PROMPT,
  CHAT_SYSTEM_PROMPT,
} from '../../src/utils/promptTemplates';

describe('QUOTE_GENERATION_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof QUOTE_GENERATION_PROMPT).toBe('string');
    expect(QUOTE_GENERATION_PROMPT.trim().length).toBeGreaterThan(0);
  });

  it('instructs AI to return a JSON object', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('JSON');
  });

  it('includes the "items" key in the expected JSON shape', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('"items"');
  });

  it('includes "duration" field for multi-month/day pricing rule', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('duration');
  });

  it('includes "minimumQuantity" for minimum quantity business rule', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('minimumQuantity');
  });

  it('includes "termsAndConditions" to copy terms from proposal', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('termsAndConditions');
  });

  it('includes "deliveryTimeline" field in the schema', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('deliveryTimeline');
  });

  it('mentions "unitPrice" for pricing calculations', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('unitPrice');
  });

  it('mentions "quantity" field', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('quantity');
  });

  it('explains Total = quantity × unitPrice × duration formula', () => {
    expect(QUOTE_GENERATION_PROMPT).toContain('quantity × unitPrice × duration');
  });
});

describe('CHAT_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof CHAT_SYSTEM_PROMPT).toBe('string');
    expect(CHAT_SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });

  it('contains EXACT_MATCH tier instruction', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('EXACT_MATCH');
  });

  it('contains MULTIPLE_MATCH tier instruction', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('MULTIPLE_MATCH');
  });

  it('contains PARTIAL_MATCH tier instruction', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('PARTIAL_MATCH');
  });

  it('contains NO_MATCH tier instruction', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('NO_MATCH');
  });

  it('instructs AI to search for "bus" services (core business rule)', () => {
    expect(CHAT_SYSTEM_PROMPT.toLowerCase()).toContain('bus');
  });

  it('instructs AI to list ALL services when searching', () => {
    expect(CHAT_SYSTEM_PROMPT.toUpperCase()).toContain('ALL');
  });

  it('instructs AI to ask for clarification on ambiguous requests', () => {
    // The prompt must tell the AI to ask user when multiple services match
    expect(CHAT_SYSTEM_PROMPT.toLowerCase()).toContain('clarif');
  });

  it('does not leak API keys or secrets in the prompt text', () => {
    // Safety check: prompts must never contain hardcoded credentials
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/AIza[0-9A-Za-z_-]{35}/); // Google API key pattern
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/sk-[A-Za-z0-9]{20,}/);   // OpenAI key pattern
  });
});
