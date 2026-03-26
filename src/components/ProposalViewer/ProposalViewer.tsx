import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardBody,
  IconButton,
  HStack,
  Text,
  VStack,
  Flex,
  Center,
  Heading,
  Icon,
  useColorModeValue,
  useBreakpointValue,
  Image,
} from '@chakra-ui/react';
import {
  FiChevronLeft,
  FiChevronRight,
  FiZoomIn,
  FiZoomOut,
} from 'react-icons/fi';
import { Document, Page, pdfjs } from 'react-pdf';
import { useAppStore } from '../../store';
import { detectFileType } from '../../utils/fileUtils';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const ProposalViewer: React.FC = () => {
  const { proposal, setProposal } = useAppStore();
  const [scale, setScale] = useState(1.0);
  const [_numPages, setNumPages] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const bgColor = useColorModeValue('white', 'gray.700');
  const isMobile = useBreakpointValue({ base: true, md: false });
  const [showAllPages, setShowAllPages] = useState(false);

  // Detect file type from the uploaded file
  const fileType = proposal.file ? detectFileType(proposal.file) : 'pdf';

  const measureContainer = useCallback(() => {
    if (pdfContainerRef.current) {
      const width = pdfContainerRef.current.clientWidth;
      setContainerWidth(width);
    }
  }, []);

  useEffect(() => {
    measureContainer();
    window.addEventListener('resize', measureContainer);
    return () => window.removeEventListener('resize', measureContainer);
  }, [measureContainer]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setProposal({ pageCount: numPages });
  };

  const goToPrevPage = () => {
    if (proposal.currentPage > 1) {
      setProposal({ currentPage: proposal.currentPage - 1 });
    }
  };

  const goToNextPage = () => {
    if (proposal.currentPage < proposal.pageCount) {
      setProposal({ currentPage: proposal.currentPage + 1 });
    }
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 3.0));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

  if (!proposal.fileUrl) {
    return (
      <Card
        variant="outline"
        borderRadius="xl"
        boxShadow="sm"
        h={{ base: 'auto', lg: 'calc(100vh - 120px)' }}
      >
        <Center h={{ base: '300px', md: 'full' }} p={{ base: 4, md: 8 }}>
          <VStack spacing={3}>
            <Heading size="md" color="gray.400">No proposal uploaded</Heading>
            <Text color="gray.500">Please upload a file to view it here</Text>
          </VStack>
        </Center>
      </Card>
    );
  }

  return (
    <Card
      variant="outline"
      borderRadius="xl"
      boxShadow="sm"
      h={{ base: 'auto', lg: 'calc(100vh - 120px)' }}
      minH={{ base: '500px', lg: 'auto' }}
      display="flex"
      flexDirection="column"
    >
      {/* PDF Viewer Header */}
      <CardHeader borderBottom="1px solid" borderColor="gray.200" pb={4} px={{ base: 3, md: 6 }}>
        <Flex justify="space-between" align="center" flexWrap="wrap" gap={{ base: 2, md: 4 }}>
          {/* Filename */}
          <Heading size={{ base: 'sm', md: 'md' }} fontWeight="600" color="gray.900" noOfLines={1}>
            {proposal.fileName}
          </Heading>
          
          {/* Pagination and Zoom/Sheet Controls */}
          <HStack spacing={{ base: 3, md: 6 }} flexWrap="wrap">
            {/* Pagination - Show for PDF and multi-sheet Excel */}
            {(fileType === 'pdf' || (fileType === 'excel' && proposal.pageCount > 1)) && (
              <HStack spacing={2}>
                <IconButton
                  aria-label="Previous page"
                  icon={<Icon as={FiChevronLeft} />}
                  onClick={goToPrevPage}
                  isDisabled={proposal.currentPage === 1}
                  size="sm"
                  variant="ghost"
                  color="gray.600"
                />
                <Text fontSize="sm" fontWeight="500" color="gray.700" minW="80px" textAlign="center">
                  {proposal.currentPage} / {proposal.pageCount}
                </Text>
                <IconButton
                  aria-label="Next page"
                  icon={<Icon as={FiChevronRight} />}
                  onClick={goToNextPage}
                  isDisabled={proposal.currentPage === proposal.pageCount}
                  size="sm"
                  variant="ghost"
                  color="gray.600"
                />
              </HStack>
            )}

            {/* Zoom Controls - Show for PDF and Images only */}
            {(fileType === 'pdf' || fileType === 'image') && (
              <HStack spacing={2}>
                <IconButton
                  aria-label="Zoom out"
                  icon={<Icon as={FiZoomOut} />}
                  onClick={handleZoomOut}
                  size="sm"
                  variant="ghost"
                  color="gray.600"
                />
                <Text fontSize="sm" fontWeight="500" color="gray.700" minW="50px" textAlign="center">
                  {Math.round(scale * 100)}%
                </Text>
                <IconButton
                  aria-label="Zoom in"
                  icon={<Icon as={FiZoomIn} />}
                  onClick={handleZoomIn}
                  size="sm"
                  variant="ghost"
                  color="gray.600"
                />
              </HStack>
            )}
          </HStack>
        </Flex>
      </CardHeader>

      {/* File Display Area */}
      <CardBody
        flex={1}
        overflow="auto"
        p={0}
        display="flex"
        flexDirection="column"
      >
        <Box
          flex={1}
          overflow="auto"
          bg={bgColor}
          position="relative"
        >
          {/* Render based on file type */}
          {fileType === 'pdf' && (
            /* PDF Document */
            <Center p={{ base: 1, md: 6 }}>
              <Box
                ref={pdfContainerRef}
                borderWidth={1}
                borderColor={borderColor}
                borderRadius="lg"
                overflow="hidden"
                boxShadow="lg"
                maxW="100%"
                w="100%"
              >
                <Document
                  file={proposal.fileUrl}
                  onLoadSuccess={onDocumentLoadSuccess}
                  loading={
                    <Center p={8} minW={{ base: '300px', md: '600px' }} minH={{ base: '400px', md: '800px' }}>
                      <VStack spacing={3}>
                        <Text color="gray.500">Loading PDF...</Text>
                      </VStack>
                    </Center>
                  }
                  error={
                    <Center p={8} minW={{ base: '300px', md: '600px' }} minH={{ base: '400px', md: '800px' }}>
                      <VStack spacing={3}>
                        <Text color="red.500">Failed to load PDF</Text>
                        <Text color="gray.500" fontSize="sm">Please try uploading again</Text>
                      </VStack>
                    </Center>
                  }
                >
                  <Page
                    pageNumber={proposal.currentPage}
                    scale={isMobile ? undefined : scale}
                    width={isMobile && containerWidth > 0 ? containerWidth - 2 : undefined}
                    renderTextLayer={!isMobile}
                    renderAnnotationLayer={!isMobile}
                  />
                </Document>
              </Box>
            </Center>
          )}

          {fileType === 'image' && (
            /* JPEG Image */
            <Center p={{ base: 1, md: 6 }}>
              <Box
                borderWidth={1}
                borderColor={borderColor}
                borderRadius="lg"
                overflow="hidden"
                boxShadow="lg"
                maxW="100%"
              >
                <Image
                  src={proposal.fileUrl}
                  alt={proposal.fileName}
                  maxW="100%"
                  h="auto"
                  transform={`scale(${scale})`}
                  transformOrigin="top center"
                  transition="transform 0.2s"
                />
              </Box>
            </Center>
          )}

          {fileType === 'excel' && (
            /* Excel Data */
            <Box p={{ base: 2, md: 6 }} overflow="auto">
              <Box
                borderWidth={1}
                borderColor={borderColor}
                borderRadius="lg"
                bg="white"
                p={{ base: 3, md: 6 }}
                boxShadow="lg"
              >
                <VStack align="stretch" spacing={4}>
                  <Heading size="sm" color="gray.700">
                    Excel Data Preview
                  </Heading>
                  <Box
                    fontSize="sm"
                    fontFamily="monospace"
                    whiteSpace="pre-wrap"
                    color="gray.800"
                    maxH="600px"
                    overflow="auto"
                    bg="gray.50"
                    p={4}
                    borderRadius="md"
                    borderWidth={1}
                    borderColor="gray.200"
                  >
                    {proposal.textContent}
                  </Box>
                  <Text fontSize="xs" color="gray.500">
                    {proposal.pageCount} sheet(s) • Text extracted for AI processing
                  </Text>
                </VStack>
              </Box>
            </Box>
          )}
        </Box>

        {/* Quick Navigation Strip - Only for PDF */}
        {fileType === 'pdf' && proposal.pageCount > 1 && (
          <Box
            borderTop="1px solid"
            borderColor="gray.200"
            bg="gray.50"
            p={{ base: 3, md: 4 }}
          >
            <Text fontSize="sm" fontWeight="600" color="gray.700" mb={3}>
              Quick Navigation
            </Text>
            <HStack
              spacing={3}
              overflowX="auto"
              pb={2}
              css={{
                '&::-webkit-scrollbar': {
                  height: '8px',
                },
                '&::-webkit-scrollbar-track': {
                  background: '#EDF2F7',
                  borderRadius: '10px',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: '#CBD5E0',
                  borderRadius: '10px',
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  background: '#A0AEC0',
                },
              }}
            >
              {Array.from({ length: showAllPages ? proposal.pageCount : Math.min(proposal.pageCount, 10) }, (_, i) => i + 1).map((pageNum) => (
                <Box
                  key={pageNum}
                  cursor="pointer"
                  onClick={() => setProposal({ currentPage: pageNum })}
                  borderWidth={2}
                  borderColor={pageNum === proposal.currentPage ? '#750926' : borderColor}
                  borderRadius="md"
                  overflow="hidden"
                  transition="all 0.2s"
                  flexShrink={0}
                  boxShadow={pageNum === proposal.currentPage ? 'md' : 'sm'}
                  _hover={{
                    borderColor: '#750926',
                    transform: 'translateY(-2px)',
                    boxShadow: 'md',
                  }}
                >
                  <Box w={{ base: '60px', md: '80px' }} h={{ base: '80px', md: '106px' }} position="relative" bg="white">
                    <Document file={proposal.fileUrl}>
                      <Page 
                        pageNumber={pageNum} 
                        width={isMobile ? 60 : 80} 
                        renderTextLayer={false} 
                        renderAnnotationLayer={false} 
                      />
                    </Document>
                    <Center
                      position="absolute"
                      bottom={0}
                      left={0}
                      right={0}
                      bg="blackAlpha.800"
                      color="white"
                      py={0.5}
                    >
                      <Text fontSize="xs" fontWeight="600">{pageNum}</Text>
                    </Center>
                  </Box>
                </Box>
              ))}
              {proposal.pageCount > 10 && (
                <Center
                  minW={{ base: '60px', md: '80px' }}
                  h={{ base: '80px', md: '106px' }}
                  bg="gray.100"
                  borderRadius="md"
                  border="2px dashed"
                  borderColor="gray.300"
                  flexShrink={0}
                  cursor="pointer"
                  onClick={() => setShowAllPages(!showAllPages)}
                  _hover={{
                    bg: 'gray.200',
                    borderColor: '#750926',
                  }}
                  transition="all 0.2s"
                >
                  <Text fontSize="sm" color="gray.600" fontWeight="500" textAlign="center" px={1}>
                    {showAllPages ? 'Show less' : `+${proposal.pageCount - 10} more`}
                  </Text>
                </Center>
              )}
            </HStack>
          </Box>
        )}
      </CardBody>
    </Card>
  );
};

export default ProposalViewer;
