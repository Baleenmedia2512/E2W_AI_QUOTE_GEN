import { useEffect } from 'react';
import { useAppStore } from '../store';
import { useAuthStore } from '../store/authStore';

/**
 * Hook to initialize company database sync
 * Call this in your App.tsx or main component
 * 
 * This will:
 * 1. Load company info from database on app start
 * 2. Keep localStorage as fallback if database fails
 * 3. Enable real-time sync (optional)
 */
export const useCompanySync = (enableRealtime: boolean = false) => {
  const syncCompanyFromDatabase = useAppStore((state) => state.syncCompanyFromDatabase);
  const enableCompanySync = useAppStore((state) => state.enableCompanySync);
  const clearCompanyInfo = useAppStore((state) => state.clearCompanyInfo);
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    // Never retain a previous user's company while auth is changing or logged out.
    clearCompanyInfo();
    if (!userId) return;

    // Initial sync from database
    console.log('🔄 Initializing company database sync...');
    syncCompanyFromDatabase();

    // Enable real-time updates if requested
    let subscription: any = null;
    if (enableRealtime) {
      console.log('📡 Enabling real-time company sync...');
      subscription = enableCompanySync();
    }

    // Cleanup subscription on unmount
    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [syncCompanyFromDatabase, enableCompanySync, clearCompanyInfo, enableRealtime, userId]);
};
