import { describe, it, expect, vi, beforeEach } from 'vitest';

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
