import { describe, it, expect, beforeEach, vi } from 'vitest';
import { companyService } from '../../src/services/companyService';

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
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

  // ─────────────────────────────────────────────
  // subscribeToChanges
  // ─────────────────────────────────────────────
  describe('subscribeToChanges', () => {
    function makeChannelChain(
      onImpl?: (_event: string, _filter: any, handler: (payload: any) => void) => any,
    ) {
      const subscribeFn = vi.fn().mockReturnValue({});
      const onFn = vi.fn().mockImplementation(
        onImpl ?? ((_e, _f, _h) => ({ subscribe: subscribeFn })),
      );
      // ensure on() always returns something with subscribe
      if (!onImpl) {
        onFn.mockReturnValue({ subscribe: subscribeFn });
      }
      vi.mocked(supabase.channel).mockReturnValue({ on: onFn } as any);
      return { subscribeFn, onFn };
    }

    it('calls channel, on, and subscribe on supabase', () => {
      const { subscribeFn, onFn } = makeChannelChain();
      const callback = vi.fn();

      companyService.subscribeToChanges(callback);

      expect(supabase.channel).toHaveBeenCalledWith('company_settings_changes');
      expect(onFn).toHaveBeenCalledWith(
        'postgres_changes',
        expect.any(Object),
        expect.any(Function),
      );
      expect(subscribeFn).toHaveBeenCalled();
    });

    it('calls the callback with mapped CompanyInfo when payload has is_active=true', () => {
      let capturedHandler: ((payload: any) => void) | null = null;
      const subscribeFn = vi.fn().mockReturnValue({});
      const onFn = vi.fn().mockImplementation(
        (_e: string, _f: any, handler: (p: any) => void) => {
          capturedHandler = handler;
          return { subscribe: subscribeFn };
        },
      );
      vi.mocked(supabase.channel).mockReturnValue({ on: onFn } as any);

      const callback = vi.fn();
      companyService.subscribeToChanges(callback);

      capturedHandler!({
        new: {
          name: 'Updated Co',
          address: '456 New St',
          gst: 'GST123',
          abn: '',
          phone: '+61400000000',
          email: 'updated@example.com',
          logo: '',
          website: 'www.updatedco.com',
          signature: 'John',
          designation: 'Manager',
          is_active: true,
        },
      });

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated Co',
          email: 'updated@example.com',
          gst: 'GST123',
        }),
      );
    });

    it('does NOT call the callback when payload has is_active=false', () => {
      let capturedHandler: ((payload: any) => void) | null = null;
      const subscribeFn = vi.fn().mockReturnValue({});
      const onFn = vi.fn().mockImplementation(
        (_e: string, _f: any, handler: (p: any) => void) => {
          capturedHandler = handler;
          return { subscribe: subscribeFn };
        },
      );
      vi.mocked(supabase.channel).mockReturnValue({ on: onFn } as any);

      const callback = vi.fn();
      companyService.subscribeToChanges(callback);

      capturedHandler!({ new: { name: 'Inactive Co', is_active: false } });

      expect(callback).not.toHaveBeenCalled();
    });

    it('returns the subscription object from subscribe()', () => {
      const fakeSubscription = { unsubscribe: vi.fn() };
      const subscribeFn = vi.fn().mockReturnValue(fakeSubscription);
      const onFn = vi.fn().mockReturnValue({ subscribe: subscribeFn });
      vi.mocked(supabase.channel).mockReturnValue({ on: onFn } as any);

      const callback = vi.fn();
      const result = companyService.subscribeToChanges(callback);

      expect(result).toBe(fakeSubscription);
    });
  });
});
