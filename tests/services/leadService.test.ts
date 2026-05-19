import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchLeads, getLeadById, getAllLeads } from '../../src/services/leadService';

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '../../src/services/supabaseClient';
import { sampleLead, sampleLeadSearchResults } from '../fixtures/leads';

function makeChain(data: any, error: any = null) {
  return {
    select: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // searchLeads chain: .select().or().limit(n).order() — order is terminal
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

describe('leadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // searchLeads
  // ─────────────────────────────────────────────
  describe('searchLeads', () => {
    it('returns matching leads for valid search term', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain(sampleLeadSearchResults) as any);

      const results = await searchLeads('Acme');
      expect(results).toEqual(sampleLeadSearchResults);
    });

    it('returns empty array when search term is less than 2 chars', async () => {
      const results = await searchLeads('A');
      expect(results).toEqual([]);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns empty array on Supabase error', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        makeChain(null, { message: 'DB connection failed' }) as any
      );
      const results = await searchLeads('Acme Corp');
      expect(results).toEqual([]);
    });

    it('returns empty array when no leads match', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain([]) as any);
      const results = await searchLeads('NoMatchXYZ');
      expect(results).toEqual([]);
    });

    it('returns empty array on unexpected exception', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('Network failure');
      });
      const results = await searchLeads('Acme');
      expect(results).toEqual([]);
    });

    it('uses the default limit of 15', async () => {
      const chainMock = makeChain([]) as any;
      // searchLeads chain: .select().or().limit(15).order() — limit called before order
      chainMock.limit = vi.fn().mockReturnThis();
      chainMock.order = vi.fn().mockResolvedValue({ data: [], error: null });
      vi.mocked(supabase.from).mockReturnValue(chainMock);

      await searchLeads('test query');
      expect(chainMock.limit).toHaveBeenCalledWith(15);
    });

    it('accepts custom limit parameter', async () => {
      const chainMock = makeChain([]) as any;
      chainMock.limit = vi.fn().mockReturnThis();
      chainMock.order = vi.fn().mockResolvedValue({ data: [], error: null });
      vi.mocked(supabase.from).mockReturnValue(chainMock);

      await searchLeads('test query', 5);
      expect(chainMock.limit).toHaveBeenCalledWith(5);
    });
  });

  // ─────────────────────────────────────────────
  // getLeadById
  // ─────────────────────────────────────────────
  describe('getLeadById', () => {
    it('returns a lead when found', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain(sampleLead) as any);

      const lead = await getLeadById('lead-001');
      expect(lead).toEqual(sampleLead);
    });

    it('returns null when lead is not found (error)', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        makeChain(null, { message: 'Row not found' }) as any
      );
      const lead = await getLeadById('nonexistent-id');
      expect(lead).toBeNull();
    });

    it('returns null on exception', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('DB Error');
      });
      const lead = await getLeadById('lead-001');
      expect(lead).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // getAllLeads
  // ─────────────────────────────────────────────
  describe('getAllLeads', () => {
    it('returns all leads up to default limit', async () => {
      // getAllLeads chain: .select().limit(100).order() — order is terminal
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [sampleLead], error: null }),
      };
      vi.mocked(supabase.from).mockReturnValue(chainMock as any);

      const leads = await getAllLeads();
      expect(leads).toEqual([sampleLead]);
      expect(chainMock.limit).toHaveBeenCalledWith(100);
    });

    it('accepts a custom limit', async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      vi.mocked(supabase.from).mockReturnValue(chainMock as any);

      await getAllLeads(50);
      expect(chainMock.limit).toHaveBeenCalledWith(50);
    });

    it('returns empty array on Supabase error', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        makeChain(null, { message: 'Query failed' }) as any
      );
      expect(await getAllLeads()).toEqual([]);
    });

    it('returns empty array on exception', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('Network issue');
      });
      expect(await getAllLeads()).toEqual([]);
    });
  });
});
