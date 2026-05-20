import { describe, it, expect } from 'vitest';
import { DEFAULT_COMPANY_INFO } from '../../src/constants/defaultCompany';

describe('DEFAULT_COMPANY_INFO', () => {
  it('exports a non-null object', () => {
    expect(DEFAULT_COMPANY_INFO).toBeDefined();
    expect(typeof DEFAULT_COMPANY_INFO).toBe('object');
    expect(DEFAULT_COMPANY_INFO).not.toBeNull();
  });

  it('has all required CompanyInfo fields', () => {
    const requiredKeys = ['name', 'address', 'gst', 'phone', 'email', 'logo'];
    for (const key of requiredKeys) {
      expect(DEFAULT_COMPANY_INFO).toHaveProperty(key);
    }
  });

  it('has non-empty string values for name, phone, email, and website', () => {
    expect(DEFAULT_COMPANY_INFO.name.length).toBeGreaterThan(0);
    expect(DEFAULT_COMPANY_INFO.phone.length).toBeGreaterThan(0);
    expect(DEFAULT_COMPANY_INFO.email.length).toBeGreaterThan(0);
    expect(DEFAULT_COMPANY_INFO.website!.length).toBeGreaterThan(0);
  });

  it('has empty strings for logo and gst (no defaults for sensitive/optional data)', () => {
    expect(DEFAULT_COMPANY_INFO.logo).toBe('');
    expect(DEFAULT_COMPANY_INFO.gst).toBe('');
  });
});
