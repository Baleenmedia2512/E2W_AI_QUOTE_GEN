import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateImageFile,
  validateExcelFile,
  detectFileType,
} from '../../src/utils/fileUtils';

// Helper to create a mock File object
function mockFile(
  name: string,
  type: string,
  sizeBytes: number = 1024
): File {
  const blob = new Blob(['x'.repeat(sizeBytes)], { type });
  return new File([blob], name, { type });
}

describe('fileUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // validateImageFile
  // ─────────────────────────────────────────────
  describe('validateImageFile', () => {
    it('accepts valid JPEG file', () => {
      const file = mockFile('photo.jpg', 'image/jpeg', 500 * 1024);
      expect(validateImageFile(file)).toEqual({ valid: true });
    });

    it('accepts valid JPG file with image/jpg mime', () => {
      const file = mockFile('photo.jpg', 'image/jpg', 100 * 1024);
      expect(validateImageFile(file)).toEqual({ valid: true });
    });

    it('rejects PNG file — not JPEG', () => {
      const file = mockFile('image.png', 'image/png', 100 * 1024);
      const result = validateImageFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('JPEG');
    });

    it('rejects PDF file', () => {
      const file = mockFile('doc.pdf', 'application/pdf', 100 * 1024);
      const result = validateImageFile(file);
      expect(result.valid).toBe(false);
    });

    it('rejects file over 10MB default limit', () => {
      const file = mockFile('huge.jpg', 'image/jpeg', 11 * 1024 * 1024);
      const result = validateImageFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.toLowerCase()).toContain('size');
    });

    it('accepts file exactly at 10MB limit', () => {
      const file = mockFile('exact.jpg', 'image/jpeg', 10 * 1024 * 1024);
      expect(validateImageFile(file).valid).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // validateExcelFile
  // ─────────────────────────────────────────────
  describe('validateExcelFile', () => {
    it('accepts xlsx by MIME type', () => {
      const file = mockFile(
        'data.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        50 * 1024
      );
      expect(validateExcelFile(file)).toEqual({ valid: true });
    });

    it('accepts xls by MIME type', () => {
      const file = mockFile('data.xls', 'application/vnd.ms-excel', 50 * 1024);
      expect(validateExcelFile(file)).toEqual({ valid: true });
    });

    it('accepts .xlsx by file extension even if MIME is generic', () => {
      const file = mockFile('rate_card.xlsx', 'application/octet-stream', 50 * 1024);
      expect(validateExcelFile(file).valid).toBe(true);
    });

    it('accepts .xls by file extension', () => {
      const file = mockFile('rate_card.xls', 'application/octet-stream', 50 * 1024);
      expect(validateExcelFile(file).valid).toBe(true);
    });

    it('rejects plain text file', () => {
      const file = mockFile('notes.txt', 'text/plain', 1024);
      const result = validateExcelFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects file over 10MB limit', () => {
      const file = mockFile(
        'big.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        11 * 1024 * 1024
      );
      const result = validateExcelFile(file);
      expect(result.valid).toBe(false);
      expect(result.error?.toLowerCase()).toContain('size');
    });
  });

  // ─────────────────────────────────────────────
  // detectFileType
  // ─────────────────────────────────────────────
  describe('detectFileType', () => {
    it('detects PDF by MIME type', () => {
      const file = mockFile('proposal.pdf', 'application/pdf');
      expect(detectFileType(file)).toBe('pdf');
    });

    it('detects PDF by .pdf extension', () => {
      const file = mockFile('proposal.pdf', 'application/octet-stream');
      expect(detectFileType(file)).toBe('pdf');
    });

    it('detects image/jpeg as image', () => {
      const file = mockFile('photo.jpg', 'image/jpeg');
      expect(detectFileType(file)).toBe('image');
    });

    it('detects image/jpg as image', () => {
      const file = mockFile('photo.jpg', 'image/jpg');
      expect(detectFileType(file)).toBe('image');
    });

    it('detects .jpg extension as image', () => {
      const file = mockFile('photo.jpg', '');
      expect(detectFileType(file)).toBe('image');
    });

    it('detects xlsx by MIME type as excel', () => {
      const file = mockFile(
        'data.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(detectFileType(file)).toBe('excel');
    });

    it('detects .xlsx extension as excel', () => {
      const file = mockFile('data.xlsx', '');
      expect(detectFileType(file)).toBe('excel');
    });

    it('detects .xls extension as excel', () => {
      const file = mockFile('data.xls', '');
      expect(detectFileType(file)).toBe('excel');
    });

    it('returns unknown for unsupported type', () => {
      const file = mockFile('doc.docx', 'application/msword');
      expect(detectFileType(file)).toBe('unknown');
    });

    it('returns unknown for text file', () => {
      const file = mockFile('notes.txt', 'text/plain');
      expect(detectFileType(file)).toBe('unknown');
    });
  });
});
