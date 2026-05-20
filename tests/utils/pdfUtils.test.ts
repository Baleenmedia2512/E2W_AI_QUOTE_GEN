import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractPDFContent, validatePDFFile } from '../../src/utils/pdfUtils';

// ── Mock heavy external dependencies before importing the module ──────────
vi.mock('pdfjs-dist', () => ({
  default: {
    GlobalWorkerOptions: { workerSrc: '' },
    version: '4.0.379',
    getDocument: vi.fn(),
  },
  GlobalWorkerOptions: { workerSrc: '' },
  version: '4.0.379',
  getDocument: vi.fn(),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => '[]' },
      }),
    }),
  })),
}));

vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helper: expose private function via dynamic import hack ───────────────
// shouldAttemptCropping is not exported — we test its effect via the
// exported extractPDFContent / through a re-export shim. Since it is an
// internal helper, we validate the rules it embodies directly.

describe('pdfUtils – shouldAttemptCropping rules', () => {
  // We mirror the exact logic of the private function so we can unit-test
  // each branch independently without coupling to the private symbol.
  function shouldAttemptCropping(pageText: string): boolean {
    const text = pageText
      .toLowerCase()
      .replace(/\s*\|\s*/g, '')
      .replace(/\s+/g, ' ');

    if (
      text.includes('reference image') ||
      text.includes('reference images') ||
      text.includes('design specification') ||
      text.includes('design specifications') ||
      text.includes('design specs') ||
      text.includes('specification') ||
      text.includes('customer review') ||
      text.includes('client review') ||
      text.includes('reference photo') ||
      text.includes('example image') ||
      text.includes('sample photo') ||
      text.includes('sample image') ||
      text.includes('display area')
    ) {
      return true;
    }

    const pagePattern = text.match(/\((\d+)\/(\d+)\)/);
    if (pagePattern && parseInt(pagePattern[1]) >= 2) {
      return true;
    }

    if (pageText.trim().length < 150) {
      return true;
    }

    return false;
  }

  describe('keyword triggers', () => {
    it('returns true for "reference image"', () => {
      expect(shouldAttemptCropping('This page has a Reference Image for review')).toBe(true);
    });

    it('returns true for "design specification"', () => {
      expect(shouldAttemptCropping('Design Specification details below')).toBe(true);
    });

    it('returns true for "design specs"', () => {
      expect(shouldAttemptCropping('See design specs attached')).toBe(true);
    });

    it('returns true for "customer review"', () => {
      expect(shouldAttemptCropping('Customer Review comments here')).toBe(true);
    });

    it('returns true for "client review"', () => {
      expect(shouldAttemptCropping('Client Review pending')).toBe(true);
    });

    it('returns true for "sample image"', () => {
      expect(shouldAttemptCropping('Sample Image shown below')).toBe(true);
    });

    it('returns true for "display area"', () => {
      expect(shouldAttemptCropping('Display Area specifications')).toBe(true);
    });

    it('is case-insensitive for all keywords', () => {
      expect(shouldAttemptCropping('REFERENCE IMAGE')).toBe(true);
      expect(shouldAttemptCropping('Design Specifications')).toBe(true);
    });
  });

  describe('page number pattern trigger', () => {
    it('returns true for page 2 of N pattern "(2/5)"', () => {
      expect(
        shouldAttemptCropping(
          'Some normal page content without keywords (2/5) end of page'.repeat(5),
        ),
      ).toBe(true);
    });

    it('returns true for page 3 of N pattern "(3/10)"', () => {
      expect(
        shouldAttemptCropping('Long enough content here at page (3/10) of the document'.repeat(5)),
      ).toBe(true);
    });

    it('returns false for page 1 pattern "(1/5)" with long text', () => {
      const longText =
        'This is page one content without any special keywords at all just plain text that is long enough to not trigger the short text check (1/5)'.repeat(
          2,
        );
      expect(shouldAttemptCropping(longText)).toBe(false);
    });
  });

  describe('short text trigger', () => {
    it('returns true when page text is under 150 characters', () => {
      expect(shouldAttemptCropping('Short page.')).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(shouldAttemptCropping('')).toBe(true);
    });

    it('returns true for exactly 149 chars of whitespace-trimmed text', () => {
      expect(shouldAttemptCropping('a'.repeat(149))).toBe(true);
    });

    it('returns false for text >= 150 chars with no other triggers', () => {
      const longNormalText =
        'This is a completely normal pricing table page with absolutely no special keywords, just plain rates and detailed descriptions for various advertising services available in the media plan.';
      // Sanity: confirm string is indeed >= 150 chars
      expect(longNormalText.length).toBeGreaterThanOrEqual(150);
      expect(shouldAttemptCropping(longNormalText)).toBe(false);
    });
  });
});

