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
  findCloudDuplicate,
  downloadProposalFile,
  checkCloudStorageAvailability,
  cloudProposalToStored,
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

  // ─────────────────────────────────────────────
  // findCloudDuplicate
  // ─────────────────────────────────────────────
  describe('findCloudDuplicate', () => {
    function makeDuplicateChain(data: any, error: any = null) {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error }),
      };
    }

    it('returns the CloudProposal when a duplicate exists', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeDuplicateChain(mockCloudProposal) as any);

      const result = await findCloudDuplicate('test-proposal.pdf', 102400);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('proposal-001');
      expect(result?.file_name).toBe('test-proposal.pdf');
    });

    it('returns null when no duplicate found (data is null)', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeDuplicateChain(null) as any);

      const result = await findCloudDuplicate('unique-file.pdf', 5000);
      expect(result).toBeNull();
    });

    it('returns null on database error', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        makeDuplicateChain(null, { message: 'DB error' }) as any,
      );

      const result = await findCloudDuplicate('any.pdf', 1024);
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // downloadProposalFile
  // ─────────────────────────────────────────────
  describe('downloadProposalFile', () => {
    it('returns a Blob on successful download', async () => {
      const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });
      const storageChain = {
        download: vi.fn().mockResolvedValue({ data: mockBlob, error: null }),
      };
      vi.mocked(supabase.storage.from).mockReturnValue(storageChain as any);

      const result = await downloadProposalFile('user-001/12345_test.pdf');
      expect(result).not.toBeNull();
      expect(result).toBe(mockBlob);
    });

    it('returns null on storage error', async () => {
      const storageChain = {
        download: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      };
      vi.mocked(supabase.storage.from).mockReturnValue(storageChain as any);

      const result = await downloadProposalFile('missing/path.pdf');
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // checkCloudStorageAvailability
  // ─────────────────────────────────────────────
  describe('checkCloudStorageAvailability', () => {
    it('returns true when cloud storage is accessible', async () => {
      const storageChain = {
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      vi.mocked(supabase.storage.from).mockReturnValue(storageChain as any);

      const result = await checkCloudStorageAvailability();
      expect(result).toBe(true);
    });

    it('returns false when cloud storage returns an error', async () => {
      const storageChain = {
        list: vi.fn().mockResolvedValue({ data: null, error: { message: 'Bucket not found' } }),
      };
      vi.mocked(supabase.storage.from).mockReturnValue(storageChain as any);

      const result = await checkCloudStorageAvailability();
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // cloudProposalToStored (pure function)
  // ─────────────────────────────────────────────
  describe('cloudProposalToStored', () => {
    it('maps all CloudProposal fields to StoredProposal correctly', () => {
      const stored = cloudProposalToStored(mockCloudProposal);

      expect(stored.id).toBe(mockCloudProposal.id);
      expect(stored.fileName).toBe(mockCloudProposal.file_name);
      expect(stored.fileType).toBe(mockCloudProposal.file_type);
      expect(stored.fileSize).toBe(mockCloudProposal.file_size);
      expect(stored.textContent).toBe(mockCloudProposal.text_content);
      expect(stored.pageCount).toBe(mockCloudProposal.page_count);
      expect(stored.fileUrl).toBe(mockCloudProposal.file_url);
      expect(stored.storagePath).toBe(mockCloudProposal.storage_path);
      expect(stored.uploadedByUserId).toBe(mockCloudProposal.uploaded_by_user_id);
      expect(stored.uploadedByName).toBe(mockCloudProposal.uploaded_by_name);
    });

    it('sets isCloudStored to true', () => {
      const stored = cloudProposalToStored(mockCloudProposal);
      expect(stored.isCloudStored).toBe(true);
    });

    it('sets fileBlob to null (downloaded on-demand)', () => {
      const stored = cloudProposalToStored(mockCloudProposal);
      expect(stored.fileBlob).toBeNull();
    });

    it('initialises extractedImages and pageImages as empty arrays', () => {
      const stored = cloudProposalToStored(mockCloudProposal);
      expect(stored.extractedImages).toEqual([]);
      expect(stored.pageImages).toEqual([]);
    });

    it('parses uploadedAt as a Date from the ISO string', () => {
      const stored = cloudProposalToStored(mockCloudProposal);
      expect(stored.uploadedAt).toBeInstanceOf(Date);
      expect(stored.uploadedAt.toISOString()).toBe(new Date(mockCloudProposal.uploaded_at).toISOString());
    });
  });
});
