import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── IndexedDB shim – must come before any import of the module under test ─
import 'fake-indexeddb/auto';

// ── Logger mock ────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  saveProposalToLibrary,
  loadRecentProposals,
  loadProposalById,
  findDuplicateProposal,
  deleteProposalFromLibrary,
  clearProposalLibrary,
} from '../../src/utils/proposalStorage';

// ── Helpers ────────────────────────────────────────────────────────────────
function makeFakeProposal(overrides: Partial<any> = {}) {
  return {
    fileName: 'test-proposal.pdf',
    fileType: 'application/pdf',
    fileSize: 1024,
    uploadedAt: new Date(),
    extractedText: 'Sample proposal text about bus branding services.',
    pageCount: 3,
    ...overrides,
  };
}

describe('proposalStorage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── saveProposalToLibrary ──────────────────────────────────────────────
  describe('saveProposalToLibrary', () => {
    it('returns a string ID that starts with "proposal_"', async () => {
      // Use real indexedDB from fake-indexeddb (jsdom provides it)
      const id = await saveProposalToLibrary(makeFakeProposal());
      expect(typeof id).toBe('string');
      expect(id.startsWith('proposal_')).toBe(true);
    });

    it('generates unique IDs on successive calls', async () => {
      const id1 = await saveProposalToLibrary(makeFakeProposal());
      const id2 = await saveProposalToLibrary(makeFakeProposal());
      expect(id1).not.toBe(id2);
    });

    it('stores the fileName in the saved proposal', async () => {
      const id = await saveProposalToLibrary(
        makeFakeProposal({ fileName: 'baleen-media-rates.pdf' }),
      );
      const loaded = await loadProposalById(id);
      expect(loaded?.fileName).toBe('baleen-media-rates.pdf');
    });

    it('stores extractedText in the saved proposal', async () => {
      const text = 'Bus Full Branding rate card text';
      const id = await saveProposalToLibrary(makeFakeProposal({ extractedText: text }));
      const loaded = await loadProposalById(id);
      expect(loaded?.extractedText).toBe(text);
    });
  });

  // ── loadRecentProposals ────────────────────────────────────────────────
  describe('loadRecentProposals', () => {
    it('returns an array (empty or populated)', async () => {
      const result = await loadRecentProposals();
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns proposals after saving', async () => {
      await saveProposalToLibrary(makeFakeProposal({ fileName: 'proposal-a.pdf' }));
      const results = await loadRecentProposals();
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('never returns more than 10 proposals', async () => {
      // Save 12 proposals
      for (let i = 0; i < 12; i++) {
        await saveProposalToLibrary(makeFakeProposal({ fileName: `proposal-${i}.pdf` }));
      }
      const results = await loadRecentProposals();
      expect(results.length).toBeLessThanOrEqual(10);
    });
  });

  // ── loadProposalById ───────────────────────────────────────────────────
  describe('loadProposalById', () => {
    it('returns null for a non-existent ID', async () => {
      const result = await loadProposalById('non-existent-id-xyz');
      expect(result).toBeNull();
    });

    it('returns the correct proposal for a saved ID', async () => {
      const id = await saveProposalToLibrary(makeFakeProposal({ fileName: 'my-doc.pdf' }));
      const result = await loadProposalById(id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(id);
      expect(result?.fileName).toBe('my-doc.pdf');
    });
  });

  // ── findDuplicateProposal ──────────────────────────────────────────────
  describe('findDuplicateProposal', () => {
    it('returns null when no proposals exist', async () => {
      const result = await findDuplicateProposal('unique-file.pdf', 'application/pdf', 2048);
      expect(result).toBeNull();
    });

    it('finds a duplicate by fileName, fileType, and fileSize', async () => {
      await saveProposalToLibrary(
        makeFakeProposal({
          fileName: 'duplicate.pdf',
          fileType: 'application/pdf',
          fileSize: 5000,
        }),
      );
      const dup = await findDuplicateProposal('duplicate.pdf', 'application/pdf', 5000);
      expect(dup).not.toBeNull();
      expect(dup?.fileName).toBe('duplicate.pdf');
    });

    it('returns null when file size differs (not a true duplicate)', async () => {
      await saveProposalToLibrary(
        makeFakeProposal({
          fileName: 'same-name.pdf',
          fileType: 'application/pdf',
          fileSize: 1000,
        }),
      );
      const result = await findDuplicateProposal('same-name.pdf', 'application/pdf', 9999);
      expect(result).toBeNull();
    });
  });

  // ── deleteProposalFromLibrary ──────────────────────────────────────────
  describe('deleteProposalFromLibrary', () => {
    it('removes a saved proposal so loadProposalById returns null', async () => {
      const id = await saveProposalToLibrary(makeFakeProposal({ fileName: 'to-delete.pdf' }));
      await deleteProposalFromLibrary(id);
      const result = await loadProposalById(id);
      expect(result).toBeNull();
    });

    it('does not throw when deleting a non-existent ID', async () => {
      await expect(deleteProposalFromLibrary('non-existent-id-abc')).resolves.not.toThrow();
    });

    it('removes the deleted proposal from loadRecentProposals', async () => {
      const id = await saveProposalToLibrary(makeFakeProposal({ fileName: 'delete-me.pdf' }));
      const beforeDelete = await loadRecentProposals();
      const foundBefore = beforeDelete.some((p: any) => p.id === id);
      expect(foundBefore).toBe(true);

      await deleteProposalFromLibrary(id);

      const afterDelete = await loadRecentProposals();
      const foundAfter = afterDelete.some((p: any) => p.id === id);
      expect(foundAfter).toBe(false);
    });
  });

  // ── clearProposalLibrary ───────────────────────────────────────────────
  describe('clearProposalLibrary', () => {
    it('removes all proposals so loadRecentProposals returns empty array', async () => {
      await saveProposalToLibrary(makeFakeProposal({ fileName: 'a.pdf' }));
      await saveProposalToLibrary(makeFakeProposal({ fileName: 'b.pdf' }));
      await clearProposalLibrary();
      const results = await loadRecentProposals();
      expect(results).toHaveLength(0);
    });

    it('does not throw when clearing an already empty library', async () => {
      await clearProposalLibrary(); // ensure empty
      await expect(clearProposalLibrary()).resolves.not.toThrow();
    });
  });
});
