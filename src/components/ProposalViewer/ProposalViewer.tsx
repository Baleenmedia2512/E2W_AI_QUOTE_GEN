import React, { useState } from 'react';
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
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Center,
  Heading,
  useColorModeValue,
  Wrap,
} from '@chakra-ui/react';
import {
  FiChevronLeft,
  FiChevronRight,
  FiZoomIn,
  FiZoomOut,
} from 'react-icons/fi';
import { Document, Page, pdfjs } from 'react-pdf';
import { useAppStore } from '../../store';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const ProposalViewer: React.FC = () => {
  const { proposal, setProposal } = useAppStore();
  const [scale, setScale] = useState(1.0);
  const [_numPages, setNumPages] = useState<number>(0);

  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const bgColor = useColorModeValue('white', 'gray.700');

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
      <Center h="400px" p={8}>
        <VStack spacing={3}>
          <Heading size="md" color="gray.400">No proposal uploaded</Heading>
          <Text color="gray.500">Please upload a PDF file to view it here</Text>
        </VStack>
      </Center>
    );
  }

  return (
    <Card variant="outline" borderRadius="xl" boxShadow="sm">
      <CardHeader>
        <Flex justify="space-between" align="center" flexWrap="wrap" gap={2}>
          <Heading size="md" fontWeight="semibold">{proposal.fileName}</Heading>
          
          {/* Controls */}
          <HStack spacing={2} flexWrap="wrap">
            {/* Navigation */}
            <HStack spacing={1}>
              <IconButton
                aria-label="Previous page"
                icon={<FiChevronLeft />}
                onClick={goToPrevPage}
                isDisabled={proposal.currentPage === 1}
                size="sm"
              />
              <Text fontSize="sm" whiteSpace="nowrap" px={2}>
                {proposal.currentPage} / {proposal.pageCount}
              </Text>
              <IconButton
                aria-label="Next page"
                icon={<FiChevronRight />}
                onClick={goToNextPage}
                isDisabled={proposal.currentPage === proposal.pageCount}
                size="sm"
              />
            </HStack>

            {/* Zoom */}
            <HStack spacing={1}>
              <IconButton
                aria-label="Zoom out"
                icon={<FiZoomOut />}
                onClick={handleZoomOut}
                size="sm"
              />
              <Text fontSize="sm" minW="50px" textAlign="center">
                {Math.round(scale * 100)}%
              </Text>
              <IconButton
                aria-label="Zoom in"
                icon={<FiZoomIn />}
                onClick={handleZoomIn}
                size="sm"
              />
            </HStack>
          </HStack>
        </Flex>
      </CardHeader>

      <CardBody>
        <VStack spacing={4} align="stretch">
          {/* PDF Viewer */}
          <Box
            borderWidth={1}
            borderColor={borderColor}
            borderRadius="lg"
            overflow="auto"
            maxH="600px"
            bg={bgColor}
          >
            <Center p={4}>
              <Document
                file={proposal.fileUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={
                  <Center p={8}>
                    <Text>Loading PDF...</Text>
                  </Center>
                }
              >
                <Page
                  pageNumber={proposal.currentPage}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              </Document>
            </Center>
          </Box>

          {/* Page Slider */}
          <Box px={4}>
            <Slider
              min={1}
              max={proposal.pageCount}
              value={proposal.currentPage}
              onChange={(value) => setProposal({ currentPage: value })}
              step={1}
            >
              <SliderTrack>
                <SliderFilledTrack bg="brand.500" />
              </SliderTrack>
              <SliderThumb boxSize={4} />
            </Slider>
          </Box>

          {/* Thumbnails */}
          {proposal.pageCount > 1 && (
            <Box>
              <Text fontSize="sm" fontWeight="medium" mb={2}>Quick Navigation</Text>
              <Wrap spacing={3}>
                {Array.from({ length: Math.min(proposal.pageCount, 10) }, (_, i) => i + 1).map((pageNum) => (
                  <Box
                    key={pageNum}
                    cursor="pointer"
                    onClick={() => setProposal({ currentPage: pageNum })}
                    borderWidth={2}
                    borderColor={pageNum === proposal.currentPage ? 'brand.500' : borderColor}
                    borderRadius="md"
                    overflow="hidden"
                    transition="all 0.2s"
                    _hover={{
                      borderColor: 'brand.500',
                      transform: 'translateY(-2px)',
                      boxShadow: 'md',
                    }}
                  >
                    <Box w="100px" h="130px" position="relative">
                      <Document file={proposal.fileUrl}>
                        <Page 
                          pageNumber={pageNum} 
                          width={100} 
                          renderTextLayer={false} 
                          renderAnnotationLayer={false} 
                        />
                      </Document>
                      <Center
                        position="absolute"
                        bottom={0}
                        left={0}
                        right={0}
                        bg="blackAlpha.700"
                        color="white"
                        py={1}
                      >
                        <Text fontSize="xs" fontWeight="bold">{pageNum}</Text>
                      </Center>
                    </Box>
                  </Box>
                ))}
                {proposal.pageCount > 10 && (
                  <Center minW="100px">
                    <Text fontSize="sm" color="gray.500">
                      +{proposal.pageCount - 10} more
                    </Text>
                  </Center>
                )}
              </Wrap>
            </Box>
          )}
        </VStack>
      </CardBody>
    </Card>
  );
};

export default ProposalViewer;
