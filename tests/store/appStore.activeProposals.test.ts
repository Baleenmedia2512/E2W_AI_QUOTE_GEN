import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (must be hoisted via vi.mock; declared before importing store) ─────

vi.mock('../../src/services/companyService', () => ({
  companyService: {
    getCompanySettings: vi.fn().mockResolvedValue(null),
    saveCompanySettings: vi.fn().mockResolvedValue(true),
    subscribeToChanges: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  },
}));

vi.mock('../../src/services/supabaseProposalService', () => ({
  checkCloudStorageAvailability: vi.fn().mockResolvedValue(false),
  loadAllProposalsFromCloud: vi.fn().mockResolvedValue([]),
  uploadProposalToCloud: vi.fn().mockResolvedValue({ success: false }),
  deleteProposalFromCloud: vi.fn().mockResolvedValue(false),
  downloadProposalFile: vi.fn().mockResolvedValue(null),
  cloudProposalToStored: vi.fn().mockReturnValue(null),
}));

// Capture calls to imageStorage helpers
const savePageImagesById = vi.fn().mockResolvedValue(undefined);
const loadPageImagesById = vi.fn().mockResolvedValue([]);
const clearPageImagesById = vi.fn().mockResolvedValue(undefined);
const saveActiveProposalIds = vi.fn();
const loadActiveProposalIds = vi.fn().mockReturnValue([]);
const saveActiveProposalMeta = vi.fn();
const loadActiveProposalMeta = vi.fn().mockReturnValue([]);

vi.mock('../../src/utils/imageStorage', () => ({
  savePageImages: vi.fn().mockResolvedValue(undefined),
  clearPageImages: vi.fn().mockResolvedValue(undefined),
  savePageImagesById: (...args: any[]) => savePageImagesById(...args),
  loadPageImagesById: (...args: any[]) => loadPageImagesById(...args),
  clearPageImagesById: (...args: any[]) => clearPageImagesById(...args),
  saveActiveProposalIds: (...args: any[]) => saveActiveProposalIds(...args),
  loadActiveProposalIds: () => loadActiveProposalIds(),
  saveActiveProposalMeta: (...args: any[]) => saveActiveProposalMeta(...args),
  loadActiveProposalMeta: () => loadActiveProposalMeta(),
}));

vi.mock('../../src/utils/pdfUtils', () => ({
  extractPDFContent: vi.fn().mockResolvedValue({
    textContent: 'extracted text',
    pageCount: 2,
    images: [],
    pageImages: [
      { pageNumber: 1, imageData: 'data:image/png;base64,AAA' },
      { pageNumber: 2, imageData: 'data:image/png;base64,BBB' },
    ],
  }),
}));

