import React, { useState } from 'react';
import {
  Box,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  useColorMode,
  VStack,
  Collapse,
} from '@chakra-ui/react';
import { FiHome, FiFileText, FiEye, FiMoon, FiSun, FiMenu, FiX } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import ProposalUpload from '../components/ProposalUpload/ProposalUpload';
import ProposalViewer from '../components/ProposalViewer/ProposalViewer';
import ChatInterface from '../components/ChatInterface/ChatInterface';

const HomePage: React.FC = () => {
  const history = useHistory();
  const { colorMode, toggleColorMode } = useColorMode();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <Box minH="100vh" bg="#EDF1F7">
      {/* Top Navigation Bar */}
      <Box
        bg="white"
        borderBottom="1px solid"
        borderColor="gray.200"
        px={{ base: 4, md: 8 }}
        py={{ base: 3, md: 4 }}
        boxShadow="sm"
        position="sticky"
        top={0}
        zIndex={100}
      >
        <Flex justify="space-between" align="center" maxW="1920px" mx="auto">
          {/* App Title */}
          <Heading
            size={{ base: 'md', md: 'lg' }}
            color="#1D6FE8"
            fontWeight="700"
            letterSpacing="-0.5px"
          >
            AI Quote Generator
          </Heading>

          {/* Desktop Nav Links */}
          <HStack spacing={6} display={{ base: 'none', md: 'flex' }}>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => history.push('/')}
              _hover={{ color: '#1D6FE8' }}
              color="gray.700"
            >
              <Icon as={FiHome} boxSize={5} />
              <Box fontWeight="500">Home</Box>
            </HStack>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => history.push('/quote')}
              _hover={{ color: '#1D6FE8' }}
              color="gray.700"
            >
              <Icon as={FiFileText} boxSize={5} />
              <Box fontWeight="500">Quote</Box>
            </HStack>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => history.push('/preview')}
              _hover={{ color: '#1D6FE8' }}
              color="gray.700"
            >
              <Icon as={FiEye} boxSize={5} />
              <Box fontWeight="500">Preview</Box>
            </HStack>
            <IconButton
              aria-label="Toggle dark mode"
              icon={colorMode === 'light' ? <FiMoon /> : <FiSun />}
              onClick={toggleColorMode}
              variant="ghost"
              size="md"
            />
          </HStack>

          {/* Mobile Menu Button */}
          <HStack spacing={2} display={{ base: 'flex', md: 'none' }}>
            <IconButton
              aria-label="Toggle dark mode"
              icon={colorMode === 'light' ? <FiMoon /> : <FiSun />}
              onClick={toggleColorMode}
              variant="ghost"
              size="sm"
            />
            <IconButton
              aria-label="Menu"
              icon={mobileMenuOpen ? <FiX /> : <FiMenu />}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              variant="ghost"
              size="sm"
            />
          </HStack>
        </Flex>

        {/* Mobile Dropdown Nav */}
        <Collapse in={mobileMenuOpen}>
          <VStack
            align="stretch"
            pt={3}
            spacing={1}
            display={{ base: 'flex', md: 'none' }}
          >
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => { history.push('/'); setMobileMenuOpen(false); }}
              _hover={{ color: '#1D6FE8', bg: 'gray.50' }}
              color="gray.700"
              py={2}
              px={2}
              borderRadius="md"
            >
              <Icon as={FiHome} boxSize={5} />
              <Box fontWeight="500">Home</Box>
            </HStack>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => { history.push('/quote'); setMobileMenuOpen(false); }}
              _hover={{ color: '#1D6FE8', bg: 'gray.50' }}
              color="gray.700"
              py={2}
              px={2}
              borderRadius="md"
            >
              <Icon as={FiFileText} boxSize={5} />
              <Box fontWeight="500">Quote</Box>
            </HStack>
            <HStack
              spacing={2}
              cursor="pointer"
              onClick={() => { history.push('/preview'); setMobileMenuOpen(false); }}
              _hover={{ color: '#1D6FE8', bg: 'gray.50' }}
              color="gray.700"
              py={2}
              px={2}
              borderRadius="md"
            >
              <Icon as={FiEye} boxSize={5} />
              <Box fontWeight="500">Preview</Box>
            </HStack>
          </VStack>
        </Collapse>
      </Box>

      {/* Two-Panel Layout */}
      <Flex
        maxW="1920px"
        mx="auto"
        p={{ base: 3, sm: 4, md: 6, lg: 8 }}
        gap={{ base: 4, md: 6 }}
        minH={{ md: 'calc(100vh - 88px)' }}
        direction={{ base: 'column', lg: 'row' }}
      >
        {/* LEFT PANEL */}
        <Box
          flex={{ lg: '0 0 30%' }}
          minW={{ lg: '360px' }}
          display="flex"
          flexDirection="column"
          gap={{ base: 4, md: 6 }}
          w={{ base: '100%', lg: 'auto' }}
        >
          <ProposalUpload />
          <ChatInterface />
        </Box>

        {/* RIGHT PANEL */}
        <Box flex="1" minW="0" w={{ base: '100%', lg: 'auto' }}>
          <ProposalViewer />
        </Box>
      </Flex>
    </Box>
  );
};

export default HomePage;
