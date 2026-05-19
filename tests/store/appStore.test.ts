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
});
