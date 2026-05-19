import {
  Box,
  Container,
  HStack,
  VStack,
  Text,
  Button,
  Icon,
  Flex,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  useDisclosure,
} from '@chakra-ui/react';
import React from 'react';
import { FiHome, FiFileText, FiEye } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';

const QuoteNavBar: React.FC = () => {
  const history = useHistory();
  const { isOpen, onClose } = useDisclosure();

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
      py={{ base: 3, md: 4 }}
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={1001}
      boxShadow="0 1px 3px rgba(0, 0, 0, 0.04)"
    >
      <Container maxW="1280px">
        {/* Mobile Layout */}
        <Flex justify="flex-start" align="center" display={{ base: 'flex', md: 'none' }}>
          {/* Quote Buddy Logo & Title - Left Aligned */}
          <HStack spacing={2}>
            <Box bg="brand.500" color="white" px={2} py={1} borderRadius="6px" fontWeight="800">
              <Icon as={FiFileText} boxSize={4} />
            </Box>
            <Text fontSize="lg" fontWeight="800" color="brand.500" letterSpacing="-0.02em">
              Quote Buddy
            </Text>
          </HStack>
        </Flex>

        {/* Desktop Layout */}
        <Flex justify="space-between" align="center" display={{ base: 'none', md: 'flex' }}>
          {/* Quote Buddy Logo & Title */}
          <HStack spacing={3}>
            <Box bg="brand.500" color="white" px={3} py={2} borderRadius="8px" fontWeight="800">
              <Icon as={FiFileText} boxSize={5} />
            </Box>
            <Text fontSize="xl" fontWeight="800" color="brand.500" letterSpacing="-0.02em">
              Quote Buddy
            </Text>
          </HStack>

          {/* Desktop Navigation Links */}
          <HStack spacing={1}>
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
