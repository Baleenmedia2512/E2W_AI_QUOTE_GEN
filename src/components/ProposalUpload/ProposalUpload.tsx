import React, { useRef, useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Center,
  Heading,
  Text,
  VStack,
  HStack,
  Icon,
  useToast,
  Spinner,
  useColorModeValue,
  Divider,
  Badge,
  IconButton,
  Collapse,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from '@chakra-ui/react';
import { FiUploadCloud, FiFile, FiClock, FiTrash2, FiChevronDown, FiChevronUp, FiFileText, FiImage, FiAlertTriangle } from 'react-icons/fi';
import { useAppStore } from '../../store';
import { extractPDFContent, validatePDFFile } from '../../utils/pdfUtils';
import { 
  extractImageContent, 
  extractExcelContent, 
  validateImageFile, 
  validateExcelFile,
  detectFileType 
} from '../../utils/fileUtils';
import { findDuplicateProposal } from '../../utils/proposalStorage';
import { findCloudDuplicate, cloudProposalToStored } from '../../services/supabaseProposalService';


const ProposalUpload: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [processingFileType, setProcessingFileType] = useState<string>('file');
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const { proposal, setProposal, recentProposals, loadRecentProposals, selectProposal, deleteProposalFromLibrary, activeProposals, addActiveProposal, removeActiveProposal } = useAppStore();

  // Load recent proposals on mount and check cloud storage availability
  
  // Duplicate detection state
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<{ fileName: string; uploadedAt: Date } | null>(null);

  const toast = useToast();

  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const dragBorderColor = useColorModeValue('brand.500', 'brand.300');
  const bgColor = useColorModeValue('gray.50', 'gray.700');
  
  // All useColorModeValue calls must be at top level (not conditional)
  const dragBg = useColorModeValue('brand.50', 'brand.900');
  const dragHoverBg = useColorModeValue('brand.50', 'brand.900');
  const headerBgOpen = useColorModeValue('linear-gradient(135deg, #f6f8fb 0%, #ffffff 100%)', 'gray.800');
  const headerBgClosed = useColorModeValue('transparent', 'transparent');
  const headerHoverBg = useColorModeValue('gray.50', 'gray.800');
  const cardBg = useColorModeValue('white', 'gray.800');
  const cardHoverBg = useColorModeValue('brand.50', 'gray.750');
  const cardBorderColor = useColorModeValue('gray.200', 'gray.700');
  const fileTypeBarGradient = useColorModeValue('linear(to-b, brand.400, brand.600)', 'linear(to-b, brand.300, brand.500)');
  const fileIconBg = useColorModeValue('linear(135deg, brand.50, brand.100)', 'linear(135deg, brand.900, brand.800)');
  const textColor = useColorModeValue('gray.800', 'gray.100');
  const metaTextColor = useColorModeValue('gray.600', 'gray.400');
  const cloudBadgeBg = useColorModeValue('blue.50', 'blue.900');
  const cloudBadgeColor = useColorModeValue('blue.600', 'blue.300');
  const deleteHoverBg = useColorModeValue('red.50', 'red.900');
  const modalOverlayBg = 'blackAlpha.700';
  const modalIconBg = useColorModeValue('orange.100', 'orange.900');
  const modalBoxBg = useColorModeValue('gray.50', 'gray.700');
  const modalTextColor = useColorModeValue('gray.700', 'gray.300');
  const modalNoteBg = useColorModeValue('blue.50', 'blue.900');
  const modalNoteColor = useColorModeValue('blue.800', 'blue.200');
  const dividerColor = useColorModeValue('gray.300', 'gray.600');

  // Load recent proposals on mount and check cloud storage availability
  useEffect(() => {
    const initializeStorage = async () => {
      // Check if cloud storage is available (Supabase)
      const { checkCloudStorage } = useAppStore.getState();
      await checkCloudStorage();
      
      // Load proposals from both local and cloud
      await loadRecentProposals();
    };
    
    initializeStorage();
  }, [loadRecentProposals]);

  // Check for duplicates before processing (CLOUD-ONLY when available, fallback to local)
  const processFile = async (file: File) => {
    // Show loading immediately so user sees feedback right away
    setLoading(true);
    let duplicate: any = null;
    const { cloudStorageEnabled } = useAppStore.getState();
    
    try {
      // If cloud storage is enabled, check ONLY cloud (skip local)
      if (cloudStorageEnabled) {
        try {
          const cloudDuplicate = await findCloudDuplicate(file.name, file.size);
          if (cloudDuplicate) {
            duplicate = cloudProposalToStored(cloudDuplicate);
            console.log('☁️ Duplicate found in cloud storage:', duplicate.fileName);
          }
        } catch (error) {
          console.warn('⚠️ Cloud duplicate check failed:', error);
        }
      } else {
        // Fallback to local IndexedDB check if cloud is not available
        try {
          duplicate = await findDuplicateProposal(file.name, file.type || 'application/pdf', file.size);
          if (duplicate) {
            console.log('💾 Duplicate found in local storage:', duplicate.fileName);
          }
        } catch (error) {
          console.warn('⚠️ Local duplicate check failed:', error);
        }
      }
      
      if (duplicate) {
        // Duplicate found - hide spinner and show confirmation dialog
        setLoading(false);
        setPendingFile(file);
        setDuplicateInfo({
          fileName: duplicate.fileName,
          uploadedAt: duplicate.uploadedAt,
        });
        onOpen(); // Open confirmation modal
        return;
      }
      
      // No duplicate - proceed with upload (actualProcessFile manages its own loading state)
      setLoading(false);
      await actualProcessFile(file);
    } catch (err: any) {
      setLoading(false);
      toast({
        title: 'Upload Error',
        description: err.message || 'Something went wrong. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      console.error('processFile error:', err);
    }
  };

  // Handle user's choice from confirmation dialog (CLOUD-ONLY when available)
  const handleReplaceConfirm = async () => {
    onClose();
    setLoading(true);
    if (!pendingFile) {
      setLoading(false);
      return;
    }
    try {
      let duplicate: any = null;
      const { cloudStorageEnabled } = useAppStore.getState();
      
      // If cloud is enabled, find and delete from cloud only
      if (cloudStorageEnabled) {
        try {
          const cloudDuplicate = await findCloudDuplicate(
            pendingFile.name,
            pendingFile.size
          );
          if (cloudDuplicate) {
            duplicate = cloudProposalToStored(cloudDuplicate);
          }
        } catch (error) {
          console.warn('⚠️ Cloud duplicate check failed during replacement:', error);
        }
      } else {
        // Fallback to local if cloud not available
        duplicate = await findDuplicateProposal(
          pendingFile.name,
          pendingFile.type || 'application/pdf',
          pendingFile.size
        );
      }
      
      if (duplicate) {
        await deleteProposalFromLibrary(duplicate.id);
      }
      
      // Process the new file (actualProcessFile manages its own loading state via finally)
      setPendingFile(null);
      setDuplicateInfo(null);
      await actualProcessFile(pendingFile);
    } catch (err: any) {
      setLoading(false);
      toast({
        title: 'Replace Error',
        description: err.message || 'Something went wrong. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      console.error('handleReplaceConfirm error:', err);
    }
  };

  const handleCancelUpload = () => {
    onClose();
    setPendingFile(null);
    setDuplicateInfo(null);
    
    toast({
      title: 'Upload Cancelled',
      description: 'Using existing file from library',
      status: 'info',
      duration: 2000,
      isClosable: true,
    });
  };

  // Actual file processing logic (RENAMED from processFile)
  const actualProcessFile = async (file: File) => {
    // Detect file type
    const fileType = detectFileType(file);
    setProcessingFileType(fileType);
    
    // Validate file based on type
    let validation: { valid: boolean; error?: string };
    
    if (fileType === 'pdf') {
      validation = validatePDFFile(file);
    } else if (fileType === 'image') {
      validation = validateImageFile(file);
    } else if (fileType === 'excel') {
      validation = validateExcelFile(file);
    } else {
      validation = { valid: false, error: 'Unsupported file type. Please upload PDF, JPEG, or Excel files only.' };
    }
    
    if (!validation.valid) {
      setLoading(false);
      toast({
        title: 'Error',
        description: validation.error || 'Invalid file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Note: setLoading(true) was already called by processFile/handleReplaceConfirm
    // We just ensure loading stays true during extraction
    setLoading(true);

    try {
      let textContent: string;
      let pageCount: number;
      let images: string[];
      let pageImages: any[];
      let successMessage: string;

      // Extract content based on file type
      if (fileType === 'pdf') {
        console.log('Processing PDF file:', file.name);
        const pdfResult = await extractPDFContent(file);
        textContent = pdfResult.textContent;
        pageCount = pdfResult.pageCount;
        images = pdfResult.images;
        pageImages = pdfResult.pageImages;
        successMessage = 'PDF uploaded successfully!';
        
        console.log('PDF extraction successful:', {
          fileName: file.name,
          pageCount,
          textLength: textContent.length,
          hasText: textContent.length > 0
        });
      } else if (fileType === 'image') {
        console.log('Processing JPEG image:', file.name);
        const imageResult = await extractImageContent(file);
        textContent = imageResult.textContent;
        pageCount = imageResult.pageCount;
        images = imageResult.images;
        pageImages = imageResult.pageImages;
        successMessage = 'Image uploaded and text extracted successfully!';
        
        console.log('Image extraction successful:', {
          fileName: file.name,
          textLength: textContent.length,
          hasText: textContent.length > 0
        });
      } else if (fileType === 'excel') {
        console.log('Processing Excel file:', file.name);
        const excelResult = await extractExcelContent(file);
        textContent = excelResult.textContent;
        pageCount = excelResult.pageCount;
        images = excelResult.images;
        pageImages = excelResult.pageImages;
        successMessage = `Excel file uploaded! ${pageCount} sheet(s) extracted.`;
        
        console.log('Excel extraction successful:', {
          fileName: file.name,
          sheetCount: pageCount,
          textLength: textContent.length,
          hasText: textContent.length > 0
        });
      } else {
        throw new Error('Unsupported file type');
      }

      // Create object URL for viewing
      const fileUrl = URL.createObjectURL(file);

      // Update store with extracted data
      const proposalData = {
        file,
        fileName: file.name,
        fileUrl,
        textContent,
        pageCount,
        currentPage: 1,
        extractedImages: images,
        pageImages: pageImages,
        uploadedAt: new Date(),
      };
      
      console.log('Updating proposal store with:', proposalData);
      setProposal(proposalData);

      // ⚡ AUTO-LOAD: Wait for proposal to be saved, then add to activeProposals
      // This ensures reference images show immediately after upload
      const autoLoadProposal = async () => {
        let attempts = 0;
        const maxAttempts = 10;
        const pollInterval = 500; // ms

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          await loadRecentProposals(); // Refresh to get the new proposal with ID
          
          const state = useAppStore.getState();
          const newProposal = state.recentProposals.find(p => p.fileName === file.name);
          
          if (newProposal && newProposal.id) {
            console.log('🎯 Auto-loading uploaded proposal to activeProposals:', newProposal.fileName);
            await addActiveProposal(newProposal.id);
            return; // Success - exit
          }
          
          attempts++;
        }
        
        console.warn('⚠️ Auto-load timeout: proposal not found in recentProposals after 5 seconds');
      };
      
      autoLoadProposal(); // Run async without blocking

      toast({
        title: 'Success',
        description: successMessage,
        status: 'success',
        duration: 2000,
        isClosable: true,
      });
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to process file. Please try again.';
      toast({
        title: 'Error',
        description: errorMessage,
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      console.error('File processing error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Process multiple files sequentially (batch mode skips duplicates silently)
  const processBatchFiles = async (files: File[]) => {
    if (files.length === 0) return;

    console.log(`📂 [BATCH] Starting upload of ${files.length} file(s):`, files.map(f => f.name));

    if (files.length === 1) {
      // Single file — use normal flow (shows duplicate modal)
      await processFile(files[0]);
      return;
    }

    // Multiple files — process one by one, skip duplicates silently
    setBatchProgress({ current: 0, total: files.length });
    let skipped = 0;
    let processed = 0;

    for (let i = 0; i < files.length; i++) {
      setBatchProgress({ current: i + 1, total: files.length });
      const file = files[i];
      console.log(`📄 [BATCH ${i + 1}/${files.length}] Processing: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      // Silent duplicate check
      let isDuplicate = false;
      const { cloudStorageEnabled } = useAppStore.getState();

      try {
        if (cloudStorageEnabled) {
          const cloudDuplicate = await findCloudDuplicate(file.name, file.size);
          if (cloudDuplicate) isDuplicate = true;
        } else {
          const localDuplicate = await findDuplicateProposal(file.name, file.type || 'application/pdf', file.size);
          if (localDuplicate) isDuplicate = true;
        }
      } catch {
        // ignore duplicate check errors in batch
      }

      if (isDuplicate) {
        console.warn(`⚠️ [BATCH ${i + 1}/${files.length}] SKIPPED (duplicate): ${file.name}`);
        skipped++;
        continue;
      }

      try {
        await actualProcessFile(file);
        console.log(`✅ [BATCH ${i + 1}/${files.length}] UPLOADED successfully: ${file.name}`);
        processed++;
      } catch (err) {
        console.error(`❌ [BATCH ${i + 1}/${files.length}] FAILED: ${file.name}`, err);
      }
    }

    setBatchProgress(null);
    console.log(`📊 [BATCH] Done — ${processed} uploaded, ${skipped} skipped (duplicates), ${files.length - processed - skipped} failed`);

    toast({
      title: skipped === files.length ? 'All Duplicates' : 'Upload Complete',
      description: skipped === 0
        ? `${processed} file(s) uploaded successfully.`
        : `${processed} file(s) uploaded. ${skipped} duplicate(s) skipped.`,
      status: skipped === files.length ? 'warning' : 'success',
      duration: 3000,
      isClosable: true,
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    // Capture files as array BEFORE resetting input (resetting clears the live FileList)
    const fileArray = Array.from(files);
    // Reset input so the same files can be re-selected if needed
    event.target.value = '';
    try {
      await processBatchFiles(fileArray);
    } catch (err: any) {
      setLoading(false);
      setBatchProgress(null);
      toast({
        title: 'Upload Error',
        description: err.message || 'Something went wrong. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      console.error('handleFileSelect error:', err);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      await processBatchFiles(Array.from(files));
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleLoadProposal = async (id: string) => {
    const alreadyLoaded = activeProposals.find(p => p.id === id);
    if (alreadyLoaded) {
      // Toggle: unload if already loaded
      removeActiveProposal(id);
      toast({
        title: 'Unloaded',
        description: `${alreadyLoaded.fileName} removed from active PDFs`,
        status: 'info',
        duration: 2000,
        isClosable: true,
      });
      return;
    }
    setLoading(true);
    try {
      await addActiveProposal(id);
      toast({
        title: 'Loaded ✓',
        description: 'PDF added to active proposals',
        status: 'success',
        duration: 2000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load proposal',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProposal = async (id: string, fileName: string) => {
    try {
      await deleteProposalFromLibrary(id);
      toast({
        title: 'Deleted',
        description: `${fileName} removed from library`,
        status: 'info',
        duration: 2000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete proposal',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return new Date(date).toLocaleDateString();
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) return FiFileText;
    if (fileType.includes('image') || fileType.includes('jpeg')) return FiImage;
    return FiFile;
  };

  return (
    <>
    <Card variant="outline" borderRadius="xl" boxShadow="sm">
      <CardHeader>
        <Heading size="md" fontWeight="semibold">Upload Proposal</Heading>
      </CardHeader>
      <CardBody>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.xlsx,.xls"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {!proposal.file ? (
          <Center
            p={8}
            borderWidth={2}
            borderStyle="dashed"
            borderColor={isDragging ? dragBorderColor : borderColor}
            borderRadius="lg"
            bg={isDragging ? dragBg : bgColor}
            cursor="pointer"
            transition="all 0.2s"
            onClick={handleUploadClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            _hover={{
              borderColor: dragBorderColor,
              bg: dragHoverBg,
            }}
          >
            <VStack spacing={3}>
              <Icon as={FiUploadCloud} boxSize={12} color="brand.500" />
              <VStack spacing={1}>
                <Heading size="sm" fontWeight="medium">Click to upload files</Heading>
                <Text fontSize="sm" color="gray.500">or drag and drop (select multiple)</Text>
                <Text fontSize="xs" color="gray.400">PDF, JPEG, or Excel files (max 10MB each)</Text>
              </VStack>
            </VStack>
          </Center>
        ) : (
          <Box
            p={4}
            borderWidth={1}
            borderColor={borderColor}
            borderRadius="lg"
            bg={bgColor}
          >
            <HStack spacing={3} justify="space-between" flexWrap="wrap">
              <HStack spacing={3} flex={1} minW={0}>
                <Icon as={FiFile} boxSize={6} color="brand.500" flexShrink={0} />
                <VStack align="start" spacing={0} flex={1} minW={0}>
                  <Text fontWeight="medium" fontSize="sm" noOfLines={1} wordBreak="break-all">
                    {proposal.fileName}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    {proposal.pageCount} pages
                  </Text>
                </VStack>
              </HStack>
              <Button
                size="sm"
                variant="outline"
                onClick={handleUploadClick}
                flexShrink={0}
              >
                Change
              </Button>
            </HStack>
          </Box>
        )}

        {loading && (
          <Center mt={4}>
            <HStack spacing={3}>
              <Spinner size="sm" color="brand.500" />
              <Text fontSize="sm" color="gray.600">
                {batchProgress && batchProgress.total > 1
                  ? `Processing file ${batchProgress.current} of ${batchProgress.total}...`
                  : !processingFileType
                  ? 'Checking file...'
                  : `Processing ${processingFileType === 'pdf' ? 'PDF' : processingFileType === 'image' ? 'image' : processingFileType === 'excel' ? 'Excel file' : 'file'}...`
                }
              </Text>
            </HStack>
          </Center>
        )}

        {/* Recent Uploads Section - Enhanced UI */}
        {recentProposals.length > 0 && (
          <Box mt={6}>
            <Divider mb={4} borderColor={dividerColor} />
            
            {/* Enhanced Header */}
            <Box
              position="relative"
              cursor="pointer"
              onClick={() => setShowRecent(!showRecent)}
              p={3}
              borderRadius="lg"
              bg={showRecent ? headerBgOpen : headerBgClosed}
              _hover={{
                bg: headerHoverBg,
              }}
              transition="all 0.3s ease"
            >
              <HStack justify="space-between">
                <HStack spacing={3}>
                  {/* Clock Icon with Background */}
                  <Center
                    w={8}
                    h={8}
                    borderRadius="lg"
                    bg={dragBg}
                    color="brand.500"
                  >
                    <Icon as={FiClock} boxSize={4} />
                  </Center>
                  
                  <VStack align="start" spacing={0}>
                    <HStack spacing={2}>
                      <Text fontSize="sm" fontWeight="bold" color={textColor}>
                        Recent Uploads
                      </Text>
                      <Badge 
                        colorScheme="brand" 
                        fontSize="xs" 
                        borderRadius="full"
                        px={2}
                        py={0.5}
                        fontWeight="600"
                      >
                        {recentProposals.length}
                      </Badge>
                      {activeProposals.length > 0 && (
                        <Badge
                          colorScheme="green"
                          fontSize="xs"
                          borderRadius="full"
                          px={2}
                          py={0.5}
                          fontWeight="600"
                        >
                          {activeProposals.length}/{recentProposals.filter(p => p.fileType === 'application/pdf').length} loaded
                        </Badge>
                      )}
                    </HStack>
                    <Text fontSize="xs" color="gray.500" fontWeight="normal">
                      {showRecent ? 'Click to hide' : 'Click to view saved files'}
                    </Text>
                  </VStack>
                </HStack>
                
                {/* Toggle Button with Animation */}
                <Center
                  w={8}
                  h={8}
                  borderRadius="md"
                  bg={cardBg}
                  borderWidth={1}
                  borderColor={cardBorderColor}
                  transition="all 0.2s"
                  _hover={{
                    borderColor: 'brand.400',
                    transform: 'scale(1.05)',
                  }}
                >
                  <Icon 
                    as={showRecent ? FiChevronUp : FiChevronDown} 
                    boxSize={4}
                    color="brand.500"
                    transition="transform 0.2s"
                  />
                </Center>
              </HStack>
            </Box>

            {/* Enhanced Proposal Cards */}
            <Collapse in={showRecent} animateOpacity>
              <VStack spacing={3} align="stretch" mt={3}>
                {recentProposals.map((storedProposal) => (
                  <Box
                    key={storedProposal.id}
                    position="relative"
                    p={4}
                    borderWidth={1}
                    borderColor={cardBorderColor}
                    borderRadius="xl"
                    bg={cardBg}
                    boxShadow="sm"
                    _hover={{ 
                      borderColor: 'brand.400',
                      boxShadow: 'lg',
                      transform: 'translateY(-2px)',
                      bg: cardHoverBg
                    }}
                    transition="all 0.3s ease"
                  >
                    {/* File Type Indicator Bar */}
                    <Box
                      position="absolute"
                      left={0}
                      top={0}
                      bottom={0}
                      w="4px"
                      borderLeftRadius="xl"
                      bgGradient={fileTypeBarGradient}
                    />
                    
                    <HStack spacing={4} align="start">
                      {/* File Icon with Enhanced Styling */}
                      <Center
                        w={12}
                        h={12}
                        borderRadius="lg"
                        bgGradient={fileIconBg}
                        flexShrink={0}
                        position="relative"
                        boxShadow="sm"
                      >
                        <Icon
                          as={getFileIcon(storedProposal.fileType)}
                          boxSize={6}
                          color="brand.500"
                        />
                      </Center>
                      
                      {/* File Details */}
                      <VStack align="start" spacing={1} flex={1} minW={0}>
                        <Text
                          fontSize="sm"
                          fontWeight="600"
                          noOfLines={1}
                          wordBreak="break-all"
                          color={textColor}
                        >
                          {storedProposal.fileName}
                        </Text>
                        
                        {/* Meta Information with Icons */}
                        <HStack 
                          spacing={3} 
                          fontSize="xs" 
                          color={metaTextColor}
                          flexWrap="wrap"
                        >
                          <HStack spacing={1}>
                            <Text fontWeight="500">{storedProposal.pageCount}</Text>
                            <Text>pages</Text>
                          </HStack>
                          <Text color="gray.300">•</Text>
                          <Text fontWeight="500">{formatFileSize(storedProposal.fileSize)}</Text>
                          <Text color="gray.300">•</Text>
                          <HStack spacing={1}>
                            <Icon as={FiClock} boxSize={3} />
                            <Text>{formatRelativeTime(storedProposal.uploadedAt)}</Text>
                          </HStack>
                          
                          {/* Cloud Storage Indicator - Show uploaded by info */}
                          {storedProposal.isCloudStored && (
                            <>
                              <Text color="gray.300">•</Text>
                              <HStack 
                                spacing={1}
                                px={2}
                                py={0.5}
                                borderRadius="md"
                                bg={cloudBadgeBg}
                                color={cloudBadgeColor}
                              >
                                <Text fontSize="xs" fontWeight="500">
                                  ☁️ {storedProposal.uploadedByName || 'Shared'}
                                </Text>
                              </HStack>
                            </>
                          )}
                        </HStack>
                      </VStack>
                      
                      {/* Action Buttons - Enhanced */}
                      <VStack spacing={2} flexShrink={0}>
                        {(() => {
                          const isLoaded = activeProposals.some(p => p.id === storedProposal.id);
                          return (
                            <Button
                              size="sm"
                              colorScheme={isLoaded ? 'green' : 'brand'}
                              onClick={() => handleLoadProposal(storedProposal.id)}
                              isDisabled={loading}
                              leftIcon={<Icon as={FiUploadCloud} />}
                              borderRadius="lg"
                              fontWeight="600"
                              px={4}
                              boxShadow="sm"
                              _hover={{
                                transform: 'scale(1.05)',
                                boxShadow: 'md',
                              }}
                              transition="all 0.2s"
                            >
                              {isLoaded ? 'Loaded ✓' : 'Load'}
                            </Button>
                          );
                        })()}
                        <IconButton
                          aria-label="Delete proposal"
                          icon={<Icon as={FiTrash2} boxSize={4} />}
                          size="sm"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => handleDeleteProposal(storedProposal.id, storedProposal.fileName)}
                          isDisabled={loading}
                          borderRadius="lg"
                          _hover={{
                            bg: deleteHoverBg,
                            transform: 'scale(1.1)',
                          }}
                          transition="all 0.2s"
                        />
                      </VStack>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            </Collapse>
          </Box>
        )}
      </CardBody>
    </Card>

    {/* Duplicate Confirmation Modal */}
    <Modal isOpen={isOpen} onClose={handleCancelUpload} isCentered>
      <ModalOverlay bg={modalOverlayBg} backdropFilter="blur(4px)" />
      <ModalContent mx={4} borderRadius="xl">
        <ModalHeader pb={2}>
          <HStack spacing={3}>
            <Center
              w={10}
              h={10}
              borderRadius="lg"
              bg={modalIconBg}
            >
              <Icon as={FiAlertTriangle} boxSize={5} color="orange.500" />
            </Center>
            <VStack align="start" spacing={0}>
              <Text fontSize="lg" fontWeight="bold">
                File Already Exists
              </Text>
              <Text fontSize="sm" fontWeight="normal" color="gray.500">
                This file is already in your library
              </Text>
            </VStack>
          </HStack>
        </ModalHeader>

        <ModalBody py={4}>
          <VStack align="start" spacing={3}>
            <Box
              p={3}
              bg={modalBoxBg}
              borderRadius="lg"
              w="full"
            >
              <VStack align="start" spacing={1}>
                <HStack spacing={2}>
                  <Icon as={FiFile} boxSize={4} color="brand.500" />
                  <Text fontSize="sm" fontWeight="600" noOfLines={1}>
                    {duplicateInfo?.fileName}
                  </Text>
                </HStack>
                <Text fontSize="xs" color="gray.500" pl={6}>
                  Uploaded {duplicateInfo?.uploadedAt ? formatRelativeTime(duplicateInfo.uploadedAt) : ''}
                </Text>
              </VStack>
            </Box>

            <Text fontSize="sm" color={modalTextColor}>
              Do you want to replace the existing file with the new one?
            </Text>

            <Box
              p={3}
              bg={modalNoteBg}
              borderRadius="lg"
              borderLeftWidth={3}
              borderColor="blue.500"
            >
              <Text fontSize="xs" color={modalNoteColor}>
                <strong>Note:</strong> Replacing will delete the old file and upload the new version.
              </Text>
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter pt={2}>
          <HStack spacing={3} w="full">
            <Button
              flex={1}
              variant="outline"
              onClick={handleCancelUpload}
              borderRadius="lg"
            >
              Cancel
            </Button>
            <Button
              flex={1}
              colorScheme="brand"
              onClick={handleReplaceConfirm}
              borderRadius="lg"
              fontWeight="600"
            >
              Yes, Replace
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  </>
  );
};

export default ProposalUpload;
