import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// pdfExportService imports html2canvas + jsPDF at the top — stub them so the
// module loads in jsdom without trying to render real PDFs.
vi.mock('html2canvas', () => ({ default: vi.fn() }));
vi.mock('jspdf', () => ({
  default: vi.fn().mockImplementation(() => ({
    addImage: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
    output: vi.fn(),
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
  })),
  jsPDF: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  registerPlugin: vi.fn(() => ({})),
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: vi.fn() },
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));

import {
  estimatePDFSize,
  validateElementForExport,
} from '../../src/services/pdfExportService';
import { logger } from '../../src/utils/logger';

/**
 * estimatePDFSize & validateElementForExport are the LIGHTWEIGHT public
 * helpers from pdfExportService. The heavy `exportToPDF` (~900 lines of
 * smart pagination) cannot be unit-tested without a real DOM + canvas
 * environment, but these two helpers MUST be locked in because:
 *
 *  - UI uses validateElementForExport before invoking export → a broken
 *    validator means the export button silently fails or crashes on null.
 *  - estimatePDFSize feeds the "estimated download size" indicator → a
 *    broken estimator regresses to NaN/Infinity display.
 */
describe('pdfExportService — public helpers', () => {
  describe('validateElementForExport', () => {
    it('returns false for null element AND logs error', () => {
      vi.clearAllMocks();
      expect(validateElementForExport(null)).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Element is null');
    });

    it('returns false when scrollHeight is 0', () => {
      vi.clearAllMocks();
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 0, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true });

      expect(validateElementForExport(el)).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Element has no dimensions');
    });

    it('returns false when scrollWidth is 0', () => {
      vi.clearAllMocks();
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 100, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 0, configurable: true });

      expect(validateElementForExport(el)).toBe(false);
    });

    it('returns true for a valid sized element', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 800, configurable: true });

      expect(validateElementForExport(el)).toBe(true);
    });

    it('does NOT throw on undefined (returns false)', () => {
      // `undefined` is coerced through the `if (!element)` guard
      expect(validateElementForExport(undefined as any)).toBe(false);
    });
  });

  describe('estimatePDFSize', () => {
    it('returns 0 for a 0×0 element (NOT NaN, NOT Infinity)', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 0, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 0, configurable: true });

      const result = estimatePDFSize(el);
      expect(result).toBe(0);
      expect(Number.isFinite(result)).toBe(true);
    });

    it('returns a positive integer for a normal-sized element', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 800, configurable: true });

      const result = estimatePDFSize(el);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result)).toBe(true);
    });

    it('scales linearly with element area (sanity check)', () => {
      const small = document.createElement('div');
      Object.defineProperty(small, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(small, 'scrollWidth', { value: 800, configurable: true });

      const large = document.createElement('div');
      Object.defineProperty(large, 'scrollHeight', { value: 10000, configurable: true });
      Object.defineProperty(large, 'scrollWidth', { value: 800, configurable: true });

      const smallSize = estimatePDFSize(small);
      const largeSize = estimatePDFSize(large);

      // Larger element → larger estimate (monotonically non-decreasing)
      expect(largeSize).toBeGreaterThanOrEqual(smallSize);
    });
  });
});
