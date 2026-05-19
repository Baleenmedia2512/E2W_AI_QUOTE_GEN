import { describe, it, expect, beforeEach, vi } from 'vitest';
import { companyService } from '../../src/services/companyService';

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '../../src/services/supabaseClient';
import { sampleCompany } from '../fixtures/companies';

const dbRecord = {
  id: 'company-001',
  name: sampleCompany.name,
  address: sampleCompany.address,
  gst: sampleCompany.gst,
  abn: sampleCompany.abn,
  phone: sampleCompany.phone,
  email: sampleCompany.email,
  logo: sampleCompany.logo,
  website: sampleCompany.website,
  signature: sampleCompany.signature,
  designation: sampleCompany.designation,
  is_active: true,
};

function makeChain(data: any, error: any = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

describe('companyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // ─────────────────────────────────────────────
  // getCompanySettings
  // ─────────────────────────────────────────────
  describe('getCompanySettings', () => {
    it('returns mapped CompanyInfo on success', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain(dbRecord) as any);

      const result = await companyService.getCompanySettings();

      expect(result).not.toBeNull();
      expect(result?.name).toBe(sampleCompany.name);
      expect(result?.email).toBe(sampleCompany.email);
      expect(result?.gst).toBe(sampleCompany.gst);
    });

    it('returns null when Supabase returns an error', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        makeChain(null, { message: 'Connection failed' }) as any
      );

      const result = await companyService.getCompanySettings();
      expect(result).toBeNull();
    });

    it('returns null when no company record exists', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain(null) as any);

      const result = await companyService.getCompanySettings();
      expect(result).toBeNull();
    });

    it('returns null on unexpected exception', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await companyService.getCompanySettings();
      expect(result).toBeNull();
    });

    it('maps empty string fields to empty strings (not null)', async () => {
      const partialRecord = { ...dbRecord, phone: '', website: '', abn: '' };
      vi.mocked(supabase.from).mockReturnValue(makeChain(partialRecord) as any);

      const result = await companyService.getCompanySettings();
      expect(result?.phone).toBe('');
      expect(result?.website).toBe('');
    });
  });

  // ─────────────────────────────────────────────
  // saveCompanySettings
  // ─────────────────────────────────────────────
  describe('saveCompanySettings', () => {
    it('returns true on successful update of existing record', async () => {
      // First call (select existing) returns record, second (update) succeeds
      const selectChain = makeChain({ id: 'company-001' }) as any;
      const updateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      vi.mocked(supabase.from)
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(updateChain as any);

      const result = await companyService.saveCompanySettings(sampleCompany);
      expect(result).toBe(true);
    });

    it('returns false when update fails', async () => {
      const selectChain = makeChain({ id: 'company-001' }) as any;
      const updateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
      };
      vi.mocked(supabase.from)
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(updateChain as any);

      const result = await companyService.saveCompanySettings(sampleCompany);
      expect(result).toBe(false);
    });

    it('returns false on exception', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await companyService.saveCompanySettings(sampleCompany);
      expect(result).toBe(false);
    });
  });
});
