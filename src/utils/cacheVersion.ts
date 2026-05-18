import { logger } from './logger';

/**
 * Cache Version Management Utility
 * Handles version checking, cache busting, and update notifications
 */

export interface AppVersion {
  version: string;
  buildTimestamp: number;
  cacheName: string;
}

const VERSION_KEY = '__app_version__';
const CURRENT_VERSION = '1.0.0'; // This should be updated by build process

/**
 * Get current app version from service worker
 */
export async function getCurrentVersion(): Promise<AppVersion | null> {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) {
      return null;
    }

    // Ask service worker for version info
    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();
      
      messageChannel.port1.onmessage = (event) => {
        if (event.data) {
          resolve({
            version: event.data.version || CURRENT_VERSION,
            buildTimestamp: event.data.timestamp || Date.now(),
            cacheName: event.data.cacheName || 'unknown',
          });
        } else {
          resolve(null);
        }
      };

      if (registration.active) {
        registration.active.postMessage(
          { type: 'CHECK_VERSION' },
          [messageChannel.port2]
        );
      } else {
        resolve(null);
      }

      // Timeout after 2 seconds
      setTimeout(() => resolve(null), 2000);
    });
  } catch (error) {
    logger.error('Failed to get version:', error);
    return null;
  }
}

/**
 * Get stored version from last session
 */
export function getStoredVersion(): AppVersion | null {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logger.error('Failed to get stored version:', error);
  }
  return null;
}

/**
 * Save current version to localStorage
 */
export function saveVersion(version: AppVersion): void {
  try {
    localStorage.setItem(VERSION_KEY, JSON.stringify(version));
  } catch (error) {
    logger.error('Failed to save version:', error);
  }
}

/**
 * Check if app has been updated since last session
 */
export async function checkForUpdates(): Promise<{
  hasUpdate: boolean;
  currentVersion?: AppVersion;
  previousVersion?: AppVersion;
}> {
  const current = await getCurrentVersion();
  const stored = getStoredVersion();

  if (!current) {
    return { hasUpdate: false };
  }

  if (!stored) {
    // First time running, save version
    saveVersion(current);
    return { hasUpdate: false, currentVersion: current };
  }

  // Compare versions
  const hasUpdate = current.buildTimestamp > stored.buildTimestamp;

  if (hasUpdate) {
    logger.info('🔄 Update detected!');
    logger.info(`   Previous: v${stored.version} (${new Date(stored.buildTimestamp).toLocaleString()})`);
    logger.info(`   Current:  v${current.version} (${new Date(current.buildTimestamp).toLocaleString()})`);
    
    // Update stored version
    saveVersion(current);
  }

  return {
    hasUpdate,
    currentVersion: current,
    previousVersion: stored,
  };
}

/**
 * Force clear all caches and reload
 */
export async function clearCacheAndReload(): Promise<void> {
  logger.info('🗑️ Clearing cache and reloading...');

  // Clear service worker caches
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => {
      logger.info(`Deleting cache: ${name}`);
      return caches.delete(name);
    }));
  }

  // Clear localStorage (except auth)
  const keysToKeep = ['auth-storage', 'supabase.auth.token'];
  Object.keys(localStorage).forEach(key => {
    if (!keysToKeep.includes(key)) {
      localStorage.removeItem(key);
    }
  });

  // Clear sessionStorage
  sessionStorage.clear();

  // Unregister service worker
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(reg => reg.unregister()));
  }

  // Hard reload (bypass cache)
  window.location.reload();
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  cacheNames: string[];
  totalSize: number;
  itemCount: number;
}> {
  if (!('caches' in window)) {
    return { cacheNames: [], totalSize: 0, itemCount: 0 };
  }

  const cacheNames = await caches.keys();
  let totalSize = 0;
  let itemCount = 0;

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    itemCount += keys.length;

    // Estimate size (rough calculation)
    for (const request of keys) {
      try {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      } catch (error) {
        // Skip if can't read
      }
    }
  }

  logger.info(`📊 Cache Stats:`);
  logger.info(`   Caches: ${cacheNames.length}`);
  logger.info(`   Items: ${itemCount}`);
  logger.info(`   Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

  return { cacheNames, totalSize, itemCount };
}

/**
 * Check if cache is stale (older than threshold)
 */
export function isCacheStale(threshold: number = 86400000): boolean {
  const stored = getStoredVersion();
  if (!stored) {
    return false;
  }

  const age = Date.now() - stored.buildTimestamp;
  return age > threshold;
}

/**
 * Format version info for display
 */
export function formatVersion(version: AppVersion): string {
  const date = new Date(version.buildTimestamp);
  return `v${version.version} (${date.toLocaleDateString()} ${date.toLocaleTimeString()})`;
}

/**
 * Show cache debug info in console
 */
export async function debugCache(): Promise<void> {
  console.group('🔍 Cache Debug Info');
  
  const current = await getCurrentVersion();
  const stored = getStoredVersion();
  const stats = await getCacheStats();
  const isStale = isCacheStale();

  logger.info('Current Version:', current ? formatVersion(current) : 'Unknown');
  logger.info('Stored Version:', stored ? formatVersion(stored) : 'None');
  logger.info('Cache Stale:', isStale);
  logger.info('Cache Names:', stats.cacheNames);
  logger.info('Cache Items:', stats.itemCount);
  logger.info('Cache Size:', (stats.totalSize / 1024 / 1024).toFixed(2), 'MB');
  
  // Check storage quota
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentage = quota > 0 ? (usage / quota) * 100 : 0;
    
    logger.info('Storage Used:', (usage / 1024 / 1024).toFixed(2), 'MB');
    logger.info('Storage Quota:', (quota / 1024 / 1024).toFixed(2), 'MB');
    logger.info('Storage %:', percentage.toFixed(2) + '%');
  }
  
  console.groupEnd();
}

// Expose debug function globally in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).debugCache = debugCache;
  (window as any).clearCache = clearCacheAndReload;
  logger.info('💡 Cache debug tools available: window.debugCache(), window.clearCache()');
}
