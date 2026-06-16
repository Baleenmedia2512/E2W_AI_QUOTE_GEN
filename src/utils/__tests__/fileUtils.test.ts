import { describe, it, expect, vi, beforeEach } from 'vitest';

import { validateImageFile, validateExcelFile } from '../fileUtils';

function makeFile(name: string, type: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

describe('validateImageFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a valid small JPEG', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    expect(validateImageFile(file)).toEqual({ valid: true });
  });

  it('accepts image/jpg mime type', () => {
    const file = makeFile('photo.jpg', 'image/jpg', 1024);
    expect(validateImageFile(file)).toEqual({ valid: true });
  });

  it('rejects PNG files', () => {
    const file = makeFile('image.png', 'image/png', 1024);
    const result = validateImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/JPEG/i);
  });

  it('rejects PDF files', () => {
    const file = makeFile('doc.pdf', 'application/pdf', 1024);
    expect(validateImageFile(file).valid).toBe(false);
  });

  it('rejects files exceeding default 10MB limit', () => {
    const tooBig = 11 * 1024 * 1024;
    const file = makeFile('big.jpg', 'image/jpeg', tooBig);
    const result = validateImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/file size/i);
  });

  it('accepts files exactly at the size limit', () => {
    const limit = 10 * 1024 * 1024;
    const file = makeFile('limit.jpg', 'image/jpeg', limit);
    expect(validateImageFile(file).valid).toBe(true);
  });
});

describe('validateExcelFile', () => {
  it('accepts .xlsx by mime type', () => {
    const file = makeFile(
      'data.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      1024,
    );
    expect(validateExcelFile(file).valid).toBe(true);
  });

  it('accepts .xls by mime type', () => {
    const file = makeFile('data.xls', 'application/vnd.ms-excel', 1024);
    expect(validateExcelFile(file).valid).toBe(true);
  });

  it('accepts .xlsx by extension fallback when mime is generic', () => {
    const file = makeFile('data.xlsx', 'application/octet-stream', 1024);
    expect(validateExcelFile(file).valid).toBe(true);
  });

  it('accepts .xls by extension fallback', () => {
    const file = makeFile('data.xls', '', 1024);
    expect(validateExcelFile(file).valid).toBe(true);
  });

  it('rejects unrelated file types', () => {
    const file = makeFile('doc.pdf', 'application/pdf', 1024);
    const result = validateExcelFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/excel/i);
  });

  it('rejects oversized excel files', () => {
    const tooBig = 11 * 1024 * 1024;
    const file = makeFile('big.xlsx', 'application/vnd.ms-excel', tooBig);
    const result = validateExcelFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/file size/i);
  });
});
