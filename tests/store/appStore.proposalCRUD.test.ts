import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup (must precede store import) ──────────────────────────────────

vi.mock('../../src/services/companyService', () => ({
  companyService: {
    getCompanySettings: vi.fn().mockResolvedValue(null),
    saveCompanySettings: vi.fn().mockResolvedValue(true),
    subscribeToChanges: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  },
}));

const uploadProposalToCloud = vi.fn();
const loadAllProposalsFromCloud = vi.fn().mockResolvedValue([]);
const downloadProposalFile = vi.fn();
const deleteProposalFromCloud = vi.fn().mockResolvedValue(true);
const checkCloudStorageAvailability = vi.fn().mockResolvedValue(false);

vi.mock('../../src/services/supabaseProposalService', () => ({
  checkCloudStorageAvailability: (...a: any[]) => checkCloudStorageAvailability(...a),
  loadAllProposalsFromCloud: (...a: any[]) => loadAllProposalsFromCloud(...a),
  uploadProposalToCloud: (...a: any[]) => uploadProposalToCloud(...a),
  deleteProposalFromCloud: (...a: any[]) => deleteProposalFromCloud(...a),
  downloadProposalFile: (...a: any[]) => downloadProposalFile(...a),
  cloudProposalToStored: vi.fn((p) => p),
}));

const savePageImagesToDB = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/utils/imageStorage', () => ({
  savePageImages: (...a: any[]) => savePageImagesToDB(...a),
  clearPageImages: vi.fn().mockResolvedValue(undefined),
  savePageImagesById: vi.fn().mockResolvedValue(undefined),
  loadPageImagesById: vi.fn().mockResolvedValue([]),
  clearPageImagesById: vi.fn().mockResolvedValue(undefined),
  saveActiveProposalIds: vi.fn(),
  loadActiveProposalIds: vi.fn().mockReturnValue([]),
  saveActiveProposalMeta: vi.fn(),
  loadActiveProposalMeta: vi.fn().mockReturnValue([]),
}));

const extractPDFContent = vi.fn().mockResolvedValue({
  textContent: 'pdf-text',
  pageCount: 2,
  images: [],
  pageImages: [{ pageNumber: 1, imageData: 'data:image/png;base64,XYZ' }],
});
vi.mock('../../src/utils/pdfUtils', () => ({
  extractPDFContent: (...a: any[]) => extractPDFContent(...a),
}));

const loadProposalById = vi.fn();
const saveProposalToLibrary = vi.fn().mockResolvedValue('local-saved-id');
const deleteProposalFromDB = vi.fn().mockResolvedValue(undefined);
const loadProposalsFromDB = vi.fn().mockResolvedValue([]);
vi.mock('../../src/utils/proposalStorage', () => ({
  loadRecentProposals: (...a: any[]) => loadProposalsFromDB(...a),
  loadProposalById: (...a: any[]) => loadProposalById(...a),
  deleteProposalFromLibrary: (...a: any[]) => deleteProposalFromDB(...a),
  saveProposalToLibrary: (...a: any[]) => saveProposalToLibrary(...a),
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn(), storage: { from: vi.fn() }, auth: { getUser: vi.fn() } },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Auth store mock — setProposal reads useAuthStore.getState() inside the cloud branch
vi.mock('../../src/store/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'user-1', full_name: 'Tester' } })),
  },
}));

if (typeof URL.createObjectURL === 'undefined') {
  (URL as any).createObjectURL = vi.fn(() => 'blob:mock-url');
} else {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url') as any;
}

// ── Import store AFTER mocks ────────────────────────────────────────────────
import { useAppStore } from '../../src/store';

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeFile = (name = 'deck.pdf', type = 'application/pdf') =>
  new File([new Blob(['pdf-bytes'])], name, { type });

/**
 * setProposal — cloud-vs-IndexedDB branching
 *
 * Production failure modes this test file prevents:
 *  1. Cloud upload silently skipped when cloudStorageEnabled=true
 *  2. IndexedDB fallback silently skipped when cloud is unavailable
 *  3. pageImages NOT persisted to IndexedDB for viewer reuse
 *  4. recentProposals not refreshed after save (stale library UI)
 *  5. fire-and-forget async errors crash the store
 */
