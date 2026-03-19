import React from 'react';
import {
  Box,
  Container,
  HStack,
  Text,
  Button,
  Icon,
  useColorMode,
  IconButton,
  Flex,
} from '@chakra-ui/react';
import { FiHome, FiFileText, FiEye, FiMoon, FiSun } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';

const QuoteNavBar: React.FC = () => {
  const history = useHistory();
  const { colorMode, toggleColorMode } = useColorMode();

  return (
    <Box 
      bg="white" 
      borderBottom="1px solid" 
      borderColor="gray.200" 
      py={4}
      position="sticky"
      top={0}
      zIndex={100}
      boxShadow="sm"
    >
      <Container maxW="1280px">
        <Flex justify="space-between" align="center">
          {/* App Title */}
          <Text 
            fontSize="xl" 
            fontWeight="700" 
            color="gray.900"
            fontFamily="'DM Sans', sans-serif"
          >
            Create Quote
          </Text>

          {/* Navigation Links */}
          <HStack spacing={1} display={{ base: 'none', md: 'flex' }}>
            <Button
              variant="ghost"
              leftIcon={<Icon as={FiHome} />}
              onClick={() => history.push('/')}
              fontWeight="500"
              color="gray.700"
              _hover={{ bg: 'gray.100' }}
            >
              Home
            </Button>
            <Button
              variant="ghost"
              leftIcon={<Icon as={FiFileText} />}
              onClick={() => history.push('/quote')}
              fontWeight="500"
              color="gray.700"
              _hover={{ bg: 'gray.100' }}
            >
              Quote
            </Button>
            <Button
              variant="ghost"
              leftIcon={<Icon as={FiEye} />}
              onClick={() => history.push('/quote-preview')}
              fontWeight="500"
              color="gray.700"
              _hover={{ bg: 'gray.100' }}
            >
              Preview
            </Button>
          </HStack>

          {/* Dark Mode Toggle */}
          <IconButton
            aria-label="Toggle dark mode"
            icon={colorMode === 'light' ? <FiMoon /> : <FiSun />}
            onClick={toggleColorMode}
            variant="ghost"
            color="gray.700"
            _hover={{ bg: 'gray.100' }}
          />
        </Flex>
      </Container>
    </Box>
  );
};

export default QuoteNavBar;