describe('pdfUtils – IoU bounding-box deduplication logic', () => {
  // Mirror the IoU deduplication logic to test it in isolation
  type Box = { box: [number, number, number, number]; label: string };

  function deduplicateBoxes(validBoxes: Box[]): Box[] {
    const sorted = [...validBoxes].sort((a, b) => {
      const areaA = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
      const areaB = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
      return areaB - areaA;
    });

    const deduped: Box[] = [];
    for (const box of sorted) {
      const [yMin, xMin, yMax, xMax] = box.box;
      const boxArea = (yMax - yMin) * (xMax - xMin);
      const overlaps = deduped.some((k) => {
        const [kyMin, kxMin, kyMax, kxMax] = k.box;
        const kArea = (kyMax - kyMin) * (kxMax - kxMin);
        const interY = Math.max(0, Math.min(yMax, kyMax) - Math.max(yMin, kyMin));
        const interX = Math.max(0, Math.min(xMax, kxMax) - Math.max(xMin, kxMin));
        const interArea = interY * interX;
        const unionArea = boxArea + kArea - interArea;
        const iou = unionArea > 0 ? interArea / unionArea : 0;
        return iou > 0.4;
      });
      if (!overlaps) deduped.push(box);
    }
    return deduped;
  }

  it('keeps a single box unchanged', () => {
    const boxes: Box[] = [{ box: [100, 100, 400, 400], label: 'bus' }];
    expect(deduplicateBoxes(boxes)).toHaveLength(1);
  });

  it('removes duplicate boxes with >40% IoU overlap', () => {
    const boxes: Box[] = [
      { box: [100, 100, 500, 500], label: 'bus mockup 1' },
      { box: [110, 110, 490, 490], label: 'bus mockup 2' }, // nearly identical → duplicate
    ];
    expect(deduplicateBoxes(boxes)).toHaveLength(1);
  });

  it('keeps two non-overlapping boxes', () => {
    const boxes: Box[] = [
      { box: [0, 0, 300, 300], label: 'left image' },
      { box: [600, 600, 900, 900], label: 'right image' }, // no overlap
    ];
    expect(deduplicateBoxes(boxes)).toHaveLength(2);
  });

  it('prefers larger box when deduplicating', () => {
    const boxes: Box[] = [
      { box: [100, 100, 300, 300], label: 'small' },
      { box: [90, 90, 400, 400], label: 'large' }, // larger → should be kept
    ];
    const result = deduplicateBoxes(boxes);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('large');
  });

  it('returns empty array when input is empty', () => {
    expect(deduplicateBoxes([])).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractPDFContent
// ─────────────────────────────────────────────────────────────────────────────

describe('extractPDFContent', () => {
  // ── Item / page / PDF factories ─────────────────────────────────────────
  const makeItem = (str: string, x: number, y: number) => ({
    str,
    transform: [1, 0, 0, 1, x, y],
  });

  const makePage = (items: ReturnType<typeof makeItem>[]) => ({
    getTextContent: vi.fn().mockResolvedValue({ items }),
    getViewport: vi.fn().mockReturnValue({ width: 200, height: 300 }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  });

  const makePDF = (pageItemArrays: ReturnType<typeof makeItem>[][]) => {
    const pages = pageItemArrays.map(makePage);
    return {
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: vi.fn().mockImplementation((i: number) => Promise.resolve(pages[i - 1])),
      }),
    };
  };

  const makeFile = (name = 'test.pdf') =>
    ({
      name,
      type: 'application/pdf',
      size: 100,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }) as unknown as File;

  beforeEach(() => {
    vi.mocked(pdfjsLib.getDocument).mockReset();
    vi.mocked(GoogleGenerativeAI).mockReset();
    // Restore default Gemini mock (returns empty box list → no cropping)
    vi.mocked(GoogleGenerativeAI).mockImplementation(
      () =>
        ({
          getGenerativeModel: vi.fn().mockReturnValue({
            generateContent: vi.fn().mockResolvedValue({
              response: { text: () => '[]' },
            }),
          }),
        }) as any,
    );
    // Canvas: return a real-enough 2d context so render/toDataURL work
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,mockPage',
    );
    // Image: auto-trigger onload so cropImageRegions resolves correctly
    const createMockImage = () => {
      const img: any = {
        naturalWidth: 200,
        naturalHeight: 300,
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      Object.defineProperty(img, 'src', {
        set(_: string) {
          Promise.resolve().then(() => img.onload?.());
        },
      });
      return img;
    };
    vi.stubGlobal('Image', vi.fn(() => createMockImage()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // ── Text extraction ─────────────────────────────────────────────────────

  it('returns textContent extracted from a single-page PDF', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[makeItem('Hello World', 50, 100)]]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.textContent).toContain('Hello World');
  });

  it('returns correct pageCount matching PDF numPages', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([
        [makeItem('First page text', 50, 100)],
        [makeItem('Second page text', 50, 100)],
        [makeItem('Third page text', 50, 100)],
      ]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.pageCount).toBe(3);
  });

  it('always returns an empty images array', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[makeItem('Some text content', 50, 100)]]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.images).toEqual([]);
  });

  it('concatenates text from multiple pages', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([
        [makeItem('Alpha page', 50, 100)],
        [makeItem('Beta page', 50, 100)],
      ]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.textContent).toContain('Alpha page');
    expect(result.textContent).toContain('Beta page');
  });

  it('handles pages with no text items without crashing', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([
        [], // empty page
        [makeItem('Non-empty page content', 50, 100)],
      ]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.pageCount).toBe(2);
    expect(result.textContent).toContain('Non-empty page content');
  });

  it('inserts newline between items whose Y positions differ by more than 5', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([
        [
          makeItem('Line one', 50, 200), // sorted first (higher Y = top of page)
          makeItem('Line two', 50, 100), // Y diff = 100 → newline between them
        ],
      ]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.textContent).toContain('Line one');
    expect(result.textContent).toContain('Line two');
    expect(result.textContent).toContain('\n');
  });

  it('inserts tab separator when X gap between adjacent items on same row exceeds 50', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([
        [
          makeItem('Left', 10, 100),   // same Y
          makeItem('Right', 200, 100), // X gap = 190 > 50 → tab separator
        ],
      ]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.textContent).toContain('\t|\t');
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it('throws "PDF appears to be empty" when all pages have no text', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[], []]) as any, // two pages, both empty
    );
    await expect(extractPDFContent(makeFile())).rejects.toThrow(
      'PDF appears to be empty or contains only images',
    );
  });

  it('propagates the "empty" error message directly without wrapping it', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(makePDF([[]]) as any);
    const err = await extractPDFContent(makeFile()).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('Failed to extract PDF content');
    expect((err as Error).message).toContain('empty');
  });

  it('wraps unexpected errors in "Failed to extract PDF content"', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.reject(new Error('corrupt stream data')),
    } as any);
    await expect(extractPDFContent(makeFile())).rejects.toThrow(
      'Failed to extract PDF content: corrupt stream data',
    );
  });

  // ── pageImages ──────────────────────────────────────────────────────────

  it('pageImages has one entry per successfully rendered page', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([
        [makeItem('Page one content', 50, 100)],
        [makeItem('Page two content', 50, 100)],
      ]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.pageImages).toHaveLength(2);
  });

  it('each pageImages entry contains pageNumber, text, and imageDataUrl', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[makeItem('Page content here', 50, 100)]]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result.pageImages[0]).toMatchObject({
      pageNumber: 1,
      imageDataUrl: 'data:image/jpeg;base64,mockPage',
    });
    expect(typeof result.pageImages[0].text).toBe('string');
  });

  it('page render failure is non-fatal: other pages still appear in pageImages', async () => {
    const page1 = makePage([makeItem('Page one content', 50, 100)]);
    const page2 = makePage([makeItem('Page two content', 50, 100)]);
    // Make page 1 render throw
    page1.render.mockReturnValue({ promise: Promise.reject(new Error('render failed')) });
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn().mockImplementation((i: number) =>
          Promise.resolve(i === 1 ? page1 : page2),
        ),
      }),
    } as any);
    const result = await extractPDFContent(makeFile());
    expect(result.pageCount).toBe(2);
    expect(result.textContent).toContain('Page one content');
    expect(result.textContent).toContain('Page two content');
    // Only page 2 rendered successfully
    expect(result.pageImages).toHaveLength(1);
    expect(result.pageImages[0].pageNumber).toBe(2);
  });

  // ── Auto-crop (Gemini Vision) ───────────────────────────────────────────

  it('Gemini Vision is not called when the API key env var is empty', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', '');
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      // "Reference Image" text qualifies for cropping attempt
      makePDF([[makeItem('Reference Image section heading here', 50, 100)]]) as any,
    );
    await extractPDFContent(makeFile());
    // Constructor never invoked → no Gemini calls made
    expect(vi.mocked(GoogleGenerativeAI)).not.toHaveBeenCalled();
  });

  it('croppedImages not set on page when Gemini returns empty box array', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    // Default mock already returns '[]'
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[makeItem('Reference Image section heading here', 50, 100)]]) as any,
    );
    const result = await extractPDFContent(makeFile());
    const pagesWithCropped = result.pageImages.filter(
      (p: any) => p.croppedImages && (p.croppedImages as string[]).length > 0,
    );
    expect(pagesWithCropped).toHaveLength(0);
  });

  it('croppedImages populated on page when Gemini returns valid bounding boxes', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    vi.mocked(GoogleGenerativeAI).mockImplementation(
      () =>
        ({
          getGenerativeModel: vi.fn().mockReturnValue({
            generateContent: vi.fn().mockResolvedValue({
              response: {
                text: () => '[{"box": [100, 100, 800, 800], "label": "bus mockup"}]',
              },
            }),
          }),
        }) as any,
    );
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[makeItem('Reference Image section heading here', 50, 100)]]) as any,
    );
    const result = await extractPDFContent(makeFile());
    // Box area = (800-100)*(800-100) / (1000*1000) = 0.49 > 0.04 → valid crop
    const pagesWithCropped = result.pageImages.filter(
      (p: any) => p.croppedImages && (p.croppedImages as string[]).length > 0,
    );
    expect(pagesWithCropped).toHaveLength(1);
  });

  it('auto-crop failure is non-fatal: extraction still resolves successfully', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    // Return a valid box so cropImageRegions is reached
    vi.mocked(GoogleGenerativeAI).mockImplementation(
      () =>
        ({
          getGenerativeModel: vi.fn().mockReturnValue({
            generateContent: vi.fn().mockResolvedValue({
              response: {
                text: () => '[{"box": [100, 100, 800, 800], "label": "diagram"}]',
              },
            }),
          }),
        }) as any,
    );
    // Make Image constructor throw → cropImageRegions Promise rejects → auto-crop catch triggers
    vi.stubGlobal('Image', vi.fn(() => { throw new Error('Image not supported'); }));
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[makeItem('Reference Image section heading here', 50, 100)]]) as any,
    );
    // Should resolve despite the auto-crop failure
    const result = await extractPDFContent(makeFile());
    expect(result.textContent).toBeTruthy();
    expect(result.pageCount).toBe(1);
  });

  it('returns result with all required top-level fields', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue(
      makePDF([[makeItem('Some content text', 50, 100)]]) as any,
    );
    const result = await extractPDFContent(makeFile());
    expect(result).toHaveProperty('textContent');
    expect(result).toHaveProperty('images');
    expect(result).toHaveProperty('pageCount');
    expect(result).toHaveProperty('pageImages');
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.pageImages)).toBe(true);
    expect(typeof result.pageCount).toBe('number');
    expect(typeof result.textContent).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validatePDFFile
