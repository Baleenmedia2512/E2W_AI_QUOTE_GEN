import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-001', email: 'test@test.com' } } }),
    },
    storage: {
      from: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { supabase } from '../../src/services/supabaseClient';
import {
  uploadProposalToCloud,
  loadAllProposalsFromCloud,
  loadProposalFromCloud,
  deleteProposalFromCloud,
} from '../../src/services/supabaseProposalService';

const mockCloudProposal = {
  id: 'proposal-001',
  file_name: 'test-proposal.pdf',
  file_type: 'application/pdf',
  file_size: 102400,
  file_url: 'https://example.com/proposals/test.pdf',
  storage_path: 'user-001/123456_test-proposal.pdf',
  text_content: 'Sample proposal text content...',
  page_count: 3,
  uploaded_by_user_id: 'user-001',
  uploaded_by_name: 'Test User',
  uploaded_at: '2026-05-18T10:00:00Z',
};

function makeStorageChain(uploadError: any = null) {
  return {
    upload: vi.fn().mockResolvedValue({ error: uploadError }),
    getPublicUrl: vi.fn().mockReturnValue({
      data: { publicUrl: 'https://example.com/proposals/test.pdf' },
    }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  };
}

function makeDbChain(data: any, error: any = null) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    delete: vi.fn().mockReturnThis(),
    then: undefined,
  };
}

describe('supabaseProposalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // uploadProposalToCloud
  // ─────────────────────────────────────────────
  describe('uploadProposalToCloud', () => {
    it('returns success with proposal on valid upload', async () => {
      const storageChain = makeStorageChain();
      vi.mocked(supabase.storage.from).mockReturnValue(storageChain as any);

      const dbChain = makeDbChain(mockCloudProposal);
      vi.mocked(supabase.from).mockReturnValue(dbChain as any);

      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });
      const result = await uploadProposalToCloud(file, 'Sample text', 3);

      expect(result.success).toBe(true);
    });

    it('returns failure when storage upload errors', async () => {
      const storageChain = makeStorageChain({ message: 'Upload failed' });
      vi.mocked(supabase.storage.from).mockReturnValue(storageChain as any);

      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });
      const result = await uploadProposalToCloud(file, 'text', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('sanitizes file name with special characters', async () => {
      const storageChain = makeStorageChain();
      vi.mocked(supabase.storage.from).mockReturnValue(storageChain as any);
      vi.mocked(supabase.from).mockReturnValue(makeDbChain(mockCloudProposal) as any);

      const file = new File(['content'], 'my proposal (v2).pdf', { type: 'application/pdf' });
      await uploadProposalToCloud(file, 'text', 1);

      // Verify upload was called with sanitized path (no spaces or parens)
      const uploadCall = storageChain.upload.mock.calls[0];
      if (uploadCall) {
        const storagePath: string = uploadCall[0];
        expect(storagePath).not.toMatch(/[ ()]/);
      }
    });
  });

  // ─────────────────────────────────────────────
  // loadAllProposalsFromCloud
  // ─────────────────────────────────────────────
  describe('loadAllProposalsFromCloud', () => {
    // Actual chain: .select('*').order(...).limit(n) — limit is terminal
    it('returns array of proposals from database', async () => {
      const dbChain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockCloudProposal], error: null }),
      };
      vi.mocked(supabase.from).mockReturnValue(dbChain as any);

      const proposals = await loadAllProposalsFromCloud();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].id).toBe('proposal-001');
    });

    it('returns empty array on database error', async () => {
      const dbChain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      };
      vi.mocked(supabase.from).mockReturnValue(dbChain as any);

      const proposals = await loadAllProposalsFromCloud();
      expect(proposals).toEqual([]);
    });

    it('returns empty array when no proposals exist', async () => {
      const dbChain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      vi.mocked(supabase.from).mockReturnValue(dbChain as any);

      expect(await loadAllProposalsFromCloud()).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // loadProposalFromCloud
  // ─────────────────────────────────────────────
  describe('loadProposalFromCloud', () => {
    it('returns proposal when found by id', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeDbChain(mockCloudProposal) as any);

      const proposal = await loadProposalFromCloud('proposal-001');
      expect(proposal).not.toBeNull();
      expect(proposal?.id).toBe('proposal-001');
    });

    it('returns null when proposal not found', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        makeDbChain(null, { message: 'Not found' }) as any
      );

      const proposal = await loadProposalFromCloud('nonexistent');
      expect(proposal).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // deleteProposalFromCloud
  // ─────────────────────────────────────────────
  describe('deleteProposalFromCloud', () => {
    it('returns true on successful deletion', async () => {
      // First load the proposal to get storage_path
      vi.mocked(supabase.from).mockReturnValueOnce(makeDbChain(mockCloudProposal) as any);
      // Then delete from storage
      vi.mocked(supabase.storage.from).mockReturnValue(makeStorageChain() as any);
      // Then delete from DB
      const deleteChain = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      vi.mocked(supabase.from).mockReturnValueOnce(deleteChain as any);

      const result = await deleteProposalFromCloud('proposal-001');
      expect(result).toBe(true);
    });

    it('returns false when proposal not found', async () => {
      vi.mocked(supabase.from).mockReturnValueOnce(
        makeDbChain(null, { message: 'Not found' }) as any
      );

      const result = await deleteProposalFromCloud('nonexistent');
      expect(result).toBe(false);
    });
  });
});
