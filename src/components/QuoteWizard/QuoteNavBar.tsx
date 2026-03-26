import React from 'react';
import {
  Box,
  Container,
  HStack,
  VStack,
  Text,
  Button,
  Icon,
  useColorMode,
  IconButton,
  Flex,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  useDisclosure,
} from '@chakra-ui/react';
import { HamburgerIcon } from '@chakra-ui/icons';
import { FiHome, FiFileText, FiEye, FiMoon, FiSun } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';

const QuoteNavBar: React.FC = () => {
  const history = useHistory();
  const { colorMode, toggleColorMode } = useColorMode();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const navItems = [
    { label: 'Home', icon: FiHome, path: '/' },
    { label: 'Quote', icon: FiFileText, path: '/quote' },
    { label: 'Preview', icon: FiEye, path: '/preview' },
  ];

  const handleNavigate = (path: string) => {
    history.push(path);
    onClose();
  };

  return (
    <Box 
      bg="white" 
      borderBottom="1px solid" 
      borderColor="gray.100" 
      py={4}
      position="sticky"
      top={0}
      zIndex={100}
      boxShadow="0 1px 3px rgba(0, 0, 0, 0.04)"
    >
      <Container maxW="1280px">
        <Flex justify="space-between" align="center">
          {/* Mobile Hamburger */}
          <IconButton
            display={{ base: 'flex', md: 'none' }}
            aria-label="Open menu"
            icon={<HamburgerIcon />}
            variant="ghost"
            onClick={onOpen}
            color="gray.600"
            borderRadius="12px"
            _hover={{ bg: 'gray.100' }}
          />

          {/* App Title with Gradient */}
          <Text 
            fontSize="xl" 
            fontWeight="800" 
            color="brand.500"
            letterSpacing="-0.02em"
          >
            Create Quote
          </Text>

          {/* Desktop Navigation Links */}
          <HStack spacing={1} display={{ base: 'none', md: 'flex' }}>
            {navItems.map((item) => (
              <Button
                key={item.label}
                variant="ghost"
                leftIcon={<Icon as={item.icon} />}
                onClick={() => handleNavigate(item.path)}
                fontWeight="500"
                color="gray.700"
                borderRadius="12px"
                _hover={{ bg: 'brand.50', color: 'brand.600' }}
              >
                {item.label}
              </Button>
            ))}
          </HStack>

          {/* Dark Mode Toggle */}
          <IconButton
            aria-label="Toggle dark mode"
            icon={colorMode === 'light' ? <FiMoon /> : <FiSun />}
            onClick={toggleColorMode}
            variant="ghost"
            color="gray.600"
            borderRadius="12px"
            _hover={{ bg: 'gray.100' }}
          />
        </Flex>
      </Container>

      {/* Mobile Drawer */}
      <Drawer isOpen={isOpen} placement="left" onClose={onClose}>
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <Box pt={12} px={4}>
            <VStack spacing={2} align="stretch">
              {navItems.map((item) => (
                <Button
                  key={item.label}
                  variant="ghost"
                  leftIcon={<Icon as={item.icon} />}
                  onClick={() => handleNavigate(item.path)}
                  justifyContent="flex-start"
                  fontWeight="500"
                  color="gray.700"
                  _hover={{ bg: 'gray.100' }}
                  size="lg"
                  w="100%"
                >
                  {item.label}
                </Button>
              ))}
            </VStack>
          </Box>
        </DrawerContent>
      </Drawer>
    </Box>
  );
};

export default QuoteNavBar;
