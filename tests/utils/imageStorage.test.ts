import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── IndexedDB shim – must come before any import of the module under test ─
import 'fake-indexeddb/auto';

// ── Logger mock ────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  savePageImages,
  loadPageImages,
  clearPageImages,
  savePageImagesById,
  loadPageImagesById,
  clearPageImagesById,
  saveActiveProposalIds,
  loadActiveProposalIds,
  clearActiveProposalIds,
  saveActiveProposalMeta,
  loadActiveProposalMeta,
  clearActiveProposalMeta,
} from '../../src/utils/imageStorage';

// ── Helpers ────────────────────────────────────────────────────────────────
function makePage(pageNumber: number) {
  return {
    pageNumber,
    text: `Page ${pageNumber} text content`,
    imageDataUrl: `data:image/jpeg;base64,fake-image-data-${pageNumber}`,
    croppedImages: [],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('imageStorage – savePageImages / loadPageImages / clearPageImages', () => {
  beforeEach(async () => {
    // Clear storage before each test for isolation
    await clearPageImages();
  });

  describe('savePageImages', () => {
    it('saves without throwing for a valid array of pages', async () => {
      await expect(savePageImages([makePage(1), makePage(2)])).resolves.not.toThrow();
    });

    it('saves an empty array without throwing', async () => {
      await expect(savePageImages([])).resolves.not.toThrow();
    });
  });

  describe('loadPageImages', () => {
    it('returns an empty array when nothing has been saved', async () => {
      const result = await loadPageImages();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('returns the saved pages after savePageImages is called', async () => {
      const pages = [makePage(1), makePage(2), makePage(3)];
      await savePageImages(pages);
      const result = await loadPageImages();
      expect(result).toHaveLength(3);
      expect(result[0].pageNumber).toBe(1);
      expect(result[2].pageNumber).toBe(3);
    });

    it('overwrites previous pages when savePageImages is called again', async () => {
      await savePageImages([makePage(1), makePage(2)]);
      await savePageImages([makePage(10)]);
      const result = await loadPageImages();
      expect(result).toHaveLength(1);
      expect(result[0].pageNumber).toBe(10);
    });
  });

  describe('clearPageImages', () => {
    it('clears saved pages so loadPageImages returns empty array', async () => {
      await savePageImages([makePage(1), makePage(2)]);
      await clearPageImages();
      const result = await loadPageImages();
      expect(result).toHaveLength(0);
    });

    it('does not throw when clearing already-empty storage', async () => {
      await expect(clearPageImages()).resolves.not.toThrow();
    });
  });
});

// ── Per-proposal ID storage tests ─────────────────────────────────────────
describe('imageStorage – savePageImagesById / loadPageImagesById / clearPageImagesById', () => {
  const PROPOSAL_ID_1 = 'proposal_001_abc';
  const PROPOSAL_ID_2 = 'proposal_002_xyz';

  beforeEach(async () => {
    await clearPageImagesById(PROPOSAL_ID_1);
    await clearPageImagesById(PROPOSAL_ID_2);
  });

  describe('savePageImagesById', () => {
    it('saves pages for a specific proposal ID without throwing', async () => {
      await expect(
        savePageImagesById(PROPOSAL_ID_1, [makePage(1), makePage(2)]),
      ).resolves.not.toThrow();
    });
  });

  describe('loadPageImagesById', () => {
    it('returns empty array for a proposal ID that has no saved pages', async () => {
      const result = await loadPageImagesById('non-existent-proposal-id');
      expect(result).toHaveLength(0);
    });

    it('returns correct pages for the saved proposal ID', async () => {
      const pages = [makePage(1), makePage(2)];
      await savePageImagesById(PROPOSAL_ID_1, pages);
      const result = await loadPageImagesById(PROPOSAL_ID_1);
      expect(result).toHaveLength(2);
      expect(result[0].pageNumber).toBe(1);
    });

    it('isolates pages between different proposal IDs', async () => {
      await savePageImagesById(PROPOSAL_ID_1, [makePage(1)]);
      await savePageImagesById(PROPOSAL_ID_2, [makePage(99), makePage(100)]);

      const result1 = await loadPageImagesById(PROPOSAL_ID_1);
      const result2 = await loadPageImagesById(PROPOSAL_ID_2);

      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(2);
      expect(result2[0].pageNumber).toBe(99);
    });
  });

  describe('clearPageImagesById', () => {
    it('clears only the specified proposal ID', async () => {
      await savePageImagesById(PROPOSAL_ID_1, [makePage(1)]);
      await savePageImagesById(PROPOSAL_ID_2, [makePage(2)]);

      await clearPageImagesById(PROPOSAL_ID_1);

      const result1 = await loadPageImagesById(PROPOSAL_ID_1);
      const result2 = await loadPageImagesById(PROPOSAL_ID_2);

      expect(result1).toHaveLength(0);   // cleared
      expect(result2).toHaveLength(1);   // untouched
    });

    it('does not throw when clearing a non-existent proposal ID', async () => {
      await expect(clearPageImagesById('does-not-exist')).resolves.not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Active Proposal IDs (localStorage)
// ─────────────────────────────────────────────────────────────────────────────
describe('imageStorage – saveActiveProposalIds / loadActiveProposalIds / clearActiveProposalIds', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty array when nothing has been saved', () => {
    const result = loadActiveProposalIds();
    expect(result).toEqual([]);
  });

  it('saves and loads an array of proposal IDs correctly', () => {
    const ids = ['id-001', 'id-002', 'id-003'];
    saveActiveProposalIds(ids);
    const result = loadActiveProposalIds();
    expect(result).toEqual(ids);
  });

  it('overwrites previous IDs on a second save', () => {
    saveActiveProposalIds(['old-id-1', 'old-id-2']);
    saveActiveProposalIds(['new-id-1']);
    const result = loadActiveProposalIds();
    expect(result).toEqual(['new-id-1']);
  });

  it('returns empty array after clearActiveProposalIds', () => {
    saveActiveProposalIds(['id-a', 'id-b']);
    clearActiveProposalIds();
    const result = loadActiveProposalIds();
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Active Proposal Meta (localStorage)
// ─────────────────────────────────────────────────────────────────────────────
describe('imageStorage – saveActiveProposalMeta / loadActiveProposalMeta / clearActiveProposalMeta', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const makeMeta = (id: string) => ({
    id,
    fileName: `proposal-${id}.pdf`,
    fileType: 'application/pdf',
    pageCount: 2,
    textContent: `Text content for ${id}`,
    fileUrl: `https://example.com/${id}.pdf`,
  });

  it('returns an empty array when nothing has been saved', () => {
    const result = loadActiveProposalMeta();
    expect(result).toEqual([]);
  });

  it('saves and loads metadata array correctly', () => {
    const meta = [makeMeta('m-001'), makeMeta('m-002')];
    saveActiveProposalMeta(meta);
    const result = loadActiveProposalMeta();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('m-001');
    expect(result[1].id).toBe('m-002');
  });

  it('strips fileUrl from saved metadata (lightweight meta only)', () => {
    saveActiveProposalMeta([makeMeta('strip-test')]);
    const result = loadActiveProposalMeta();
    // fileUrl should not be persisted — only lightweight fields
    expect(result[0].fileUrl).toBeUndefined();
  });

  it('returns empty array after clearActiveProposalMeta', () => {
    saveActiveProposalMeta([makeMeta('to-clear')]);
    clearActiveProposalMeta();
    const result = loadActiveProposalMeta();
    expect(result).toEqual([]);
  });
});
