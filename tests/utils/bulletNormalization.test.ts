import { describe, it, expect } from 'vitest';
import {
  stripBulletPrefix,
  stripListPrefix,
  isBulletedLine,
  normalizeTermsBlob,
} from '../../src/utils/bulletNormalization';

describe('bulletNormalization', () => {
  // ─────────────────────────────────────────────
  // stripBulletPrefix
  // ─────────────────────────────────────────────
  describe('stripBulletPrefix', () => {
    it('strips bullet glyph • and trailing space', () => {
      expect(stripBulletPrefix('• Item one')).toBe('Item one');
    });

    it('strips hyphen bullet -', () => {
      expect(stripBulletPrefix('- Item two')).toBe('Item two');
    });

    it('strips asterisk bullet *', () => {
      expect(stripBulletPrefix('* Item three')).toBe('Item three');
    });

    it('does NOT strip numbered prefixes (not in scope)', () => {
      expect(stripBulletPrefix('1. Numbered item')).toBe('1. Numbered item');
    });

    it('returns unchanged string when no bullet prefix', () => {
      expect(stripBulletPrefix('Normal text')).toBe('Normal text');
    });

    it('returns empty string for empty input', () => {
      expect(stripBulletPrefix('')).toBe('');
    });

    it('handles multiple spaces after bullet', () => {
      expect(stripBulletPrefix('•  Extra space')).toBe('Extra space');
    });
  });

  // ─────────────────────────────────────────────
  // stripListPrefix
  // ─────────────────────────────────────────────
  describe('stripListPrefix', () => {
    it('strips numbered prefix "1. "', () => {
      expect(stripListPrefix('1. First item')).toBe('First item');
    });

    it('strips numbered prefix "2. "', () => {
      expect(stripListPrefix('2. Second item')).toBe('Second item');
    });

    it('strips bullet glyph •', () => {
      expect(stripListPrefix('• Bullet item')).toBe('Bullet item');
    });

    it('strips hyphen -', () => {
      expect(stripListPrefix('- Hyphen item')).toBe('Hyphen item');
    });

    it('strips asterisk *', () => {
      expect(stripListPrefix('* Asterisk item')).toBe('Asterisk item');
    });

    it('returns unchanged for plain text', () => {
      expect(stripListPrefix('Just a sentence')).toBe('Just a sentence');
    });
  });

  // ─────────────────────────────────────────────
  // isBulletedLine
  // ─────────────────────────────────────────────
  describe('isBulletedLine', () => {
    it('returns true for • bullet', () => {
      expect(isBulletedLine('• Item')).toBe(true);
    });

    it('returns true for - hyphen', () => {
      expect(isBulletedLine('- Item')).toBe(true);
    });

    it('returns true for * asterisk', () => {
      expect(isBulletedLine('* Item')).toBe(true);
    });

    it('returns true for numbered line "1."', () => {
      expect(isBulletedLine('1. Item')).toBe(true);
    });

    it('returns true for numbered line "12."', () => {
      expect(isBulletedLine('12. Item')).toBe(true);
    });

    it('returns false for plain text', () => {
      expect(isBulletedLine('Normal sentence')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isBulletedLine('')).toBe(false);
    });

    it('returns false when bullet is mid-string', () => {
      expect(isBulletedLine('Text • with bullet inside')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // normalizeTermsBlob
  // ─────────────────────────────────────────────
  describe('normalizeTermsBlob', () => {
    it('splits multi-line blob and strips bullet prefixes', () => {
      const blob = '• Term one\n• Term two\n• Term three';
      expect(normalizeTermsBlob(blob)).toEqual(['Term one', 'Term two', 'Term three']);
    });

    it('filters out empty lines', () => {
      const blob = '• Term one\n\n• Term two\n   \n• Term three';
      expect(normalizeTermsBlob(blob)).toEqual(['Term one', 'Term two', 'Term three']);
    });

    it('returns empty array for null', () => {
      expect(normalizeTermsBlob(null)).toEqual([]);
    });

    it('returns empty array for undefined', () => {
      expect(normalizeTermsBlob(undefined)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(normalizeTermsBlob('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(normalizeTermsBlob('   \n   ')).toEqual([]);
    });

    it('handles mix of bullets and plain lines', () => {
      const blob = '• Bulleted term\nPlain term\n- Hyphen term';
      const result = normalizeTermsBlob(blob);
      expect(result).toContain('Bulleted term');
      expect(result).toContain('Plain term');
      expect(result).toContain('Hyphen term');
      expect(result).toHaveLength(3);
    });

    it('trims whitespace from each line', () => {
      const blob = '  • Term with padding  \n  • Another term  ';
      expect(normalizeTermsBlob(blob)).toEqual(['Term with padding', 'Another term']);
    });
  });
});
