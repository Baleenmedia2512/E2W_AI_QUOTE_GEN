import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../src/store';
import { simpleQuote, quoteWithGST } from '../fixtures/quotes';
import { sampleCompany } from '../fixtures/companies';

// Mock all external dependencies of the store
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

vi.mock('../../src/utils/imageStorage', () => ({
  savePageImages: vi.fn().mockResolvedValue(undefined),
  clearPageImages: vi.fn().mockResolvedValue(undefined),
  savePageImagesById: vi.fn().mockResolvedValue(undefined),
  loadPageImagesById: vi.fn().mockResolvedValue([]),
  clearPageImagesById: vi.fn().mockResolvedValue(undefined),
  saveActiveProposalIds: vi.fn().mockResolvedValue(undefined),
  loadActiveProposalIds: vi.fn().mockResolvedValue([]),
  saveActiveProposalMeta: vi.fn().mockResolvedValue(undefined),
  loadActiveProposalMeta: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/utils/pdfUtils', () => ({
  extractPDFContent: vi.fn().mockResolvedValue({ textContent: '', pageCount: 0, images: [], pageImages: [] }),
}));

vi.mock('../../src/utils/proposalStorage', () => ({
  loadRecentProposals: vi.fn().mockResolvedValue([]),
  loadProposalById: vi.fn().mockResolvedValue(null),
  deleteProposalFromLibrary: vi.fn().mockResolvedValue(undefined),
  saveProposalToLibrary: vi.fn().mockResolvedValue('saved-id'),
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn(), storage: { from: vi.fn() }, auth: { getUser: vi.fn() } },
}));

// ─────────────────────────────────────────────
// Helper: reset store to fresh state
// ─────────────────────────────────────────────
function resetStore() {
  localStorage.clear();
  useAppStore.setState({
    messages: [],
    currentQuote: null,
    companyInfo: {
      name: '', address: '', gst: '', abn: '', phone: '',
      email: '', logo: '', website: '', signature: '', designation: '',
    },
    recentProposals: [],
    cloudStorageEnabled: false,
    clientInfo: null,
    selectedTemplate: 'corporate-minimal',
    activeProposals: [],
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
  });
}

