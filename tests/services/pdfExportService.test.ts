import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateElementForExport,
  estimatePDFSize,
  exportToPDF,
  exportToPDFWithOptions,
} from '../../src/services/pdfExportService';

// ── Module mocks ──────────────────────────────────────────────────────────────
let mockIsNativePlatform = false;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform,
    isPluginAvailable: () => false,
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn().mockResolvedValue({ uri: 'file:///docs/quote.pdf' }),
  },
  Directory: { Documents: 'DOCUMENTS' },
}));

vi.mock('@capacitor-community/file-opener', () => ({
  FileOpener: { open: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/plugins/downloadNotification', () => ({
  default: { showDownloadNotification: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock canvas returned by html2canvas
const createMockCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 794;
  canvas.height = 1123;
  canvas.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,ABC=');
  return canvas;
};

vi.mock('html2canvas', () => ({
  default: vi.fn().mockImplementation(() => Promise.resolve(createMockCanvas())),
}));

// jsPDF mock — each instance gets trackable methods
const mockPdfSave = vi.fn();
const mockPdfAddPage = vi.fn();
const mockPdfAddImage = vi.fn();
const mockPdfOutput = vi.fn().mockReturnValue('data:application/pdf;base64,XXX=,abc');
const mockPdfSetProperties = vi.fn();
const mockPdfLink = vi.fn();

vi.mock('jspdf', () => ({
  default: vi.fn().mockImplementation(() => ({
    addPage: mockPdfAddPage,
    addImage: mockPdfAddImage,
    save: mockPdfSave,
    output: mockPdfOutput,
    setProperties: mockPdfSetProperties,
    link: mockPdfLink,
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    setPage: vi.fn(),
    text: vi.fn(),
    getNumberOfPages: vi.fn().mockReturnValue(1),
    getCurrentPageInfo: vi.fn().mockReturnValue({ pageNumber: 1 }),
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
  })),
}));

// pdfExportService uses jsPDF, html2canvas, and Capacitor which are DOM/native.
// We test only the pure helper functions that don't require DOM rendering.

describe('pdfExportService — pure helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNativePlatform = false;
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

// ─────────────────────────────────────────────────────────────────────────────
// exportToPDFWithOptions — integration tests (html2canvas + jsPDF mocked)
// ─────────────────────────────────────────────────────────────────────────────
describe('exportToPDFWithOptions', () => {
  let el: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNativePlatform = false;
    el = document.createElement('div');
    el.id = 'test-element';
    document.body.appendChild(el);
  });

  afterEach(() => {
    document.body.removeChild(el);
  });

  it('calls html2canvas with the provided element', async () => {
    const html2canvas = (await import('html2canvas')).default as ReturnType<typeof vi.fn>;
    await exportToPDFWithOptions(el, { quoteNumber: 'Q-001', templateType: 'corporate-minimal' });
    expect(html2canvas).toHaveBeenCalledWith(el, expect.objectContaining({ scale: 2 }));
  });

  it('calls pdf.save on web (non-mobile) platform', async () => {
    mockIsNativePlatform = false;
    await exportToPDFWithOptions(el, { quoteNumber: 'Q-001', templateType: 'corporate-minimal' });
    expect(mockPdfSave).toHaveBeenCalledTimes(1);
  });

  it('uses custom filename option when provided', async () => {
    mockIsNativePlatform = false;
    await exportToPDFWithOptions(el, {
      quoteNumber: 'Q-001',
      templateType: 'corporate-minimal',
      filename: 'my-custom-quote.pdf',
    });
    expect(mockPdfSave).toHaveBeenCalledWith('my-custom-quote.pdf');
  });

  it('calls Filesystem.writeFile on mobile (Capacitor) platform', async () => {
    mockIsNativePlatform = true;
    const { Filesystem } = await import('@capacitor/filesystem');
    await exportToPDFWithOptions(el, { quoteNumber: 'Q-002', templateType: 'premium-agency' });
    expect(Filesystem.writeFile).toHaveBeenCalledTimes(1);
  });

  it('throws an error when html2canvas rejects', async () => {
    const html2canvas = (await import('html2canvas')).default as ReturnType<typeof vi.fn>;
    html2canvas.mockRejectedValueOnce(new Error('canvas failure'));
    await expect(
      exportToPDFWithOptions(el, { quoteNumber: 'Q-ERR', templateType: 'corporate-minimal' }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportToPDF — fallback path (no DOM sections → legacyFullCapture)
// ─────────────────────────────────────────────────────────────────────────────
describe('exportToPDF', () => {
  let el: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNativePlatform = false;
    el = document.createElement('div');
    el.id = 'test-export-element';
    document.body.appendChild(el);

    // legacyFullCapture (and captureSectionAtA4) call document.fonts.ready.
    // jsdom 24 defines document.fonts but its ready promise may not settle
    // reliably without real font loading; stub it so the export path resolves.
    try {
      Object.defineProperty(document, 'fonts', {
        value: { ready: Promise.resolve(), check: () => true },
        configurable: true,
        writable: true,
      });
    } catch {
      // If already non-configurable, patch ready in place
      if (document.fonts) {
        (document.fonts as unknown as Record<string, unknown>).ready = Promise.resolve();
      }
    }
  });

  afterEach(() => {
    document.body.removeChild(el);
  });

  it('completes without throwing when no PDF sections exist in DOM', async () => {
    // No pdf-page-1, pdf-page-summary etc. in DOM → falls back to legacyFullCapture
    await expect(
      exportToPDF(el, 'Q-001', 'corporate-minimal'),
    ).resolves.not.toThrow();
  });
});

