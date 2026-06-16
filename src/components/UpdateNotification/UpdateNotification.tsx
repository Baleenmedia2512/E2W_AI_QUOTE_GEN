/**
 * Update Notification Component
 * Shows user-friendly notifications for app updates, sync status, and cache management
 */

import { Box, Button, Text, useToast, VStack, HStack, Icon, Progress } from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
import { FiRefreshCw, FiDownload, FiAlertCircle } from 'react-icons/fi';

import { getSyncStatus, syncPendingChanges } from '../../services/dataSyncService';
import {
  checkForUpdates,
  clearCacheAndReload,
  formatVersion,
  AppVersion,
} from '../../utils/cacheVersion';

export const UpdateNotification: React.FC = () => {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<AppVersion | null>(null);
  const [syncStatus, setSyncStatus] = useState({ pendingChanges: 0, isSyncing: false });
  const toast = useToast();

  useEffect(() => {
    // Check for updates on mount
    checkForUpdates().then((result) => {
      if (result.hasUpdate && result.currentVersion) {
        setHasUpdate(true);
        setCurrentVersion(result.currentVersion);

        // Show toast notification
        toast({
          title: '🔄 Update Available',
          description: 'A new version is available. Click to update.',
          status: 'info',
          duration: null, // Don't auto-dismiss
          isClosable: true,
          position: 'top-right',
        });
      }
    });

    // Check sync status periodically
    const syncInterval = setInterval(() => {
      const status = getSyncStatus();
      setSyncStatus({
        pendingChanges: status.pendingChanges,
        isSyncing: status.isSyncing,
      });
    }, 5000);

    return () => clearInterval(syncInterval);
  }, [toast]);

  const handleUpdate = async () => {
    toast({
      title: '⏳ Updating...',
      description: 'Please wait while we update the app.',
      status: 'loading',
      duration: 2000,
      position: 'top-right',
    });

    // Give user time to see the message
    setTimeout(() => {
      clearCacheAndReload();
    }, 500);
  };

  const handleSync = async () => {
    setSyncStatus((prev) => ({ ...prev, isSyncing: true }));

    try {
      const result = await syncPendingChanges();

      if (result.synced > 0) {
        toast({
          title: '✅ Synced',
          description: `Successfully synced ${result.synced} changes to cloud.`,
          status: 'success',
          duration: 3000,
          position: 'bottom-right',
        });
      }

      if (result.failed > 0) {
        toast({
          title: '⚠️ Partial Sync',
          description: `${result.failed} changes failed to sync. Will retry later.`,
          status: 'warning',
          duration: 5000,
          position: 'bottom-right',
        });
      }
    } catch (error) {
      toast({
        title: '❌ Sync Failed',
        description: 'Could not sync changes. Check your connection.',
        status: 'error',
        duration: 5000,
        position: 'bottom-right',
      });
    } finally {
      setSyncStatus((prev) => ({ ...prev, isSyncing: false }));
    }
  };

  // Don't render anything if no updates or pending changes
  if (!hasUpdate && syncStatus.pendingChanges === 0) {
    return null;
  }

  return (
    <>
      {/* Update Banner */}
      {hasUpdate && (
        <Box
          position="fixed"
          top="70px"
          right="20px"
          bg="purple.500"
          color="white"
          p={4}
          borderRadius="lg"
          boxShadow="xl"
          zIndex={9999}
          maxW="400px"
        >
          <VStack align="stretch" spacing={3}>
            <HStack>
              <Icon as={FiDownload} boxSize={6} />
              <VStack align="start" spacing={0} flex={1}>
                <Text fontWeight="bold" fontSize="md">
                  New Version Available!
                </Text>
                <Text fontSize="sm" opacity={0.9}>
                  {currentVersion && formatVersion(currentVersion)}
                </Text>
              </VStack>
            </HStack>

            <HStack spacing={2}>
              <Button
                size="sm"
                colorScheme="whiteAlpha"
                leftIcon={<FiRefreshCw />}
                onClick={handleUpdate}
                flex={1}
              >
                Update Now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setHasUpdate(false)}>
                Later
              </Button>
            </HStack>
          </VStack>
        </Box>
      )}

      {/* Sync Status Indicator */}
      {syncStatus.pendingChanges > 0 && (
        <Box
          position="fixed"
          bottom="80px"
          right="20px"
          bg="orange.500"
          color="white"
          p={3}
          borderRadius="lg"
          boxShadow="lg"
          zIndex={9998}
          maxW="300px"
        >
          <HStack>
            <Icon
              as={syncStatus.isSyncing ? FiRefreshCw : FiAlertCircle}
              boxSize={5}
              className={syncStatus.isSyncing ? 'spin' : ''}
            />
            <VStack align="start" spacing={0} flex={1}>
              <Text fontSize="sm" fontWeight="medium">
                {syncStatus.pendingChanges} changes pending
              </Text>
              {syncStatus.isSyncing ? (
                <Progress size="xs" isIndeterminate colorScheme="whiteAlpha" w="100%" mt={1} />
              ) : (
                <Text fontSize="xs" opacity={0.9}>
                  Will sync when online
                </Text>
              )}
            </VStack>
            {!syncStatus.isSyncing && (
              <Button size="xs" colorScheme="whiteAlpha" onClick={handleSync}>
                Sync
              </Button>
            )}
          </HStack>
        </Box>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 2s linear infinite;
        }
      `}</style>
    </>
  );
};

export default UpdateNotification;
