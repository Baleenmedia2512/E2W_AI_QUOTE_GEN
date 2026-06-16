/**
 * Proposal Library Storage - IndexedDB
 * Stores complete proposals (file + extracted data) for reuse
 */

import { StoredProposal } from '../types';
import { logger } from './logger';

const DB_NAME = 'e2w_quote_gen';
const DB_VERSION = 3; // Increment version for new object store
const PROPOSALS_STORE = 'proposal_library';
const MAX_PROPOSALS = 10; // Keep last 10 proposals

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Create proposal_library store if it doesn't exist
      if (!db.objectStoreNames.contains(PROPOSALS_STORE)) {
        const store = db.createObjectStore(PROPOSALS_STORE, { keyPath: 'id' });
        store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
        store.createIndex('fileName', 'fileName', { unique: false });
        logger.info('✅ Created proposal_library object store');
      }

      // Keep existing proposal_images store (don't break it)
      if (!db.objectStoreNames.contains('proposal_images')) {
        db.createObjectStore('proposal_images');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a proposal to the library
 */
export async function saveProposalToLibrary(proposal: Omit<StoredProposal, 'id'>): Promise<string> {
  try {
    const db = await openDB();
    const id = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const storedProposal: StoredProposal = {
      id,
      ...proposal,
      uploadedAt: new Date(proposal.uploadedAt), // Ensure it's a Date object
    };

    const tx = db.transaction(PROPOSALS_STORE, 'readwrite');
    const store = tx.objectStore(PROPOSALS_STORE);

    // Add the new proposal
    store.put(storedProposal);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();

    // Cleanup old proposals (keep only MAX_PROPOSALS)
    await cleanupOldProposals();

    logger.info('✅ Saved proposal to library:', storedProposal.fileName);
    return id;
  } catch (error) {
    logger.error('❌ Failed to save proposal to library:', error);
    throw error;
  }
}

/**
 * Load all recent proposals
 */
export async function loadRecentProposals(): Promise<StoredProposal[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(PROPOSALS_STORE, 'readonly');
    const store = tx.objectStore(PROPOSALS_STORE);
    const index = store.index('uploadedAt');

    // Get all proposals, newest first
    const request = index.openCursor(null, 'prev');
    const proposals: StoredProposal[] = [];

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && proposals.length < MAX_PROPOSALS) {
          proposals.push(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });

    db.close();

    logger.info(`✅ Loaded ${proposals.length} proposals from library`);
    return proposals;
  } catch (error) {
    logger.warn('⚠️ Failed to load proposals from library:', error);
    return [];
  }
}

/**
 * Load a specific proposal by ID
 */
export async function loadProposalById(id: string): Promise<StoredProposal | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(PROPOSALS_STORE, 'readonly');
    const store = tx.objectStore(PROPOSALS_STORE);
    const request = store.get(id);

    const result = await new Promise<StoredProposal | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (result) {
      logger.info('✅ Loaded proposal from library:', result.fileName);
    }
    return result;
  } catch (error) {
    logger.error('❌ Failed to load proposal by ID:', error);
    return null;
  }
}

/**
 * Check if a proposal with the same name, type, and size already exists
 * Returns the existing proposal if found, null otherwise
 */
export async function findDuplicateProposal(
  fileName: string,
  fileType: string,
  fileSize: number,
): Promise<StoredProposal | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(PROPOSALS_STORE, 'readonly');
    const store = tx.objectStore(PROPOSALS_STORE);
    const index = store.index('fileName');

    // Get all proposals with the same file name
    const request = index.getAll(fileName);

    const results = await new Promise<StoredProposal[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    db.close();

    // Find exact match by name, type, and size
    const duplicate = results.find(
      (proposal) =>
        proposal.fileName === fileName &&
        proposal.fileType === fileType &&
        proposal.fileSize === fileSize,
    );

    if (duplicate) {
      logger.info('🔍 Found duplicate proposal:', duplicate.fileName);
    }

    return duplicate || null;
  } catch (error) {
    logger.warn('⚠️ Failed to check for duplicates:', error);
    return null;
  }
}

/**
 * Delete a proposal from the library
 */
export async function deleteProposalFromLibrary(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PROPOSALS_STORE, 'readwrite');
    const store = tx.objectStore(PROPOSALS_STORE);
    store.delete(id);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();

    logger.info('✅ Deleted proposal from library:', id);
  } catch (error) {
    logger.error('❌ Failed to delete proposal:', error);
    throw error;
  }
}

/**
 * Clean up old proposals (keep only MAX_PROPOSALS)
 */
async function cleanupOldProposals(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PROPOSALS_STORE, 'readwrite');
    const store = tx.objectStore(PROPOSALS_STORE);
    const index = store.index('uploadedAt');

    // Get all proposals
    const request = index.openCursor(null, 'prev');
    const proposals: { id: string; uploadedAt: Date }[] = [];

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          proposals.push({ id: cursor.value.id, uploadedAt: cursor.value.uploadedAt });
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });

    // Delete oldest proposals if we exceed MAX_PROPOSALS
    if (proposals.length > MAX_PROPOSALS) {
      const toDelete = proposals.slice(MAX_PROPOSALS);
      for (const proposal of toDelete) {
        store.delete(proposal.id);
        logger.info('🗑️ Cleaned up old proposal:', proposal.id);
      }
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (error) {
    logger.warn('⚠️ Failed to cleanup old proposals:', error);
  }
}

/**
 * Clear all proposals from library
 */
export async function clearProposalLibrary(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PROPOSALS_STORE, 'readwrite');
    const store = tx.objectStore(PROPOSALS_STORE);
    store.clear();

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();

    logger.info('✅ Cleared proposal library');
  } catch (error) {
    logger.error('❌ Failed to clear proposal library:', error);
    throw error;
  }
}