// ─────────────────────────────────────────────────────────────────────────────

describe('validatePDFFile', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns valid:true for a PDF file within the default 10 MB limit', () => {
    const file = new File(['%PDF-1.4'], 'quote.pdf', { type: 'application/pdf' });
    expect(validatePDFFile(file)).toEqual({ valid: true });
  });

  it('returns valid:false for a non-PDF file type', () => {
    const file = new File(['data'], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const result = validatePDFFile(file);
    expect(result.valid).toBe(false);
  });

  it('includes "Only PDF files are allowed" in the error for non-PDF files', () => {
    const file = new File(['data'], 'image.png', { type: 'image/png' });
    const result = validatePDFFile(file);
    expect(result.error).toBe('Only PDF files are allowed');
  });

  it('returns valid:false when file size exceeds the default 10 MB limit', () => {
    const tenMBPlusOne = 10 * 1024 * 1024 + 1;
    const bigContent = new Uint8Array(tenMBPlusOne);
    const file = new File([bigContent], 'huge.pdf', { type: 'application/pdf' });
    const result = validatePDFFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10MB');
  });

  it('respects a custom size limit set via VITE_MAX_FILE_SIZE_MB env var', () => {
    vi.stubEnv('VITE_MAX_FILE_SIZE_MB', '5');
    const fiveMBPlusOne = 5 * 1024 * 1024 + 1;
    const bigContent = new Uint8Array(fiveMBPlusOne);
    const file = new File([bigContent], 'medium.pdf', { type: 'application/pdf' });
    const result = validatePDFFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('5MB');
  });
});
import { validatePDFFile } from '../../src/utils/pdfUtils';

describe('pdfUtils – validatePDFFile', () => {
  it('returns valid:true for a PDF file within size limit', () => {
    const file = new File(['%PDF-1.4 content'], 'proposal.pdf', { type: 'application/pdf' });
    const result = validatePDFFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns valid:false with error for a non-PDF file', () => {
    const file = new File(['hello world'], 'document.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const result = validatePDFFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Only PDF files are allowed');
  });

  it('returns valid:false with error when PDF exceeds 10 MB default limit', () => {
    const overSizeBytes = 11 * 1024 * 1024; // 11 MB
    const largeContent = new Uint8Array(overSizeBytes);
    const file = new File([largeContent], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: overSizeBytes });
    const result = validatePDFFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/File size must be less than/);
  });

  it('returns valid:true for a PDF exactly at the size limit (not over)', () => {
    const maxSizeMB = 10;
    const exactBytes = maxSizeMB * 1024 * 1024; // exactly 10 MB
    const file = new File(['%PDF'], 'exact.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: exactBytes });
    const result = validatePDFFile(file);
    expect(result.valid).toBe(true);
  });
});