describe('useAppStore.setProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to a known state
    useAppStore.setState({
      proposal: {
        file: null,
        fileName: '',
        fileUrl: '',
        textContent: '',
        pageCount: 0,
        currentPage: 1,
        extractedImages: [],
        pageImages: [],
      } as any,
      cloudStorageEnabled: false,
      recentProposals: [],
    });
    loadProposalsFromDB.mockResolvedValue([]);
    uploadProposalToCloud.mockResolvedValue({ success: true, proposal: { id: 'cloud-id-1' } });
  });

  it('merges partial proposal updates into existing state', () => {
    useAppStore.getState().setProposal({ fileName: 'a.pdf' } as any);
    expect(useAppStore.getState().proposal.fileName).toBe('a.pdf');
  });

  it('persists pageImages to IndexedDB when provided', () => {
    const pageImages = [{ pageNumber: 1, imageData: 'data:image/png;base64,AAA' }];
    useAppStore.getState().setProposal({ pageImages } as any);
    expect(savePageImagesToDB).toHaveBeenCalledWith(pageImages);
  });

  it('skips cloud upload AND IndexedDB save when file is null', () => {
    useAppStore.getState().setProposal({ fileName: 'x.pdf', textContent: 't' } as any);
    expect(uploadProposalToCloud).not.toHaveBeenCalled();
    expect(saveProposalToLibrary).not.toHaveBeenCalled();
  });

  it('saves to IndexedDB (NOT cloud) when cloudStorageEnabled=false', async () => {
    const file = makeFile();
    useAppStore.getState().setProposal({
      file,
      fileName: 'deck.pdf',
      textContent: 'extracted',
      pageCount: 5,
    } as any);

    await flushAsync();

    expect(saveProposalToLibrary).toHaveBeenCalledTimes(1);
    expect(uploadProposalToCloud).not.toHaveBeenCalled();

    const arg = saveProposalToLibrary.mock.calls[0][0];
    expect(arg.fileName).toBe('deck.pdf');
    expect(arg.fileBlob).toBe(file);
    expect(arg.pageCount).toBe(5);
  });

  it('uploads to cloud (NOT IndexedDB) when cloudStorageEnabled=true', async () => {
    useAppStore.setState({ cloudStorageEnabled: true });
    const file = makeFile();

    useAppStore.getState().setProposal({
      file,
      fileName: 'deck.pdf',
      textContent: 'extracted',
      pageCount: 3,
    } as any);

    await flushAsync();
    await flushAsync(); // double tick for nested awaits

    expect(uploadProposalToCloud).toHaveBeenCalledTimes(1);
    expect(saveProposalToLibrary).not.toHaveBeenCalled();

    const [calledFile, calledText, calledPageCount, userId, userName] =
      uploadProposalToCloud.mock.calls[0];
    expect(calledFile).toBe(file);
    expect(calledText).toBe('extracted');
    expect(calledPageCount).toBe(3);
    expect(userId).toBe('user-1');
    expect(userName).toBe('Tester');
  });

  it('reloads recentProposals after IndexedDB save', async () => {
    loadProposalsFromDB.mockResolvedValue([
      { id: 'p1', fileName: 'a.pdf', uploadedAt: new Date() } as any,
    ]);

    useAppStore.getState().setProposal({
      file: makeFile(),
      fileName: 'deck.pdf',
      textContent: 't',
    } as any);

    // Wait for: saveProposalToLibrary → .then → loadRecentProposals
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(loadProposalsFromDB).toHaveBeenCalled();
  });

  it('does NOT throw when cloud upload rejects (fire-and-forget swallows error)', async () => {
    useAppStore.setState({ cloudStorageEnabled: true });
    uploadProposalToCloud.mockRejectedValueOnce(new Error('Network down'));

    expect(() => {
      useAppStore.getState().setProposal({
        file: makeFile(),
        fileName: 'deck.pdf',
        textContent: 't',
      } as any);
    }).not.toThrow();

    await flushAsync();
    await flushAsync();
    // Store still in valid state — no crash
    expect(useAppStore.getState().proposal.fileName).toBe('deck.pdf');
  });
});

/**
 * selectProposal — hybrid local-first, cloud-fallback
 */