describe('useAppStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // ─────────────────────────────────────────────
  // Messages (Chat state)
  // ─────────────────────────────────────────────
  describe('messages / chat', () => {
    it('addMessage appends a message to messages array', () => {
      const msg = { id: '1', role: 'user' as const, content: 'Hello', timestamp: new Date() };
      useAppStore.getState().addMessage(msg);
      expect(useAppStore.getState().messages).toHaveLength(1);
      expect(useAppStore.getState().messages[0]).toEqual(msg);
    });

    it('addMessage appends multiple messages in order', () => {
      const msg1 = { id: '1', role: 'user' as const, content: 'First', timestamp: new Date() };
      const msg2 = { id: '2', role: 'assistant' as const, content: 'Second', timestamp: new Date() };
      useAppStore.getState().addMessage(msg1);
      useAppStore.getState().addMessage(msg2);
      const msgs = useAppStore.getState().messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('First');
      expect(msgs[1].content).toBe('Second');
    });

    it('clearMessages resets messages to empty array', () => {
      const msg = { id: '1', role: 'user' as const, content: 'Test', timestamp: new Date() };
      useAppStore.getState().addMessage(msg);
      useAppStore.getState().clearMessages();
      expect(useAppStore.getState().messages).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // Quote state
  // ─────────────────────────────────────────────
  describe('quote state', () => {
    it('setCurrentQuote stores the quote in state', () => {
      useAppStore.getState().setCurrentQuote(simpleQuote);
      expect(useAppStore.getState().currentQuote).toEqual(simpleQuote);
    });

    it('setCurrentQuote persists quote to localStorage', () => {
      useAppStore.getState().setCurrentQuote(simpleQuote);
      const stored = localStorage.getItem('currentQuote');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.id).toBe(simpleQuote.id);
    });

    it('setCurrentQuote accepts null (clear quote)', () => {
      useAppStore.getState().setCurrentQuote(simpleQuote);
      useAppStore.getState().setCurrentQuote(null);
      expect(useAppStore.getState().currentQuote).toBeNull();
    });

    it('updateQuote updates the current quote', () => {
      useAppStore.getState().setCurrentQuote(simpleQuote);
      const updated = { ...simpleQuote, total: 99999 };
      useAppStore.getState().updateQuote(updated);
      expect(useAppStore.getState().currentQuote?.total).toBe(99999);
    });

    it('updateQuote persists updated quote to localStorage', () => {
      useAppStore.getState().updateQuote(quoteWithGST);
      const stored = JSON.parse(localStorage.getItem('currentQuote')!);
      expect(stored.gstEnabled).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // Company state
  // ─────────────────────────────────────────────
  describe('company state', () => {
    it('setCompanyInfo stores company in state', () => {
      useAppStore.getState().setCompanyInfo(sampleCompany);
      expect(useAppStore.getState().companyInfo.name).toBe(sampleCompany.name);
    });

    it('setCompanyInfo persists to localStorage', () => {
      useAppStore.getState().setCompanyInfo(sampleCompany);
      const stored = localStorage.getItem('companyInfo');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.name).toBe(sampleCompany.name);
    });

    it('syncCompanyFromDatabase calls companyService.getCompanySettings', async () => {
      const { companyService } = await import('../../src/services/companyService');
      vi.mocked(companyService.getCompanySettings).mockResolvedValueOnce(sampleCompany);

      await useAppStore.getState().syncCompanyFromDatabase();

      expect(companyService.getCompanySettings).toHaveBeenCalled();
    });

    it('syncCompanyFromDatabase updates state when DB returns company', async () => {
      const { companyService } = await import('../../src/services/companyService');
      vi.mocked(companyService.getCompanySettings).mockResolvedValueOnce(sampleCompany);

      await useAppStore.getState().syncCompanyFromDatabase();

      expect(useAppStore.getState().companyInfo.name).toBe(sampleCompany.name);
    });

    it('syncCompanyFromDatabase keeps existing state on DB null', async () => {
      const { companyService } = await import('../../src/services/companyService');
      vi.mocked(companyService.getCompanySettings).mockResolvedValueOnce(null);

      useAppStore.getState().setCompanyInfo(sampleCompany);
      await useAppStore.getState().syncCompanyFromDatabase();

      // State should be unchanged since DB returned null
      expect(useAppStore.getState().companyInfo.name).toBe(sampleCompany.name);
    });
  });

  // ─────────────────────────────────────────────
  // Recent proposals
  // ─────────────────────────────────────────────
  describe('loadRecentProposals', () => {
    it('sets recentProposals to empty array when none available', async () => {
      await useAppStore.getState().loadRecentProposals();
      expect(useAppStore.getState().recentProposals).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // loadRecentProposals (with real data)
  // ─────────────────────────────────────────────
  describe('loadRecentProposals (with local data)', () => {
    const makeProposal = (id: string, daysAgo: number) => ({
      id,
      fileName: `proposal-${id}.pdf`,
      fileType: 'application/pdf',
      fileSize: 1024,
      textContent: 'Sample text content',
      pageCount: 2,
      uploadedAt: new Date(Date.now() - daysAgo * 86_400_000),
      isCloudStored: false,
    });

    it('loads and stores proposals returned by proposalStorage', async () => {
      const { loadRecentProposals: loadFromDB } = await import('../../src/utils/proposalStorage');
      const proposals = [makeProposal('p1', 1), makeProposal('p2', 2)];
      vi.mocked(loadFromDB).mockResolvedValueOnce(proposals as any);

      await useAppStore.getState().loadRecentProposals();

      expect(useAppStore.getState().recentProposals).toHaveLength(2);
    });

    it('sorts local proposals by uploadedAt descending (most recent first)', async () => {
      const { loadRecentProposals: loadFromDB } = await import('../../src/utils/proposalStorage');
      const older = makeProposal('old-p', 5);
      const newer = makeProposal('new-p', 1);
      vi.mocked(loadFromDB).mockResolvedValueOnce([older, newer] as any);

      await useAppStore.getState().loadRecentProposals();

      const results = useAppStore.getState().recentProposals;
      expect(results[0].id).toBe('new-p');
      expect(results[1].id).toBe('old-p');
    });

    it('sets recentProposals to empty array when proposalStorage throws', async () => {
      const { loadRecentProposals: loadFromDB } = await import('../../src/utils/proposalStorage');
      vi.mocked(loadFromDB).mockRejectedValueOnce(new Error('IndexedDB failure'));

      await useAppStore.getState().loadRecentProposals();

      expect(useAppStore.getState().recentProposals).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // setProposal
  // ─────────────────────────────────────────────
  describe('setProposal', () => {
    it('merges partial proposal data into state', () => {
      useAppStore.getState().setProposal({ fileName: 'report.pdf', textContent: 'Extracted text', pageCount: 3 });
      const p = useAppStore.getState().proposal;
      expect(p.fileName).toBe('report.pdf');
      expect(p.textContent).toBe('Extracted text');
      expect(p.pageCount).toBe(3);
    });

    it('preserves existing proposal fields when merging', () => {
      useAppStore.getState().setProposal({ fileName: 'first.pdf', pageCount: 5 });
      useAppStore.getState().setProposal({ textContent: 'Updated text' });
      const p = useAppStore.getState().proposal;
      expect(p.fileName).toBe('first.pdf');
      expect(p.pageCount).toBe(5);
      expect(p.textContent).toBe('Updated text');
    });

    it('calls savePageImages when pageImages are provided', async () => {
      const { savePageImages } = await import('../../src/utils/imageStorage');
      const fakeImages = [{ page: 1, dataUrl: 'data:image/png;base64,abc' }];
      useAppStore.getState().setProposal({ pageImages: fakeImages as any });
      expect(savePageImages).toHaveBeenCalledWith(fakeImages);
    });

    it('does not call savePageImages when pageImages is not provided', async () => {
      const { savePageImages } = await import('../../src/utils/imageStorage');
      useAppStore.getState().setProposal({ fileName: 'no-images.pdf' });
      expect(savePageImages).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // resetProposal
  // ─────────────────────────────────────────────
  describe('resetProposal', () => {
    it('resets proposal to empty initial state', () => {
      useAppStore.getState().setProposal({ fileName: 'test.pdf', textContent: 'content', pageCount: 5 });
      useAppStore.getState().resetProposal();
      const p = useAppStore.getState().proposal;
      expect(p.fileName).toBe('');
      expect(p.textContent).toBe('');
      expect(p.pageCount).toBe(0);
      expect(p.extractedImages).toEqual([]);
    });

    it('calls clearPageImages when resetting', async () => {
      const { clearPageImages } = await import('../../src/utils/imageStorage');
      useAppStore.getState().resetProposal();
      expect(clearPageImages).toHaveBeenCalled();
    });

    it('resets proposal even when it was already in initial state', () => {
      useAppStore.getState().resetProposal();
      expect(useAppStore.getState().proposal.fileName).toBe('');
    });
  });

  // ─────────────────────────────────────────────
  // clientInfo state
  // ─────────────────────────────────────────────
  describe('clientInfo state', () => {
    const sampleClient = {
      name: 'Acme Corp',
      company: 'Acme Ltd',
      address: '123 Main St, Chennai',
      gst: 'GST123456',
      phone: '+91-9876543210',
      email: 'contact@acme.com',
    };

    it('initial clientInfo is null when localStorage is empty', () => {
      expect(useAppStore.getState().clientInfo).toBeNull();
    });

    it('setClientInfo stores client info in state', () => {
      useAppStore.getState().setClientInfo(sampleClient);
      expect(useAppStore.getState().clientInfo).toEqual(sampleClient);
    });

    it('setClientInfo persists to localStorage', () => {
      useAppStore.getState().setClientInfo(sampleClient);
      const stored = JSON.parse(localStorage.getItem('clientInfo')!);
      expect(stored.name).toBe('Acme Corp');
      expect(stored.email).toBe('contact@acme.com');
    });

    it('setClientInfo overwrites previous client info', () => {
      useAppStore.getState().setClientInfo(sampleClient);
      useAppStore.getState().setClientInfo({ ...sampleClient, name: 'Beta Ltd' });
      expect(useAppStore.getState().clientInfo?.name).toBe('Beta Ltd');
    });
  });

  // ─────────────────────────────────────────────
  // selectedTemplate state
  // ─────────────────────────────────────────────
  describe('selectedTemplate state', () => {
    it('initial selectedTemplate defaults to corporate-minimal', () => {
      expect(useAppStore.getState().selectedTemplate).toBe('corporate-minimal');
    });

    it('setSelectedTemplate stores template in state', () => {
      useAppStore.getState().setSelectedTemplate('premium-agency');
      expect(useAppStore.getState().selectedTemplate).toBe('premium-agency');
    });

    it('setSelectedTemplate persists to localStorage', () => {
      useAppStore.getState().setSelectedTemplate('modern-sales');
      expect(localStorage.getItem('selectedTemplate')).toBe('modern-sales');
    });

    it('setSelectedTemplate switches between templates correctly', () => {
      useAppStore.getState().setSelectedTemplate('premium-agency');
      useAppStore.getState().setSelectedTemplate('classic-business');
      expect(useAppStore.getState().selectedTemplate).toBe('classic-business');
    });
  });

  // ─────────────────────────────────────────────
  // checkCloudStorage
  // ─────────────────────────────────────────────
  describe('checkCloudStorage', () => {
    it('sets cloudStorageEnabled to false when availability check returns false', async () => {
      const { checkCloudStorageAvailability } = await import('../../src/services/supabaseProposalService');
      vi.mocked(checkCloudStorageAvailability).mockResolvedValueOnce(false);

      await useAppStore.getState().checkCloudStorage();

      expect(useAppStore.getState().cloudStorageEnabled).toBe(false);
    });

    it('sets cloudStorageEnabled to true when cloud is available', async () => {
      const { checkCloudStorageAvailability } = await import('../../src/services/supabaseProposalService');
      vi.mocked(checkCloudStorageAvailability).mockResolvedValueOnce(true);

      await useAppStore.getState().checkCloudStorage();

      expect(useAppStore.getState().cloudStorageEnabled).toBe(true);
    });

    it('sets cloudStorageEnabled to false when availability check throws', async () => {
      const { checkCloudStorageAvailability } = await import('../../src/services/supabaseProposalService');
      vi.mocked(checkCloudStorageAvailability).mockRejectedValueOnce(new Error('Network error'));

      await useAppStore.getState().checkCloudStorage();

      expect(useAppStore.getState().cloudStorageEnabled).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // deleteProposalFromLibrary
  // ─────────────────────────────────────────────
  describe('deleteProposalFromLibrary', () => {
    it('calls deleteProposalFromLibrary service with the given id', async () => {
      const { deleteProposalFromLibrary } = await import('../../src/utils/proposalStorage');
      await useAppStore.getState().deleteProposalFromLibrary('proposal-abc');
      expect(deleteProposalFromLibrary).toHaveBeenCalledWith('proposal-abc');
    });

    it('triggers loadRecentProposals after deletion', async () => {
      const { loadRecentProposals: loadFromDB } = await import('../../src/utils/proposalStorage');
      await useAppStore.getState().deleteProposalFromLibrary('proposal-abc');
      // store's deleteProposalFromLibrary calls state.loadRecentProposals(),
      // which internally calls loadProposalsFromDB (the proposalStorage mock)
      expect(loadFromDB).toHaveBeenCalled();
    });

    it('does not throw when local deletion fails', async () => {
      const { deleteProposalFromLibrary } = await import('../../src/utils/proposalStorage');
      vi.mocked(deleteProposalFromLibrary).mockRejectedValueOnce(new Error('Not found in IndexedDB'));
      // Inner catch swallows this — the action should still resolve
      await expect(useAppStore.getState().deleteProposalFromLibrary('missing-id')).resolves.toBeUndefined();
    });
  });
});
