import { logger } from '../utils/logger';

/**
 * Data Sync Service - Unified storage layer with conflict resolution
 * Manages synchronization between localStorage, IndexedDB, and Supabase Cloud
 */

// Unused imports - kept for future use
// import { CompanyInfo } from '../types/company';
// import { Quote, ClientInfo } from '../types';

export interface SyncStatus {
  lastSync: Date | null;
  pendingChanges: number;
  conflictsDetected: number;
  isSyncing: boolean;
}

export interface DataWithTimestamp<T> {
  data: T;
  timestamp: number;
  source: 'localStorage' | 'indexedDB' | 'cloud';
  synced: boolean;
}

// Sync queue for offline changes
const syncQueue: Array<{ key: string; data: any; timestamp: number }> = [];

/**
 * Save data to all storage layers with timestamps
 */
export async function saveDataUnified<T>(
  key: string,
  data: T,
  options: {
    localStorage?: boolean;
    indexedDB?: boolean;
    cloud?: boolean;
  } = { localStorage: true, indexedDB: false, cloud: true }
): Promise<{ success: boolean; source: string[] }> {
  const timestamp = Date.now();
  const sources: string[] = [];
  
  const wrappedData: DataWithTimestamp<T> = {
    data,
    timestamp,
    source: 'localStorage',
    synced: false,
  };

  // 1. Always save to localStorage first (fast, synchronous)
  if (options.localStorage !== false) {
    try {
      localStorage.setItem(key, JSON.stringify(wrappedData));
      sources.push('localStorage');
      logger.info(`💾 Saved to localStorage: ${key}`);
    } catch (error) {
      logger.error('localStorage save failed:', error);
    }
  }

  // 2. Save to cloud (primary source of truth)
  if (options.cloud !== false) {
    try {
      // Add to sync queue
      syncQueue.push({ key, data: wrappedData, timestamp });
      
      // Try to sync immediately
      const cloudSuccess = await syncToCloud(key, wrappedData);
      if (cloudSuccess) {
        sources.push('cloud');
        wrappedData.synced = true;
        // Update localStorage with synced status
        localStorage.setItem(key, JSON.stringify(wrappedData));
      }
    } catch (error) {
      logger.warn('Cloud save queued for later:', error);
    }
  }

  return { success: sources.length > 0, source: sources };
}

/**
 * Load data from all sources and resolve conflicts
 */
export async function loadDataUnified<T>(
  key: string,
  options: {
    preferCloud?: boolean;
    maxAge?: number; // milliseconds
  } = {}
): Promise<T | null> {
  const sources: Array<{ data: DataWithTimestamp<T>; source: string }> = [];

  // 1. Load from localStorage (fast)
  try {
    const localData = localStorage.getItem(key);
    if (localData) {
      const parsed = JSON.parse(localData) as DataWithTimestamp<T>;
      sources.push({ data: parsed, source: 'localStorage' });
    }
  } catch (error) {
    logger.error('localStorage load failed:', error);
  }

  // 2. Load from cloud if preferred
  if (options.preferCloud) {
    try {
      const cloudData = await loadFromCloud<T>(key);
      if (cloudData) {
        sources.push({ data: cloudData, source: 'cloud' });
      }
    } catch (error) {
      logger.warn('Cloud load failed, using local:', error);
    }
  }

  // 3. Resolve conflicts (newest wins)
  if (sources.length === 0) {
    return null;
  }

  if (sources.length === 1) {
    const result = sources[0].data;
    
    // Check if data is too old
    if (options.maxAge && Date.now() - result.timestamp > options.maxAge) {
      logger.warn(`Data expired (age: ${Date.now() - result.timestamp}ms)`);
      return null;
    }
    
    return result.data;
  }

  // Multiple sources - resolve conflict
  return resolveConflict(sources, options.maxAge);
}

/**
 * Resolve conflicts between storage sources (newest wins)
 */