describe('useAppStore.selectProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      recentProposals: [],
      cloudStorageEnabled: false,
      proposal: { fileName: '', file: null } as any,
    });
  });

  it('loads from IndexedDB when proposal exists locally', async () => {
    const localBlob = new Blob(['local-pdf'], { type: 'application/pdf' });
    loadProposalById.mockResolvedValueOnce({
      id: 'p1',
      fileName: 'local.pdf',
      fileType: 'application/pdf',
      fileBlob: localBlob,
      textContent: 'text',
      pageCount: 1,
      pageImages: [{ pageNumber: 1, imageData: 'data:image/png;base64,AAA' }],
      extractedImages: [],
      uploadedAt: new Date(),
    });

    await useAppStore.getState().selectProposal('p1');

    expect(loadProposalById).toHaveBeenCalledWith('p1');
    // Should NOT touch cloud download path when local hit
    expect(downloadProposalFile).not.toHaveBeenCalled();
    // Should NOT re-extract PDF when pageImages already cached
    expect(extractPDFContent).not.toHaveBeenCalled();

    const proposal = useAppStore.getState().proposal;
    expect(proposal.fileName).toBe('local.pdf');
    expect(proposal.fileUrl).toBe('blob:mock-url');
  });

  it('falls back to cloud download when proposal missing locally', async () => {
    loadProposalById.mockResolvedValueOnce(null);
    const cloudBlob = new Blob(['cloud-pdf'], { type: 'application/pdf' });
    downloadProposalFile.mockResolvedValueOnce(cloudBlob);

    useAppStore.setState({
      recentProposals: [
        {
          id: 'p2',
          fileName: 'cloud.pdf',
          fileType: 'application/pdf',
          isCloudStored: true,
          storagePath: 'cloud/path/p2.pdf',
          textContent: 'cloud-text',
          pageCount: 2,
          pageImages: [],
          extractedImages: [],
          uploadedAt: new Date(),
        } as any,
      ],
    });

    await useAppStore.getState().selectProposal('p2');

    expect(downloadProposalFile).toHaveBeenCalledWith('cloud/path/p2.pdf');
    // Cloud PDFs trigger image re-extraction
    expect(extractPDFContent).toHaveBeenCalled();
    expect(useAppStore.getState().proposal.fileName).toBe('cloud.pdf');
  });

  it('returns silently (no state change) when proposal not found anywhere', async () => {
    loadProposalById.mockResolvedValueOnce(null);
    const before = useAppStore.getState().proposal;

    await useAppStore.getState().selectProposal('missing-id');

    expect(useAppStore.getState().proposal).toBe(before);
    expect(downloadProposalFile).not.toHaveBeenCalled();
  });

  it('returns silently when cloud download throws', async () => {
    loadProposalById.mockResolvedValueOnce(null);
    downloadProposalFile.mockRejectedValueOnce(new Error('Cloud 500'));

    useAppStore.setState({
      recentProposals: [
        {
          id: 'p3',
          isCloudStored: true,
          storagePath: 'cloud/p3.pdf',
          fileName: 'fail.pdf',
        } as any,
      ],
    });

    const before = useAppStore.getState().proposal;
    await useAppStore.getState().selectProposal('p3');

    // Failed download must NOT corrupt state
    expect(useAppStore.getState().proposal).toBe(before);
  });
});

/**
 * deleteProposalFromLibrary — must always attempt local delete; cloud delete is conditional
 */
describe('useAppStore.deleteProposalFromLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ recentProposals: [], cloudStorageEnabled: false });
  });

  it('deletes from IndexedDB unconditionally', async () => {
    await useAppStore.getState().deleteProposalFromLibrary('p1');
    expect(deleteProposalFromDB).toHaveBeenCalledWith('p1');
  });

  it('does NOT call cloud delete when proposal is local-only', async () => {
    useAppStore.setState({
      cloudStorageEnabled: true,
      recentProposals: [{ id: 'p1', isCloudStored: false } as any],
    });

    await useAppStore.getState().deleteProposalFromLibrary('p1');
    expect(deleteProposalFromCloud).not.toHaveBeenCalled();
  });

  it('calls cloud delete when proposal is cloud-stored AND cloud is enabled', async () => {
    useAppStore.setState({
      cloudStorageEnabled: true,
      recentProposals: [
        { id: 'p1', isCloudStored: true, storagePath: 'cloud/p1.pdf' } as any,
      ],
    });

    await useAppStore.getState().deleteProposalFromLibrary('p1');
    expect(deleteProposalFromCloud).toHaveBeenCalledWith('p1');
  });

  it('does NOT call cloud delete when cloud is disabled, even for cloud proposals', async () => {
    useAppStore.setState({
      cloudStorageEnabled: false,
      recentProposals: [
        { id: 'p1', isCloudStored: true, storagePath: 'cloud/p1.pdf' } as any,
      ],
    });

    await useAppStore.getState().deleteProposalFromLibrary('p1');
    expect(deleteProposalFromCloud).not.toHaveBeenCalled();
  });

  it('continues to reload library even if local delete throws', async () => {
    deleteProposalFromDB.mockRejectedValueOnce(new Error('Not found'));

    await useAppStore.getState().deleteProposalFromLibrary('p1');

    // loadProposalsFromDB IS called via loadRecentProposals despite the error
    expect(loadProposalsFromDB).toHaveBeenCalled();
  });
});

/**
 * checkCloudStorage — must always set cloudStorageEnabled (never leave undefined)
 */
describe('useAppStore.checkCloudStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ cloudStorageEnabled: false });
  });

  it('sets cloudStorageEnabled=true when probe succeeds', async () => {
    checkCloudStorageAvailability.mockResolvedValueOnce(true);
    await useAppStore.getState().checkCloudStorage();
    expect(useAppStore.getState().cloudStorageEnabled).toBe(true);
  });

  it('sets cloudStorageEnabled=false when probe returns false', async () => {
    checkCloudStorageAvailability.mockResolvedValueOnce(false);
    await useAppStore.getState().checkCloudStorage();
    expect(useAppStore.getState().cloudStorageEnabled).toBe(false);
  });

  it('sets cloudStorageEnabled=false (safe default) when probe THROWS', async () => {
    checkCloudStorageAvailability.mockRejectedValueOnce(new Error('Network'));
    await useAppStore.getState().checkCloudStorage();
    expect(useAppStore.getState().cloudStorageEnabled).toBe(false);
  });
});
