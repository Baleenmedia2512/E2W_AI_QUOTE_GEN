import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateElementForExport,
  estimatePDFSize,
} from '../../src/services/pdfExportService';

// pdfExportService uses jsPDF, html2canvas, and Capacitor which are DOM/native.
// We test only the pure helper functions that don't require DOM rendering.

describe('pdfExportService — pure helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // validateElementForExport
  // ─────────────────────────────────────────────
  describe('validateElementForExport', () => {
    it('returns false for null', () => {
      expect(validateElementForExport(null)).toBe(false);
    });

    it('returns false for an element with no dimensions (jsdom default)', () => {
      // In jsdom, scrollHeight/scrollWidth are 0 unless mocked
      const el = document.createElement('div');
      el.innerHTML = '<p>Content</p>';
      // jsdom always returns 0 for scroll dimensions — validateElementForExport correctly returns false
      expect(validateElementForExport(el)).toBe(false);
    });

    it('returns true for element with non-zero scroll dimensions', () => {
      const el = document.createElement('div');
      // Override jsdom's 0-value scroll dimensions
      Object.defineProperty(el, 'scrollHeight', { value: 200, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 400, configurable: true });
      expect(validateElementForExport(el)).toBe(true);
    });

    it('returns false for element with zero scrollHeight even if scrollWidth > 0', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 0, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 400, configurable: true });
      expect(validateElementForExport(el)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // estimatePDFSize
  // ─────────────────────────────────────────────
  describe('estimatePDFSize', () => {
    it('returns a number (always — based on scrollWidth * scrollHeight)', () => {
      const el = document.createElement('div');
      const size = estimatePDFSize(el);
      expect(typeof size).toBe('number');
    });

    it('returns a non-negative value', () => {
      const el = document.createElement('div');
      expect(estimatePDFSize(el)).toBeGreaterThanOrEqual(0);
    });

    it('returns 0 when element has no scroll dimensions (jsdom default)', () => {
      const el = document.createElement('div');
      // jsdom: scrollWidth=0, scrollHeight=0 → 0 * 0 * factor = 0
      expect(estimatePDFSize(el)).toBe(0);
    });

    it('returns larger value for element with bigger dimensions', () => {
      const smallEl = document.createElement('div');
      Object.defineProperty(smallEl, 'scrollHeight', { value: 100, configurable: true });
      Object.defineProperty(smallEl, 'scrollWidth', { value: 100, configurable: true });

      const largeEl = document.createElement('div');
      Object.defineProperty(largeEl, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(largeEl, 'scrollWidth', { value: 800, configurable: true });

      expect(estimatePDFSize(largeEl)).toBeGreaterThan(estimatePDFSize(smallEl));
    });
  });
});
