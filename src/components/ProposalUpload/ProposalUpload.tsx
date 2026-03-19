import React, { useRef, useState } from 'react';
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
} from '@chakra-ui/react';
import { FiUploadCloud, FiFile } from 'react-icons/fi';
import { useAppStore } from '../../store';
import { extractPDFContent, validatePDFFile } from '../../utils/pdfUtils';


const ProposalUpload: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { proposal, setProposal } = useAppStore();
  const toast = useToast();

  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const dragBorderColor = useColorModeValue('brand.500', 'brand.300');
  const bgColor = useColorModeValue('gray.50', 'gray.700');

  const processFile = async (file: File) => {
    // Validate file
    const validation = validatePDFFile(file);
    if (!validation.valid) {
      toast({
        title: 'Error',
        description: validation.error || 'Invalid file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setLoading(true);

    try {
      console.log('Processing PDF file:', file.name);
      // Extract PDF content
      const { textContent, pageCount, images, pageImages } = await extractPDFContent(file);

      console.log('PDF extraction successful:', {
        fileName: file.name,
        pageCount,
        textLength: textContent.length,
        hasText: textContent.length > 0
      });

      // Create object URL for PDF viewing
      const fileUrl = URL.createObjectURL(file);

      // Update store
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

      toast({
        title: 'Success',
        description: 'PDF uploaded successfully!',
        status: 'success',
        duration: 2000,
        isClosable: true,
      });
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to process PDF file. Please try again.';
      toast({
        title: 'Error',
        description: errorMessage,
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      console.error('PDF processing error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processFile(file);
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
      const file = files[0];
      await processFile(file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Card variant="outline" borderRadius="xl" boxShadow="sm">
      <CardHeader>
        <Heading size="md" fontWeight="semibold">Upload Proposal</Heading>
      </CardHeader>
      <CardBody>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
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
            bg={isDragging ? useColorModeValue('brand.50', 'brand.900') : bgColor}
            cursor="pointer"
            transition="all 0.2s"
            onClick={handleUploadClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            _hover={{
              borderColor: dragBorderColor,
              bg: useColorModeValue('brand.50', 'brand.900'),
            }}
          >
            <VStack spacing={3}>
              <Icon as={FiUploadCloud} boxSize={12} color="brand.500" />
              <VStack spacing={1}>
                <Heading size="sm" fontWeight="medium">Click to upload PDF</Heading>
                <Text fontSize="sm" color="gray.500">or drag and drop</Text>
                <Text fontSize="xs" color="gray.400">PDF files only (max 10MB)</Text>
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
              <Text fontSize="sm" color="gray.600">Processing PDF...</Text>
            </HStack>
          </Center>
        )}
      </CardBody>
    </Card>
  );
};

export default ProposalUpload;
