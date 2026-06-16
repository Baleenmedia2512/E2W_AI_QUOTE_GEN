import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, __internal } from '../../src/utils/logger';

// Spy on console methods
const spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
const spyInfo  = vi.spyOn(console, 'info').mockImplementation(() => {});
const spyWarn  = vi.spyOn(console, 'warn').mockImplementation(() => {});
const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // Basic routing
  // ─────────────────────────────────────────────
  describe('routing to correct console method', () => {
    it('logger.debug routes to console.debug', () => {
      logger.debug('debug message');
      expect(spyDebug).toHaveBeenCalledWith('debug message');
    });

    it('logger.info routes to console.info', () => {
      logger.info('info message');
      expect(spyInfo).toHaveBeenCalledWith('info message');
    });

    it('logger.warn routes to console.warn', () => {
      logger.warn('warn message');
      expect(spyWarn).toHaveBeenCalledWith('warn message');
    });

    it('logger.error routes to console.error', () => {
      logger.error('error message');
      expect(spyError).toHaveBeenCalledWith('error message');
    });
  });

  // ─────────────────────────────────────────────
  // Multiple args
  // ─────────────────────────────────────────────
  describe('multiple arguments', () => {
    it('passes multiple args through to console', () => {
      logger.info('Message', { key: 'value' }, 42);
      expect(spyInfo).toHaveBeenCalledWith('Message', { key: 'value' }, 42);
    });

    it('handles Error objects', () => {
      const err = new Error('test error');
      logger.error('Something failed', err);
      expect(spyError).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // PII redaction (via __internal.redactString)
  // ─────────────────────────────────────────────
  describe('__internal.redactString (PII redaction)', () => {
    it('redacts email addresses', () => {
      const result = __internal.redactString('User email: admin@baleenmedia.com logged in');
      expect(result).not.toContain('admin@baleenmedia.com');
      expect(result).toContain('[REDACTED_EMAIL]');
    });

    it('redacts phone numbers (10+ digit sequences)', () => {
      const result = __internal.redactString('Call us at +91 9876543210 today');
      expect(result).not.toContain('9876543210');
      expect(result).toContain('[REDACTED_PHONE]');
    });

    it('redacts GSTIN patterns', () => {
      const result = __internal.redactString('GSTIN: 27AABCB1234E1ZX');
      expect(result).not.toContain('27AABCB1234E1ZX');
      expect(result).toContain('[REDACTED_GSTIN]');
    });

    it('returns string unchanged when no PII present', () => {
      const clean = 'Quote generated successfully';
      expect(__internal.redactString(clean)).toBe(clean);
    });

    it('redacts multiple emails in one string', () => {
      const result = __internal.redactString('From: a@test.com To: b@test.com');
      expect(result).not.toContain('@test.com');
      const matches = (result.match(/\[REDACTED_EMAIL\]/g) || []).length;
      expect(matches).toBe(2);
    });
  });

  // ─────────────────────────────────────────────
  // __internal exports
  // ─────────────────────────────────────────────
  describe('__internal metadata', () => {
    it('exports isProd boolean', () => {
      expect(typeof __internal.isProd).toBe('boolean');
    });

    it('exports envLevel string', () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      expect(validLevels).toContain(__internal.envLevel);
    });

    it('exports redactString function', () => {
      expect(typeof __internal.redactString).toBe('function');
    });
  });
});
