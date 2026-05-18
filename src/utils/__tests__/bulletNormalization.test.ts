import { describe, expect, it } from 'vitest';

import {
  isBulletedLine,
  normalizeTermsBlob,
  stripBulletPrefix,
  stripListPrefix,
} from '../bulletNormalization';

describe('bulletNormalization', () => {
  describe('stripBulletPrefix', () => {
    it.each([
      ['• hello', 'hello'],
      ['- hello', 'hello'],
      ['* hello', 'hello'],
      ['•hello', 'hello'],
      ['plain text', 'plain text'],
      ['', ''],
    ])('strips %j → %j', (input, expected) => {
      expect(stripBulletPrefix(input)).toBe(expected);
    });

    it('only strips ONE leading marker, not nested', () => {
      expect(stripBulletPrefix('• - double')).toBe('- double');
    });

    it('does not strip mid-line bullets', () => {
      expect(stripBulletPrefix('hello • world')).toBe('hello • world');
    });
  });

  describe('stripListPrefix', () => {
    it.each([
      ['1. First item', 'First item'],
      ['  2.   Second', 'Second'],
      ['• bullet', 'bullet'],
      ['- dash', 'dash'],
      ['10. Ten', 'Ten'],
      ['plain', 'plain'],
    ])('strips %j → %j', (input, expected) => {
      expect(stripListPrefix(input)).toBe(expected);
    });
  });

  describe('isBulletedLine', () => {
    it.each([
      ['• bullet', true],
      ['- dash', true],
      ['* star', true],
      ['1. numbered', true],
      ['10. ten', true],
      ['plain text', false],
      ['', false],
      [' • leading space', false], // strict: must START with marker
    ])('isBulletedLine(%j) === %s', (input, expected) => {
      expect(isBulletedLine(input)).toBe(expected);
    });
  });

  describe('normalizeTermsBlob', () => {
    it('returns empty array for null/undefined/empty', () => {
      expect(normalizeTermsBlob(null)).toEqual([]);
      expect(normalizeTermsBlob(undefined)).toEqual([]);
      expect(normalizeTermsBlob('')).toEqual([]);
    });

    it('splits, strips, and filters blank lines', () => {
      const blob = '• First\n- Second\n* Third\n\n  \nPlain';
      expect(normalizeTermsBlob(blob)).toEqual(['First', 'Second', 'Third', 'Plain']);
    });

    it('preserves order of terms', () => {
      const blob = '• a\n• b\n• c';
      expect(normalizeTermsBlob(blob)).toEqual(['a', 'b', 'c']);
    });

    it('handles single line without trailing newline', () => {
      expect(normalizeTermsBlob('• only')).toEqual(['only']);
    });
  });
});
