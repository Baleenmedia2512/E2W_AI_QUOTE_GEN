const DB_NAME = 'e2w_quote_gen';
const DB_VERSION = 3;
const STORE_NAME = 'proposal_images';
const KEY = 'pageImages';
const ACTIVE_IDS_KEY = 'activeProposalIds'; // localStorage key for persisting loaded proposal IDs

interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
  croppedImages?: string[];
  sourceId?: string;
  sourceName?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePageImages(pageImages: ExtractedPage[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(pageImages, KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('Failed to save page images to IndexedDB:', e);
  }
}

export async function loadPageImages(): Promise<ExtractedPage[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(KEY);
    const result = await new Promise<ExtractedPage[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.warn('Failed to load page images from IndexedDB:', e);
    return [];
  }
}

export async function clearPageImages(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('Failed to clear page images from IndexedDB:', e);
  }
}

// ── Per-proposal ID storage (Fix: no overwrite) ──────────────────────────

/** Save pages for a specific proposal by its ID */
export async function savePageImagesById(proposalId: string, pageImages: ExtractedPage[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(pageImages, `pageImages_${proposalId}`);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn(`Failed to save page images for proposal ${proposalId}:`, e);
  }
}

/** Load pages for a specific proposal by its ID */
export async function loadPageImagesById(proposalId: string): Promise<ExtractedPage[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(`pageImages_${proposalId}`);
    const result = await new Promise<ExtractedPage[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.warn(`Failed to load page images for proposal ${proposalId}:`, e);
    return [];
  }
}

/** Clear pages for a specific proposal by its ID */
export async function clearPageImagesById(proposalId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(`pageImages_${proposalId}`);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn(`Failed to clear page images for proposal ${proposalId}:`, e);
  }
}

// ── Active proposal ID list (localStorage — survives refresh) ─────────────

/** Save the list of currently active proposal IDs to localStorage */
export function saveActiveProposalIds(ids: string[]): void {
  try {
    localStorage.setItem(ACTIVE_IDS_KEY, JSON.stringify(ids));
  } catch (e) {
    console.warn('Failed to save active proposal IDs:', e);
  }
}

/** Load the list of currently active proposal IDs from localStorage */
export function loadActiveProposalIds(): string[] {
  try {
    const saved = localStorage.getItem(ACTIVE_IDS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.warn('Failed to load active proposal IDs:', e);
    return [];
  }
}

/** Clear the active proposal ID list from localStorage */
export function clearActiveProposalIds(): void {
  try {
    localStorage.removeItem(ACTIVE_IDS_KEY);
  } catch (e) {
    console.warn('Failed to clear active proposal IDs:', e);
  }
}

const ACTIVE_META_KEY = 'activeProposalMeta'; // localStorage key for proposal metadata

interface ActiveProposalMeta {
  id: string;
  fileName: string;
  fileType: string;
  pageCount: number;
  textContent: string;
  fileUrl?: string;
}

/** Save metadata for all active proposals to localStorage (for refresh restore) */
export function saveActiveProposalMeta(proposals: ActiveProposalMeta[]): void {
  try {
    // Strip pageImages — only save lightweight metadata
    const meta = proposals.map(p => ({
      id: p.id,
      fileName: p.fileName,
      fileType: p.fileType,
      pageCount: p.pageCount,
      textContent: p.textContent,
    }));
    localStorage.setItem(ACTIVE_META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('Failed to save active proposal meta:', e);
  }
}

/** Load active proposal metadata from localStorage */
export function loadActiveProposalMeta(): ActiveProposalMeta[] {
  try {
    const saved = localStorage.getItem(ACTIVE_META_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.warn('Failed to load active proposal meta:', e);
    return [];
  }
}

/** Clear active proposal metadata from localStorage */
export function clearActiveProposalMeta(): void {
  try {
    localStorage.removeItem(ACTIVE_META_KEY);
  } catch (e) {
    console.warn('Failed to clear active proposal meta:', e);
  }
}
