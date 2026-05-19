import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __internal, logger } from '../logger';

describe('logger', () => {
  const debugSpy = vi.spyOn(console, 'debug');
  const infoSpy = vi.spyOn(console, 'info');
  const warnSpy = vi.spyOn(console, 'warn');
  const errorSpy = vi.spyOn(console, 'error');

  const noop = (): void => undefined;

  beforeEach(() => {
    debugSpy.mockImplementation(noop as never);
    infoSpy.mockImplementation(noop as never);
    warnSpy.mockImplementation(noop as never);
    errorSpy.mockImplementation(noop as never);
  });

  afterEach(() => {
    debugSpy.mockReset();
    infoSpy.mockReset();
    warnSpy.mockReset();
    errorSpy.mockReset();
  });

  describe('routing', () => {
    it('routes debug/info/warn/error to matching console methods', () => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      // In test env (NODE_ENV=test, PROD=false), default level is debug → all fire
      expect(debugSpy).toHaveBeenCalledWith('d');
      expect(infoSpy).toHaveBeenCalledWith('i');
      expect(warnSpy).toHaveBeenCalledWith('w');
      expect(errorSpy).toHaveBeenCalledWith('e');
    });

    it('forwards multiple arguments preserving structured data', () => {
      const meta = { userId: 'u-1' };
      logger.info('hello', meta, 42);
      expect(infoSpy).toHaveBeenCalledWith('hello', meta, 42);
    });
  });

  describe('PII redaction (in production only)', () => {
    it('redactString masks emails', () => {
      const out = __internal.redactString('contact alice@example.com today');
      expect(out).toBe('contact [REDACTED_EMAIL] today');
    });

    it('redactString masks Indian GSTIN', () => {
      const out = __internal.redactString('GSTIN: 22AAAAA0000A1Z5');
      expect(out).toBe('GSTIN: [REDACTED_GSTIN]');
    });

    it('redactString masks phone numbers', () => {
      const out = __internal.redactString('call +91 98765 43210 now');
      expect(out).toContain('[REDACTED_PHONE]');
      expect(out).not.toContain('98765');
    });

    it('redactString leaves benign text alone', () => {
      expect(__internal.redactString('quote total is $1,234')).toBe('quote total is $1,234');
    });
  });
});
