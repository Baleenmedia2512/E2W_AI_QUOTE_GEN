import { describe, expect, it } from 'vitest';
import {
  collectServiceRemarks,
  hasMeaningfulMaterial,
  hasMeaningfulScalar,
  pickDisplayDimensionFields,
  pickMaterialFromMeta,
} from './specMaterial';

describe('hasMeaningfulMaterial', () => {
  it('rejects missing, empty, and NA', () => {
    expect(hasMeaningfulMaterial(undefined)).toBe(false);
    expect(hasMeaningfulMaterial(null)).toBe(false);
    expect(hasMeaningfulMaterial('')).toBe(false);
    expect(hasMeaningfulMaterial('  ')).toBe(false);
    expect(hasMeaningfulMaterial('NA')).toBe(false);
    expect(hasMeaningfulMaterial('na')).toBe(false);
    expect(hasMeaningfulMaterial({})).toBe(false);
  });

  it('accepts non-empty string and object values', () => {
    expect(hasMeaningfulMaterial('Sun Pack')).toBe(true);
    expect(hasMeaningfulMaterial({ '3 sides': 'Rexine' })).toBe(true);
  });
});

describe('pickMaterialFromMeta', () => {
  it('reads material or materials and skips empty', () => {
    expect(pickMaterialFromMeta({ material: 'Vinyl' })).toBe('Vinyl');
    expect(pickMaterialFromMeta({ materials: 'Flex' })).toBe('Flex');
    expect(pickMaterialFromMeta({ material: 'NA' })).toBeUndefined();
    expect(pickMaterialFromMeta({ material: '' })).toBeUndefined();
    expect(pickMaterialFromMeta({})).toBeUndefined();
  });
});

describe('pickDisplayDimensionFields', () => {
  it('omits NA / missing dimensions', () => {
    expect(
      pickDisplayDimensionFields({
        display_width: 'NA',
        display_height: 'NA',
        display_length: 'NA',
      }),
    ).toEqual([]);
    expect(pickDisplayDimensionFields({})).toEqual([]);
  });

  it('returns Width / Height / Length when present', () => {
    expect(
      pickDisplayDimensionFields({
        display_width: '18',
        display_height: 20,
        display_length: '44 ft',
      }),
    ).toEqual([
      { label: 'Width', value: '18' },
      { label: 'Height', value: '20' },
      { label: 'Length', value: '44 ft' },
    ]);
  });

  it('falls back to width / height / length keys', () => {
    expect(pickDisplayDimensionFields({ width: '10', height: 'NA', length: '30' })).toEqual([
      { label: 'Width', value: '10' },
      { label: 'Length', value: '30' },
    ]);
  });
});

describe('hasMeaningfulScalar', () => {
  it('accepts finite numbers', () => {
    expect(hasMeaningfulScalar(18)).toBe(true);
    expect(hasMeaningfulScalar(NaN)).toBe(false);
  });
});

describe('collectServiceRemarks', () => {
  it('collects unique remarks from items and line items', () => {
    expect(
      collectServiceRemarks([
        { remark: 'A', lineItems: [{ remark: 'A' }, { remark: 'B' }] },
        { remark: 'C' },
      ]),
    ).toBe('A; B; C');
    expect(collectServiceRemarks([])).toBe('');
  });
});
