import React, { useRef, useState } from 'react';
import {
  Box,
  Button,
  HStack,
  Progress,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react';
import { FiUploadCloud } from 'react-icons/fi';
import { validateExcelFile } from '../../utils/fileUtils';
import { importVendorExcelFile, VendorImportProgress } from '../../services/vendorRateChunkService';
import { useAuthStore } from '../../store/authStore';

interface VendorUploadProps {
  onImported?: () => void;
}

const VendorUpload: React.FC<VendorUploadProps> = ({ onImported }) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuthStore();
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<VendorImportProgress | null>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    const validation = validateExcelFile(file);
    if (!validation.valid) {
      toast({
        title: 'Invalid file',
        description: validation.error,
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
      return;
    }

    setIsUploading(true);
    setProgress({
      phase: 'parsing',
      current: 0,
      total: 0,
      message: 'Starting import...',
    });

    try {
      const result = await importVendorExcelFile(file, user?.id, setProgress);

      toast({
        title: 'Vendor rates imported',
        description: `${result.imported} rates from ${result.vendorCount} vendors${
          result.skipped > 0 ? ` (${result.skipped} rows skipped)` : ''
        }.`,
        status: 'success',
        duration: 5000,
        isClosable: true,
      });

      if (result.errors.length > 0) {
        console.warn('Vendor import warnings:', result.errors);
      }

      onImported?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to import vendor Excel.';
      toast({
        title: 'Import failed',
        description: message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsUploading(false);
      setProgress(null);
    }
  };

  return (
    <Box
      bg="white"
      borderRadius="16px"
      p={5}
      boxShadow="0 2px 8px rgba(0, 0, 0, 0.08)"
      border="1px solid"
      borderColor="gray.100"
    >
      <VStack align="stretch" spacing={4}>
        <Box>
          <Text fontWeight="700" fontSize="lg" color="gray.800">
            Upload Vendor Excel
          </Text>
          <Text fontSize="sm" color="gray.600" mt={1}>
            Import vendor rate rows into vendor master storage. Quotes still use proposal PDF data only.
          </Text>
        </Box>

        <Box
          border="2px dashed"
          borderColor={isUploading ? 'brand.300' : 'gray.200'}
          borderRadius="14px"
          p={6}
          textAlign="center"
          bg={isUploading ? 'brand.50' : 'gray.50'}
        >
          <VStack spacing={3}>
            <FiUploadCloud size={28} color="#750926" />
            <Text fontSize="sm" color="gray.600">
              Drop your vendor master sheet here or browse
            </Text>
            <Button
              colorScheme="brand"
              leftIcon={<FiUploadCloud />}
              onClick={() => fileInputRef.current?.click()}
              isLoading={isUploading}
              loadingText="Importing..."
            >
              Select Excel File
            </Button>
            <Text fontSize="xs" color="gray.500">
              .xlsx or .xls only
            </Text>
          </VStack>
        </Box>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {progress && (
          <Box>
            <HStack justify="space-between" mb={2}>
              <Text fontSize="sm" color="gray.700">
                {progress.message}
              </Text>
              {progress.total > 0 && (
                <Text fontSize="sm" color="gray.500">
                  {progress.current}/{progress.total}
                </Text>
              )}
            </HStack>
            {progress.total > 0 && (
              <Progress
                value={(progress.current / progress.total) * 100}
                size="sm"
                colorScheme="brand"
                borderRadius="full"
              />
            )}
          </Box>
        )}
      </VStack>
    </Box>
  );
};

export default VendorUpload;
