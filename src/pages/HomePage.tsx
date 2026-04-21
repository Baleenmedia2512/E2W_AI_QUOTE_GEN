import React from 'react';
import {
  Box,
  Flex,
  Heading,
  HStack,
  Text,
  Icon,
  Badge,
} from '@chakra-ui/react';
import { FiHome, FiFileText, FiEye, FiMessageSquare, FiFolder } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import ChatInterface from '../components/ChatInterface/ChatInterface';
import { UserProfile } from '../components/UserProfile';

const HomePage: React.FC = () => {
  const history = useHistory();

  return (
    <Box minH="100vh" bg="#F8FAFC">
      {/* Mobile Header with Logo */}
      <Box
        bg="white"
        px={4}
        py={3}
        position="fixed"
        top={0}
        left={0}
        right={0}
        zIndex={1001}
        display={{ base: 'flex', md: 'none' }}
        alignItems="center"
        justifyContent="space-between"
        borderBottom="1px solid"
        borderColor="gray.100"
      >
        <HStack spacing={2}>
          <Box
            bg="brand.500"
            color="white"
            px={2}
            py={1}
            borderRadius="6px"
            fontWeight="800"
            fontSize="sm"
          >
            <Icon as={FiMessageSquare} boxSize={4} />
          </Box>
          <Text fontSize="lg" fontWeight="800" color="brand.500">
            Quote Buddy
          </Text>
        </HStack>
        {/* User Profile - Mobile */}
        <Box display={{ base: 'block', md: 'none' }}>
          <UserProfile />
        </Box>
      </Box>

      {/* Desktop Header */}
      <Box
        bg="white"
        borderBottom="1px solid"
        borderColor="gray.100"
        px={{ base: 4, md: 8 }}
        py={{ base: 3, md: 4 }}
        boxShadow="0 1px 3px rgba(0, 0, 0, 0.04)"
        position="fixed"
        top={0}
        left={0}
        right={0}
        zIndex={1001}
        display={{ base: 'none', md: 'block' }}
      >
        <Flex justify="space-between" align="center" maxW="1920px" mx="auto">
          <HStack spacing={3}>
            <Box
              bg="brand.500"
              color="white"
              px={3}
              py={2}
              borderRadius="8px"
              fontWeight="800"
            >
              <Icon as={FiMessageSquare} boxSize={5} />
            </Box>
            <Heading size="lg" color="brand.500" fontWeight="800" letterSpacing="-0.02em">
              Quote Buddy
            </Heading>
          </HStack>

          <HStack spacing={2}>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => history.push('/')}
              px={4}
              py={2}
              borderRadius="12px"
              _hover={{ bg: 'brand.50', color: 'brand.600' }}
              color="gray.700"
              fontWeight="500"
              transition="all 0.2s"
            >
              <Icon as={FiHome} boxSize={5} />
              <Box>Home</Box>
            </HStack>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => history.push('/documents')}
              px={4}
              py={2}
              borderRadius="12px"
              _hover={{ bg: 'brand.50', color: 'brand.600' }}
              color="gray.700"
              fontWeight="500"
              transition="all 0.2s"
            >
              <Icon as={FiFolder} boxSize={5} />
              <Box>Docs</Box>
            </HStack>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => history.push('/quote')}
              px={4}
              py={2}
              borderRadius="12px"
              _hover={{ bg: 'brand.50', color: 'brand.600' }}
              color="gray.700"
              fontWeight="500"
              transition="all 0.2s"
            >
              <Icon as={FiFileText} boxSize={5} />
              <Box>Quote</Box>
            </HStack>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => history.push('/preview')}
              px={4}
              py={2}
              borderRadius="12px"
              _hover={{ bg: 'brand.50', color: 'brand.600' }}
              color="gray.700"
              fontWeight="500"
              transition="all 0.2s"
            >
              <Icon as={FiEye} boxSize={5} />
              <Box>Preview</Box>
            </HStack>
            {/* User Profile - Desktop */}
            <Box ml={4}>
              <UserProfile />
            </Box>
          </HStack>
        </Flex>
      </Box>

      {/* Main Content - Flexible Layout */}
      <Box
        mt={{ base: '65px', md: '85px' }}
        minH={{ base: 'calc(100vh - 129px)', md: 'calc(100vh - 105px)' }}
        maxH={{ base: 'calc(100vh - 129px)', md: 'calc(100vh - 105px)' }}
        sx={{
          '@supports (height: 100dvh)': {
            minH: { base: 'calc(100dvh - 129px)', md: 'calc(100vh - 105px)' },
            maxH: { base: 'calc(100dvh - 129px)', md: 'calc(100vh - 105px)' },
          }
        }}
      >
        <Box
          maxW="1400px"
          mx="auto"
          h="100%"
          display="flex"
          flexDirection="column"
          px={{ base: 3, md: 6 }}
          py={{ base: 2, md: 4 }}
        >
          {/* Compact Hero Banner */}
          <Box
            bgGradient="linear(to-r, brand.500, brand.600)"
            borderRadius={{ base: '12px', md: '16px' }}
            p={{ base: 3, md: 4 }}
            color="white"
            mb={{ base: 2, md: 3 }}
            flexShrink={0}
          >
            <HStack justify="space-between" align="center">
              <HStack spacing={2}>
                <Badge
                  bg="rgba(255,255,255,0.25)"
                  color="white"
                  px={2}
                  py={1}
                  borderRadius="full"
                  fontSize="xs"
                  fontWeight="600"
                >
                  ✨ AI Powered
                </Badge>
                <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="700">
                  Just chat to create quotes instantly!
                </Text>
              </HStack>
            </HStack>
          </Box>

          {/* Chat Interface - Full Height */}
          <Box
            flex="1"
            bg="white"
            borderRadius={{ base: '12px', md: '16px' }}
            boxShadow="0 2px 12px rgba(0, 0, 0, 0.08)"
            minH={0}
            display="flex"
            flexDirection="column"
          >
            <ChatInterface />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default HomePage;
