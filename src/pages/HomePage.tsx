import React from 'react';
import {
  Box,
  Flex,
  Heading,
  HStack,
  VStack,
  Text,
  Icon,
  IconButton,
  Badge,
  Grid,
  GridItem,
  useColorMode,
} from '@chakra-ui/react';
import { FiHome, FiFileText, FiEye, FiMoon, FiSun, FiMenu } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import ProposalUpload from '../components/ProposalUpload/ProposalUpload';
import ProposalViewer from '../components/ProposalViewer/ProposalViewer';
import ChatInterface from '../components/ChatInterface/ChatInterface';

const HomePage: React.FC = () => {
  const history = useHistory();
  const { colorMode, toggleColorMode } = useColorMode();

  return (
    <Box minH="100vh" bg="#F8FAFC">
      {/* Mobile Header with Logo */}
      <Box
        bg="white"
        px={4}
        py={3}
        position="sticky"
        top={0}
        zIndex={100}
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
            <Icon as={FiFileText} boxSize={4} />
          </Box>
          <Text fontSize="lg" fontWeight="800" color="brand.500">
            AI Quote
          </Text>
        </HStack>
        <HStack spacing={2}>
          <IconButton
            aria-label="Toggle dark mode"
            icon={colorMode === 'light' ? <FiMoon /> : <FiSun />}
            onClick={toggleColorMode}
            variant="ghost"
            size="sm"
          />
          <IconButton
            aria-label="Menu"
            icon={<FiMenu />}
            variant="ghost"
            size="sm"
          />
        </HStack>
      </Box>

      {/* Desktop Header */}
      <Box
        bg="white"
        borderBottom="1px solid"
        borderColor="gray.100"
        px={{ base: 4, md: 8 }}
        py={{ base: 3, md: 4 }}
        boxShadow="0 1px 3px rgba(0, 0, 0, 0.04)"
        position="sticky"
        top={0}
        zIndex={100}
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
              <Icon as={FiFileText} boxSize={5} />
            </Box>
            <Heading size="lg" color="brand.500" fontWeight="800" letterSpacing="-0.02em">
              AI Quote
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
            <IconButton
              aria-label="Toggle dark mode"
              icon={colorMode === 'light' ? <FiMoon /> : <FiSun />}
              onClick={toggleColorMode}
              variant="ghost"
              size="md"
              borderRadius="12px"
            />
          </HStack>
        </Flex>
      </Box>

      {/* Main Content */}
      <Flex
        maxW="1920px"
        mx="auto"
        p={{ base: 3, sm: 4, md: 6 }}
        gap={{ base: 3, md: 6 }}
        direction={{ base: 'column', lg: 'row' }}
      >
        {/* LEFT PANEL */}
        <Box
          flex={{ lg: '0 0 380px' }}
          w={{ base: '100%', lg: '380px' }}
          display="flex"
          flexDirection="column"
          gap={3}
        >
          {/* Hero Card with Gradient */}
          <Box
            bgGradient="linear(to-br, brand.500, brand.600)"
            borderRadius="20px"
            p={6}
            color="white"
            position="relative"
            overflow="hidden"
            boxShadow="0 8px 24px rgba(201, 31, 61, 0.3)"
          >
            <HStack justify="space-between" mb={4}>
              <Badge
                bg="rgba(255,255,255,0.25)"
                color="white"
                px={3}
                py={1}
                borderRadius="full"
                fontSize="xs"
                fontWeight="600"
                textTransform="uppercase"
              >
                Gemini AI - Active
              </Badge>
              <Box
                bg="rgba(255,255,255,0.2)"
                px={2}
                py={1}
                borderRadius="6px"
                fontSize="xs"
                fontWeight="700"
              >
                AI
              </Box>
            </HStack>
            
            <Heading size="lg" mb={3} fontWeight="800" lineHeight="1.2">
              Generate Pro Quotes in Seconds
            </Heading>
            
            <Text fontSize="sm" opacity={0.95} lineHeight="1.6">
              Upload any BTL proposal PDF and get an intelligent, editable quotation instantly.
            </Text>
          </Box>

          {/* Upload Proposal */}
          <ProposalUpload />

          {/* AI Assistant - Light Card */}
          <Box
            bg="white"
            borderRadius="20px"
            overflow="hidden"
            boxShadow="0 2px 8px rgba(0, 0, 0, 0.08)"
          >
            <ChatInterface />
          </Box>
        </Box>

        {/* RIGHT PANEL - PDF Viewer */}
        <Box flex="1" minW="0" w={{ base: '100%', lg: 'auto' }}>
          <ProposalViewer />
        </Box>
      </Flex>
    </Box>
  );
};

export default HomePage;