function resolveConflict<T>(
  sources: Array<{ data: DataWithTimestamp<T>; source: string }>,
  maxAge?: number
): T | null {
  // Sort by timestamp (newest first)
  const sorted = sources.sort((a, b) => b.data.timestamp - a.data.timestamp);
  
  const newest = sorted[0];
  
  // Check if too old
  if (maxAge && Date.now() - newest.data.timestamp > maxAge) {
    logger.warn('All data sources expired');
    return null;
  }

  // Log conflict resolution
  if (sorted.length > 1) {
    logger.info(`🔄 Conflict resolved: Using ${newest.source} (timestamp: ${new Date(newest.data.timestamp).toLocaleString()})`);
    sorted.slice(1).forEach(s => {
      logger.info(`   Ignored ${s.source} (older by ${(newest.data.timestamp - s.data.timestamp) / 1000}s)`);
    });
  }

  return newest.data.data;
}

/**
 * Sync pending changes to cloud
 */
export async function syncPendingChanges(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  logger.info(`🔄 Syncing ${syncQueue.length} pending changes...`);

  // Process sync queue
  while (syncQueue.length > 0) {
    const item = syncQueue.shift();
    if (!item) continue;

    try {
      const success = await syncToCloud(item.key, item.data);
      if (success) {
        synced++;
        // Update localStorage with synced status
        const updated = { ...item.data, synced: true };
        localStorage.setItem(item.key, JSON.stringify(updated));
      } else {
        failed++;
        // Put back in queue
        syncQueue.push(item);
      }
    } catch (error: any) {
      failed++;
      errors.push(`${item.key}: ${error.message}`);
      // Put back in queue for retry
      syncQueue.push(item);
    }
  }

  if (synced > 0) {
    logger.info(`✅ Synced ${synced} changes to cloud`);
  }
  if (failed > 0) {
    logger.warn(`⚠️ Failed to sync ${failed} changes`);
  }

  return { synced, failed, errors };
}

/**
 * Check sync status
 */
export function getSyncStatus(): SyncStatus {
  let lastSync: Date | null = null;
  const conflictsDetected = 0;

  // Check localStorage for last sync timestamp
  try {
    const lastSyncStr = localStorage.getItem('__last_sync__');
    if (lastSyncStr) {
      lastSync = new Date(parseInt(lastSyncStr));
    }
  } catch (error) {
    logger.error('Failed to get sync status:', error);
  }

  return {
    lastSync,
    pendingChanges: syncQueue.length,
    conflictsDetected,
    isSyncing: false,
  };
}

/**
 * Force sync all data
 */
export async function forceSyncAll(): Promise<void> {
  logger.info('🔄 Starting full sync...');
  
  // Sync pending changes
  await syncPendingChanges();
  
  // Update last sync timestamp
  localStorage.setItem('__last_sync__', Date.now().toString());
  
  logger.info('✅ Full sync completed');
}

/**
 * Clear all cached data (nuclear option)
 */
export async function clearAllCache(): Promise<void> {
  logger.info('🗑️ Clearing all cached data...');
  
  // Clear localStorage
  const keysToKeep = ['auth-storage', 'supabase.auth.token'];
  const allKeys = Object.keys(localStorage);
  allKeys.forEach(key => {
    if (!keysToKeep.includes(key)) {
      localStorage.removeItem(key);
    }
  });
  
  // Clear service worker caches
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
  }
  
  // Clear sync queue
  syncQueue.length = 0;
  
  logger.info('✅ All cache cleared');
}

// Placeholder functions for cloud operations (implement based on your backend)
async function syncToCloud<T>(_key: string, _data: DataWithTimestamp<T>): Promise<boolean> {
  // TODO: Implement actual cloud sync with Supabase
  // For now, just simulate success
  return new Promise((resolve) => {
    setTimeout(() => {
      // Simulate 80% success rate
      resolve(Math.random() > 0.2);
    }, 100);
  });
}

async function loadFromCloud<T>(_key: string): Promise<DataWithTimestamp<T> | null> {
  // TODO: Implement actual cloud load from Supabase
  return null;
}

// Auto-sync on network reconnection
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    logger.info('🌐 Network reconnected, syncing...');
    syncPendingChanges();
  });
  
  window.addEventListener('offline', () => {
    logger.info('📴 Network disconnected, queuing changes');
  });
}
