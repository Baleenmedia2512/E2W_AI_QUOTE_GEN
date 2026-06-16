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
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FiChevronLeft, FiChevronRight, FiZoomIn, FiZoomOut, FiFile } from 'react-icons/fi';
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
        borderRadius="20px"
        boxShadow="0 8px 24px rgba(0, 0, 0, 0.08)"
        border="none"
        h={{ base: 'auto', lg: 'calc(100vh - 120px)' }}
        bgGradient="linear(180deg, #fff5f7 0%, #ffffff 100%)"
      >
        <Center h={{ base: '300px', md: 'full' }} p={{ base: 4, md: 8 }}>
          <VStack spacing={4}>
            <Box
              w="80px"
              h="80px"
              borderRadius="20px"
              bgGradient="linear(135deg, #C91F3D, #B31B3E)"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="0 8px 20px rgba(201, 31, 61, 0.3)"
            >
              <Icon as={FiFile} boxSize={10} color="white" />
            </Box>
            <Heading
              size="md"
              bgGradient="linear(135deg, #C91F3D, #B31B3E)"
              bgClip="text"
              fontWeight="800"
            >
              No proposal uploaded
            </Heading>
            <Text color="gray.500" textAlign="center" fontSize="sm">
              Please upload a file to view it here
            </Text>
          </VStack>
        </Center>
      </Card>
    );
  }

  return (
    <Card
      variant="outline"
      borderRadius="20px"
      boxShadow="0 8px 24px rgba(0, 0, 0, 0.08)"
      border="none"
      h={{ base: 'auto', lg: 'calc(100vh - 120px)' }}
      minH={{ base: '500px', lg: 'auto' }}
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      {/* PDF Viewer Header */}
      <CardHeader
        bgGradient="linear(135deg, #C91F3D 0%, #B31B3E 50%, #7A1030 100%)"
        pb={5}
        pt={5}
        px={{ base: 4, md: 6 }}
        position="relative"
        _before={{
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          bgGradient: 'linear(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
          animation: 'shimmer 3s infinite',
          '@keyframes shimmer': {
            '0%': { transform: 'translateX(-100%)' },
            '100%': { transform: 'translateX(100%)' },
          },
        }}
      >
        <Flex
          justify="space-between"
          align="center"
          flexWrap="wrap"
          gap={{ base: 2, md: 4 }}
          position="relative"
          zIndex={1}
        >
          {/* Filename */}
          <Heading
            size={{ base: 'sm', md: 'md' }}
            fontWeight="700"
            color="white"
            noOfLines={1}
            letterSpacing="tight"
          >
            {proposal.fileName}
          </Heading>

          {/* Pagination and Zoom/Sheet Controls */}
          <HStack spacing={{ base: 3, md: 6 }} flexWrap="wrap">
            {/* Pagination - Show for PDF and multi-sheet Excel */}
            {(fileType === 'pdf' || (fileType === 'excel' && proposal.pageCount > 1)) && (
              <HStack
                spacing={2}
                bg="whiteAlpha.200"
                px={3}
                py={1.5}
                borderRadius="full"
                backdropFilter="blur(10px)"
              >
                <IconButton
                  aria-label="Previous page"
                  icon={<Icon as={FiChevronLeft} />}
                  onClick={goToPrevPage}
                  isDisabled={proposal.currentPage === 1}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.300' }}
                  _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                />
                <Text fontSize="sm" fontWeight="700" color="white" minW="80px" textAlign="center">
                  {proposal.currentPage} / {proposal.pageCount}
                </Text>
                <IconButton
                  aria-label="Next page"
                  icon={<Icon as={FiChevronRight} />}
                  onClick={goToNextPage}
                  isDisabled={proposal.currentPage === proposal.pageCount}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.300' }}
                  _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                />
              </HStack>
            )}

            {/* Zoom Controls - Show for PDF and Images only */}
            {(fileType === 'pdf' || fileType === 'image') && (
              <HStack
                spacing={2}
                bg="whiteAlpha.200"
                px={3}
                py={1.5}
                borderRadius="full"
                backdropFilter="blur(10px)"
              >
                <IconButton
                  aria-label="Zoom out"
                  icon={<Icon as={FiZoomOut} />}
                  onClick={handleZoomOut}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.300' }}
                />
                <Text fontSize="sm" fontWeight="700" color="white" minW="50px" textAlign="center">
                  {Math.round(scale * 100)}%
                </Text>
                <IconButton
                  aria-label="Zoom in"
                  icon={<Icon as={FiZoomIn} />}
                  onClick={handleZoomIn}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.300' }}
                />
              </HStack>
            )}
          </HStack>
        </Flex>
      </CardHeader>

      {/* File Display Area */}
      <CardBody flex={1} overflow="auto" p={0} display="flex" flexDirection="column">
        <Box flex={1} overflow="auto" bg={bgColor} position="relative">
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
                    <Center
                      p={8}
                      minW={{ base: '300px', md: '600px' }}
                      minH={{ base: '400px', md: '800px' }}
                    >
                      <VStack spacing={3}>
                        <Text color="gray.500">Loading PDF...</Text>
                      </VStack>
                    </Center>
                  }
                  error={
                    <Center
                      p={8}
                      minW={{ base: '300px', md: '600px' }}
                      minH={{ base: '400px', md: '800px' }}
                    >
                      <VStack spacing={3}>
                        <Text color="red.500">Failed to load PDF</Text>
                        <Text color="gray.500" fontSize="sm">
                          Please try uploading again
                        </Text>
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
            borderTop="2px solid"
            borderColor="red.100"
            bgGradient="linear(180deg, #fff5f7 0%, #ffffff 100%)"
            p={{ base: 3, md: 4 }}
          >
            <Text
              fontSize="sm"
              fontWeight="800"
              bgGradient="linear(135deg, #C91F3D, #B31B3E)"
              bgClip="text"
              mb={3}
              textTransform="uppercase"
              letterSpacing="wider"
            >
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
                  background: '#FFE4E6',
                  borderRadius: '10px',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: 'linear-gradient(135deg, #C91F3D, #B31B3E)',
                  borderRadius: '10px',
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  background: 'linear-gradient(135deg, #B31B3E, #7A1030)',
                },
              }}
            >
              {Array.from(
                { length: showAllPages ? proposal.pageCount : Math.min(proposal.pageCount, 10) },
                (_, i) => i + 1,
              ).map((pageNum) => (
                <Box
                  key={pageNum}
                  cursor="pointer"
                  onClick={() => setProposal({ currentPage: pageNum })}
                  borderWidth={3}
                  borderColor={pageNum === proposal.currentPage ? '#C91F3D' : 'gray.200'}
                  borderRadius="12px"
                  overflow="hidden"
                  transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                  flexShrink={0}
                  boxShadow={
                    pageNum === proposal.currentPage
                      ? '0 8px 20px rgba(201, 31, 61, 0.3)'
                      : '0 2px 8px rgba(0, 0, 0, 0.06)'
                  }
                  bg={pageNum === proposal.currentPage ? 'red.50' : 'white'}
                  _hover={{
                    borderColor: '#C91F3D',
                    transform: 'translateY(-4px) scale(1.05)',
                    boxShadow: '0 12px 24px rgba(201, 31, 61, 0.25)',
                  }}
                >
                  <Box
                    w={{ base: '60px', md: '80px' }}
                    h={{ base: '80px', md: '106px' }}
                    position="relative"
                    bg="white"
                  >
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
                      bgGradient="linear(135deg, #C91F3D, #B31B3E)"
                      color="white"
                      py={1}
                    >
                      <Text fontSize="xs" fontWeight="700">
                        {pageNum}
                      </Text>
                    </Center>
                  </Box>
                </Box>
              ))}
              {proposal.pageCount > 10 && (
                <Center
                  minW={{ base: '60px', md: '80px' }}
                  h={{ base: '80px', md: '106px' }}
                  bgGradient="linear(135deg, #fff5f7 0%, #ffe4e6 100%)"
                  borderRadius="12px"
                  border="3px dashed"
                  borderColor="red.300"
                  flexShrink={0}
                  cursor="pointer"
                  onClick={() => setShowAllPages(!showAllPages)}
                  _hover={{
                    bgGradient: 'linear(135deg, #ffe4e6 0%, #fecdd3 100%)',
                    borderColor: '#C91F3D',
                    transform: 'translateY(-4px) scale(1.05)',
                  }}
                  transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                >
                  <Text
                    fontSize="sm"
                    bgGradient="linear(135deg, #C91F3D, #B31B3E)"
                    bgClip="text"
                    fontWeight="700"
                    textAlign="center"
                    px={1}
                  >
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