const loadProposalById = vi.fn();
vi.mock('../../src/utils/proposalStorage', () => ({
  loadRecentProposals: vi.fn().mockResolvedValue([]),
  loadProposalById: (...args: any[]) => loadProposalById(...args),
  deleteProposalFromLibrary: vi.fn().mockResolvedValue(undefined),
  saveProposalToLibrary: vi.fn().mockResolvedValue('saved-id'),
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn(), storage: { from: vi.fn() }, auth: { getUser: vi.fn() } },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub URL.createObjectURL (used by addActiveProposal)
if (typeof URL.createObjectURL === 'undefined') {
  (URL as any).createObjectURL = vi.fn(() => 'blob:mock-url');
} else {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url') as any;
}

// ── Import store AFTER mocks ─────────────────────────────────────────────────
import { useAppStore } from '../../src/store';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function resetStore() {
  localStorage.clear();
  useAppStore.setState({
    activeProposals: [],
    recentProposals: [],
    proposal: {
      file: null,
      fileName: '',
      fileUrl: '',
      textContent: '',
      pageCount: 0,
      currentPage: 1,
      extractedImages: [],
      pageImages: [],
      uploadedAt: null,
    },
  } as any);
}

function makeStoredProposal(id: string, fileName = `${id}.pdf`) {
  return {
    id,
    fileName,
    fileType: 'application/pdf',
    pageCount: 2,
    textContent: 'sample',
    uploadedAt: new Date(),
    fileBlob: new Blob(['pdf-bytes'], { type: 'application/pdf' }),
    // Pre-cached page images on the stored proposal (addActiveProposal only
    // re-extracts when blob was just fetched from cloud, not when loaded locally)
    pageImages: [
      { pageNumber: 1, imageData: 'data:image/png;base64,AAA' },
      { pageNumber: 2, imageData: 'data:image/png;base64,BBB' },
    ],
    extractedImages: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('useAppStore — activeProposals operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    loadActiveProposalIds.mockReturnValue([]);
    loadActiveProposalMeta.mockReturnValue([]);
    loadPageImagesById.mockResolvedValue([]);
  });

  // ── addActiveProposal ──────────────────────────────────────────────────────
  describe('addActiveProposal', () => {
    it('adds a proposal to activeProposals when found in local storage', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('p1'));
      await useAppStore.getState().addActiveProposal('p1');

      const list = useAppStore.getState().activeProposals;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('p1');
      expect(list[0].fileName).toBe('p1.pdf');
    });

    it('stamps sourceId and sourceName on every page image', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('proposal-A', 'Alpha.pdf'));
      await useAppStore.getState().addActiveProposal('proposal-A');

      const proposal = useAppStore.getState().activeProposals[0];
      expect(proposal.pageImages.length).toBeGreaterThan(0);
      for (const page of proposal.pageImages as any[]) {
        expect(page.sourceId).toBe('proposal-A');
        expect(page.sourceName).toBe('Alpha.pdf');
      }
    });

    it('is a no-op when the same id is already active (no duplicate)', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('p1'));
      await useAppStore.getState().addActiveProposal('p1');
      expect(useAppStore.getState().activeProposals).toHaveLength(1);

      // Second add for same id → should not load again, no duplicate
      await useAppStore.getState().addActiveProposal('p1');
      expect(useAppStore.getState().activeProposals).toHaveLength(1);
      expect(loadProposalById).toHaveBeenCalledTimes(1);
    });

    it('persists page images to IndexedDB via savePageImagesById', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('p1'));
      await useAppStore.getState().addActiveProposal('p1');

      expect(savePageImagesById).toHaveBeenCalledWith(
        'p1',
        expect.arrayContaining([expect.objectContaining({ sourceId: 'p1' })]),
      );
    });

    it('persists active id list and metadata to localStorage', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('p1', 'File1.pdf'));
      await useAppStore.getState().addActiveProposal('p1');

      expect(saveActiveProposalIds).toHaveBeenCalledWith(['p1']);
      expect(saveActiveProposalMeta).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'p1', fileName: 'File1.pdf', fileType: 'application/pdf' }),
        ]),
      );
    });

    it('updates single `proposal` state for backward compatibility', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('p1', 'BC.pdf'));
      await useAppStore.getState().addActiveProposal('p1');

      const proposal = useAppStore.getState().proposal;
      expect(proposal.fileName).toBe('BC.pdf');
      expect(proposal.pageCount).toBe(2);
      expect(proposal.pageImages.length).toBeGreaterThan(0);
    });

    it('gracefully no-ops when proposal not found locally and not in cloud', async () => {
      loadProposalById.mockResolvedValueOnce(null);
      // recentProposals is empty in resetStore → no cloud fallback
      await useAppStore.getState().addActiveProposal('missing-id');
      expect(useAppStore.getState().activeProposals).toHaveLength(0);
    });

    it('supports adding multiple distinct proposals (no overwrite)', async () => {
      loadProposalById
        .mockResolvedValueOnce(makeStoredProposal('p1', 'One.pdf'))
        .mockResolvedValueOnce(makeStoredProposal('p2', 'Two.pdf'));

      await useAppStore.getState().addActiveProposal('p1');
      await useAppStore.getState().addActiveProposal('p2');

      const list = useAppStore.getState().activeProposals;
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    });
  });

  // ── removeActiveProposal ───────────────────────────────────────────────────
  describe('removeActiveProposal', () => {
    it('removes the proposal from activeProposals', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('p1'));
      await useAppStore.getState().addActiveProposal('p1');
      expect(useAppStore.getState().activeProposals).toHaveLength(1);

      useAppStore.getState().removeActiveProposal('p1');
      expect(useAppStore.getState().activeProposals).toHaveLength(0);
    });

    it('clears the proposal page images from IndexedDB', async () => {
      loadProposalById.mockResolvedValueOnce(makeStoredProposal('p1'));
      await useAppStore.getState().addActiveProposal('p1');

      useAppStore.getState().removeActiveProposal('p1');
      expect(clearPageImagesById).toHaveBeenCalledWith('p1');
    });

    it('updates persisted localStorage id list after removal', async () => {
      loadProposalById
        .mockResolvedValueOnce(makeStoredProposal('p1'))
        .mockResolvedValueOnce(makeStoredProposal('p2'));
      await useAppStore.getState().addActiveProposal('p1');
      await useAppStore.getState().addActiveProposal('p2');
      saveActiveProposalIds.mockClear();

      useAppStore.getState().removeActiveProposal('p1');
      expect(saveActiveProposalIds).toHaveBeenCalledWith(['p2']);
    });

    it('is a safe no-op when removing a non-existent id', () => {
      expect(() => useAppStore.getState().removeActiveProposal('does-not-exist')).not.toThrow();
      expect(useAppStore.getState().activeProposals).toHaveLength(0);
    });
  });

  // ── restoreActiveProposals ─────────────────────────────────────────────────
  describe('restoreActiveProposals', () => {
    it('no-ops when localStorage has no saved active ids', async () => {
      loadActiveProposalIds.mockReturnValue([]);

      await useAppStore.getState().restoreActiveProposals();
      expect(useAppStore.getState().activeProposals).toHaveLength(0);
      expect(loadPageImagesById).not.toHaveBeenCalled();
    });

    it('restores a proposal when saved id has cached pages and metadata', async () => {
      loadActiveProposalIds.mockReturnValue(['restored-1']);
      loadPageImagesById.mockResolvedValueOnce([
        { pageNumber: 1, imageData: 'data:image/png;base64,X', sourceId: 'restored-1', sourceName: 'R1.pdf' },
      ]);
      loadActiveProposalMeta.mockReturnValue([
        {
          id: 'restored-1',
          fileName: 'R1.pdf',
          fileType: 'application/pdf',
          pageCount: 1,
          textContent: 'restored',
          fileUrl: '',
        },
      ]);

      await useAppStore.getState().restoreActiveProposals();
      const list = useAppStore.getState().activeProposals;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('restored-1');
      expect(list[0].fileName).toBe('R1.pdf');
      expect(list[0].pageImages).toHaveLength(1);
    });

    it('skips restore for an id with no cached pages', async () => {
      loadActiveProposalIds.mockReturnValue(['empty-id']);
      loadPageImagesById.mockResolvedValueOnce([]);
      loadActiveProposalMeta.mockReturnValue([
        { id: 'empty-id', fileName: 'E.pdf', fileType: 'application/pdf', pageCount: 0, textContent: '' },
      ]);

      await useAppStore.getState().restoreActiveProposals();
      expect(useAppStore.getState().activeProposals).toHaveLength(0);
    });

    it('skips restore for an id with no metadata anywhere', async () => {
      loadActiveProposalIds.mockReturnValue(['orphan']);
      loadPageImagesById.mockResolvedValueOnce([
        { pageNumber: 1, imageData: 'x' },
      ]);
      loadActiveProposalMeta.mockReturnValue([]); // no meta saved

      await useAppStore.getState().restoreActiveProposals();
      expect(useAppStore.getState().activeProposals).toHaveLength(0);
    });

    it('does not re-add a proposal already in memory', async () => {
      // Pre-populate with an existing in-memory proposal
      useAppStore.setState({
        activeProposals: [
          {
            id: 'already-here',
            fileName: 'X.pdf',
            fileType: 'application/pdf',
            pageCount: 1,
            textContent: '',
            fileUrl: '',
            pageImages: [],
          } as any,
        ],
      } as any);

      loadActiveProposalIds.mockReturnValue(['already-here']);
      loadPageImagesById.mockResolvedValueOnce([{ pageNumber: 1, imageData: 'x' }]);
      loadActiveProposalMeta.mockReturnValue([
        { id: 'already-here', fileName: 'X.pdf', fileType: 'application/pdf', pageCount: 1, textContent: '' },
      ]);

      await useAppStore.getState().restoreActiveProposals();
      expect(useAppStore.getState().activeProposals).toHaveLength(1);
    });
  });
});
