import React from 'react';
import {
  Box,
  Container,
  Flex,
  Heading,
  IconButton,
  useColorMode,
  useColorModeValue,
  HStack,
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  useDisclosure,
  VStack,
} from '@chakra-ui/react';
import { HamburgerIcon, MoonIcon, SunIcon } from '@chakra-ui/icons';
import { FiHome, FiFileText, FiEye } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';

interface LayoutProps {
  title: string;
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ title, children }) => {
  const { colorMode, toggleColorMode } = useColorMode();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const history = useHistory();
  
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  const navigationItems = [
    { name: 'Home', icon: FiHome, path: '/' },
    { name: 'Quote', icon: FiFileText, path: '/quote' },
    { name: 'Preview', icon: FiEye, path: '/preview' },
  ];

  const handleNavigate = (path: string) => {
    history.push(path);
    onClose();
  };

  return (
    <Box minH="100vh" bg={useColorModeValue('gray.50', 'gray.900')}>
      {/* Header */}
      <Box
        position="sticky"
        top={0}
        zIndex={10}
        bg={bgColor}
        borderBottom="1px"
        borderColor={borderColor}
        boxShadow="sm"
      >
        <Container maxW="container.xl">
          <Flex h="16" alignItems="center" justifyContent="space-between">
            {/* Mobile Menu Button */}
            <IconButton
              display={{ base: 'flex', md: 'none' }}
              onClick={onOpen}
              variant="ghost"
              aria-label="Open menu"
              icon={<HamburgerIcon />}
            />

            {/* Logo/Title */}
            <Heading size="md" fontWeight="bold" color="brand.600">
              {title}
            </Heading>

            {/* Desktop Navigation */}
            <HStack spacing={4} display={{ base: 'none', md: 'flex' }}>
              {navigationItems.map((item) => (
                <Button
                  key={item.path}
                  variant="ghost"
                  leftIcon={<item.icon />}
                  onClick={() => handleNavigate(item.path)}
                  size="sm"
                >
                  {item.name}
                </Button>
              ))}
            </HStack>

            {/* Color Mode Toggle */}
            <IconButton
              aria-label="Toggle color mode"
              icon={colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
              onClick={toggleColorMode}
              variant="ghost"
              size="sm"
            />
          </Flex>
        </Container>
      </Box>

      {/* Mobile Drawer */}
      <Drawer isOpen={isOpen} placement="left" onClose={onClose}>
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader borderBottomWidth="1px">Navigation</DrawerHeader>
          <DrawerBody>
            <VStack spacing={4} align="stretch" mt={4}>
              {navigationItems.map((item) => (
                <Button
                  key={item.path}
                  variant="ghost"
                  leftIcon={<item.icon />}
                  onClick={() => handleNavigate(item.path)}
                  justifyContent="flex-start"
                  size="lg"
                >
                  {item.name}
                </Button>
              ))}
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Main Content */}
      <Container maxW="container.xl" py={{ base: 4, md: 8 }}>
        {children}
      </Container>
    </Box>
  );
};

export default Layout;
