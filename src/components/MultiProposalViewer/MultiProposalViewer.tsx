import {
  Box,
  HStack,
  VStack,
  Text,
  IconButton,
  Icon,
  Center,
  Flex,
  Badge,
  useColorModeValue,
} from '@chakra-ui/react';
import React, { useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiX, FiFileText, FiLayers } from 'react-icons/fi';

import { useAppStore } from '../../store';
import { ActiveProposal } from '../../types';

interface SingleViewerProps {
  proposal: ActiveProposal;
  onRemove: () => void;
}

const SingleViewer: React.FC<SingleViewerProps> = ({ proposal, onRemove }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const headerBg = useColorModeValue('white', 'gray.800');
  const pageBg = useColorModeValue('gray.50', 'gray.900');

  const totalPages = proposal.pageImages?.length || 0;
  const currentImage = totalPages > 0 ? proposal.pageImages[currentPage]?.imageDataUrl : null;

  return (
    <Box
      flex="1"
      minW={{ base: '280px', md: '320px' }}
      maxW={{ base: '100%', md: '480px' }}
      borderWidth={1}
      borderColor={borderColor}
      borderRadius="xl"
      overflow="hidden"
      boxShadow="md"
      display="flex"
      flexDirection="column"
    >
      {/* Header */}
      <HStack
        px={3}
        py={2}
        bg={headerBg}
        borderBottomWidth={1}
        borderColor={borderColor}
        justify="space-between"
        flexShrink={0}
      >
        <HStack spacing={2} flex={1} minW={0}>
          <Icon as={FiFileText} boxSize={4} color="brand.500" flexShrink={0} />
          <Text fontSize="xs" fontWeight="600" noOfLines={1} flex={1}>
            {proposal.fileName}
          </Text>
        </HStack>
        <HStack spacing={1}>
          <Badge colorScheme="green" fontSize="xs" borderRadius="full">
            Active
          </Badge>
          <IconButton
            aria-label="Remove proposal"
            icon={<Icon as={FiX} boxSize={3} />}
            size="xs"
            variant="ghost"
            colorScheme="red"
            onClick={onRemove}
            borderRadius="md"
          />
        </HStack>
      </HStack>

      {/* Page Image */}
      <Box flex="1" bg={pageBg} overflow="hidden" minH="300px" position="relative">
        {currentImage ? (
          <Box
            as="img"
            src={currentImage}
            alt={`Page ${currentPage + 1}`}
            w="100%"
            h="100%"
            objectFit="contain"
            display="block"
          />
        ) : proposal.fileUrl ? (
          // Fallback: show in iframe for non-PDF types or if no page images
          <Box
            as="iframe"
            src={proposal.fileUrl}
            w="100%"
            h="100%"
            border="none"
            title={proposal.fileName}
          />
        ) : (
          <Center h="100%">
            <VStack spacing={2}>
              <Icon as={FiFileText} boxSize={8} color="gray.300" />
              <Text fontSize="sm" color="gray.400">
                No preview available
              </Text>
            </VStack>
          </Center>
        )}
      </Box>

      {/* Page Navigation */}
      {totalPages > 1 && (
        <HStack
          px={3}
          py={2}
          bg={headerBg}
          borderTopWidth={1}
          borderColor={borderColor}
          justify="space-between"
          flexShrink={0}
        >
          <IconButton
            aria-label="Previous page"
            icon={<Icon as={FiChevronLeft} boxSize={4} />}
            size="xs"
            variant="ghost"
            isDisabled={currentPage === 0}
            onClick={() => setCurrentPage((p) => p - 1)}
          />
          <Text fontSize="xs" color="gray.500" fontWeight="500">
            {currentPage + 1} / {totalPages}
          </Text>
          <IconButton
            aria-label="Next page"
            icon={<Icon as={FiChevronRight} boxSize={4} />}
            size="xs"
            variant="ghost"
            isDisabled={currentPage >= totalPages - 1}
            onClick={() => setCurrentPage((p) => p + 1)}
          />
        </HStack>
      )}
    </Box>
  );
};

const MultiProposalViewer: React.FC = () => {
  const { activeProposals, removeActiveProposal } = useAppStore();
  const emptyBg = useColorModeValue('gray.50', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.600');

  if (activeProposals.length === 0) {
    return (
      <Box
        borderWidth={1}
        borderColor={borderColor}
        borderRadius="xl"
        bg={emptyBg}
        minH="400px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <VStack spacing={3}>
          <Icon as={FiLayers} boxSize={10} color="gray.300" />
          <Text fontSize="sm" color="gray.400" fontWeight="500">
            No proposals loaded
          </Text>
          <Text fontSize="xs" color="gray.400" textAlign="center" maxW="200px">
            Click "Load" on proposals below to view them here
          </Text>
        </VStack>
      </Box>
    );
  }

  return (
    <VStack spacing={3} align="stretch">
      {/* Active banner */}
      <HStack
        px={3}
        py={2}
        bg="green.50"
        borderRadius="lg"
        borderWidth={1}
        borderColor="green.200"
        spacing={2}
        flexWrap="wrap"
      >
        <Icon as={FiLayers} boxSize={4} color="green.600" flexShrink={0} />
        <Text fontSize="xs" fontWeight="600" color="green.700">
          {activeProposals.length} proposal{activeProposals.length > 1 ? 's' : ''} active
        </Text>
        <Text fontSize="xs" color="green.600">
          — AI will use {activeProposals.length > 1 ? 'all of these' : 'this'} for quote generation
        </Text>
      </HStack>

      {/* Viewers side by side */}
      <Flex gap={3} overflowX="auto" pb={2} flexWrap={{ base: 'nowrap', xl: 'wrap' }}>
        {activeProposals.map((ap) => (
          <SingleViewer key={ap.id} proposal={ap} onRemove={() => removeActiveProposal(ap.id)} />
        ))}
      </Flex>
    </VStack>
  );
};

export default MultiProposalViewer;
