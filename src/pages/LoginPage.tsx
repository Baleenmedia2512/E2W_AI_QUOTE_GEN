import { ViewIcon, ViewOffIcon, LockIcon } from '@chakra-ui/icons';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  useToast,
  InputGroup,
  InputRightElement,
  IconButton,
  FormErrorMessage,
  Link,
  Container,
  Flex,
  HStack,
  Badge,
  Icon,
} from '@chakra-ui/react';
import React, { useState, useEffect } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

import { useAuthStore } from '../store/authStore';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const toast = useToast();
  const history = useHistory();
  const location = useLocation<{ from?: string }>();
  const { login, isAuthenticated, error, clearError } = useAuthStore();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const from = location.state?.from || '/';
      history.replace(from);
    }
  }, [isAuthenticated, history, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!email || !password) {
      toast({
        title: 'Missing fields',
        description: 'Please enter both email and password',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsSubmitting(true);
    clearError();

    try {
      await login({ email, password });
      
      toast({
        title: 'Login successful',
        description: 'Welcome back!',
        status: 'success',
        duration: 2000,
        isClosable: true,
      });
      
      // Redirect to the page they tried to visit or home
      const from = location.state?.from || '/';
      history.push(from);
    } catch (err: any) {
      toast({
        title: 'Login failed',
        description: err.message || 'Invalid credentials',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box
      minH="100vh"
      bg="white"
      position="relative"
      overflow="hidden"
    >
      {/* White Header Bar - Status Bar Area */}
      <Box
        bg="white"
        h={{ base: "44px", md: "60px" }}
        borderBottom="1px solid"
        borderColor="gray.100"
      />

      {/* Burgundy Header Section */}
      <Box
        bgGradient="linear(135deg, brand.500 0%, brand.600 100%)"
        pt={{ base: 8, md: 12 }}
        pb={{ base: 24, md: 28 }}
        px={6}
        position="relative"
        overflow="hidden"
        _before={{
          content: '""',
          position: 'absolute',
          top: '-50%',
          right: '-20%',
          width: '400px',
          height: '400px',
          borderRadius: 'full',
          bg: 'whiteAlpha.100',
          filter: 'blur(60px)',
        }}
        _after={{
          content: '""',
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '60px',
          bg: 'white',
          borderTopRadius: '30px',
        }}
      >
        {/* Decorative Elements */}
        <Box
          position="absolute"
          bottom="40%"
          left="-10%"
          width="200px"
          height="200px"
          borderRadius="full"
          bg="whiteAlpha.50"
          filter="blur(50px)"
        />

        <Container maxW="440px" position="relative" zIndex={1}>
          {/* Logo and Badge */}
          <VStack align="flex-start" spacing={4}>
            <HStack spacing={3}>
              <Box
                bg="whiteAlpha.200"
                p={2.5}
                borderRadius="xl"
                backdropFilter="blur(10px)"
                border="1px solid"
                borderColor="whiteAlpha.300"
                boxShadow="0 4px 12px rgba(0, 0, 0, 0.1)"
                transition="all 0.3s"
                _hover={{
                  transform: 'scale(1.05)',
                  bg: 'whiteAlpha.300',
                }}
              >
                <Icon viewBox="0 0 24 24" boxSize={6} color="white">
                  <path
                    fill="currentColor"
                    d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
                  />
                </Icon>
              </Box>
              <Heading 
                size="lg" 
                color="white" 
                fontWeight="800"
                letterSpacing="tight"
                textShadow="0 2px 10px rgba(0, 0, 0, 0.2)"
              >
                QuoteAI
              </Heading>
            </HStack>

            <Badge
              bg="whiteAlpha.200"
              color="white"
              px={3.5}
              py={1.5}
              borderRadius="full"
              fontSize="2xs"
              fontWeight="700"
              textTransform="uppercase"
              letterSpacing="wider"
              backdropFilter="blur(10px)"
              border="1px solid"
              borderColor="whiteAlpha.300"
              boxShadow="0 2px 8px rgba(0, 0, 0, 0.1)"
            >
              ✨ GEMINI AI - POWERED
            </Badge>

            <VStack align="flex-start" spacing={3} mt={3}>
              <Box>
                <Text
                  fontSize="4xl"
                  fontWeight="900"
                  color="white"
                  lineHeight="1.1"
                  textShadow="0 2px 10px rgba(0, 0, 0, 0.2)"
                  letterSpacing="tight"
                >
                  Welcome
                </Text>
                <Text
                  fontSize="4xl"
                  fontWeight="900"
                  color="whiteAlpha.500"
                  lineHeight="1.1"
                  letterSpacing="tight"
                  backgroundImage="linear-gradient(90deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.3) 100%)"
                  backgroundClip="text"
                >
                  back
                </Text>
              </Box>
              <Text 
                color="whiteAlpha.900" 
                fontSize="sm"
                fontWeight="500"
                lineHeight="1.6"
                maxW="90%"
              >
                Sign in to generate intelligent quotations from your proposals.
              </Text>
            </VStack>
          </VStack>
        </Container>
      </Box>

      {/* Form Section */}
      <Container maxW="440px" px={6} mt={-6}>
        <VStack spacing={6} as="form" onSubmit={handleSubmit}>
          {/* Email Field */}
          <FormControl isRequired isInvalid={!!error}>
            <FormLabel
              fontSize="xs"
              fontWeight="600"
              color="gray.500"
              textTransform="uppercase"
              letterSpacing="wide"
              mb={2}
            >
              📧 Email Address
            </FormLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              size="lg"
              autoComplete="off"
              autoFocus
              bg="gray.800"
              color="white"
              border="none"
              borderRadius="xl"
              h="56px"
              fontSize="md"
              _placeholder={{ color: 'gray.500' }}
              _hover={{ bg: 'gray.700' }}
              _focus={{
                bg: 'gray.700',
                boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.3)',
              }}
            />
          </FormControl>

          {/* Password Field */}
          <FormControl isRequired isInvalid={!!error}>
            <FormLabel
              fontSize="xs"
              fontWeight="600"
              color="gray.500"
              textTransform="uppercase"
              letterSpacing="wide"
              mb={2}
            >
              🔒 Password
            </FormLabel>
            <InputGroup size="lg">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                bg="gray.800"
                color="white"
                border="none"
                borderRadius="xl"
                h="56px"
                fontSize="md"
                pr="60px"
                _placeholder={{ color: 'gray.500' }}
                _hover={{ bg: 'gray.700' }}
                _focus={{
                  bg: 'gray.700',
                  boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.3)',
                }}
              />
              <InputRightElement h="56px" pr={3}>
                <IconButton
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                  variant="ghost"
                  color="gray.400"
                  _hover={{ color: 'white', bg: 'whiteAlpha.200' }}
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  size="sm"
                />
              </InputRightElement>
            </InputGroup>
            
            {/* Error Message or Forgot Password */}
            {error ? (
              <FormErrorMessage mt={2} fontSize="sm">
                {error}
              </FormErrorMessage>
            ) : (
              <Flex justify="flex-end" mt={2}>
                <Link
                  fontSize="sm"
                  color="brand.500"
                  fontWeight="600"
                  _hover={{ color: 'brand.600', textDecoration: 'underline' }}
                >
                  Forgot password?
                </Link>
              </Flex>
            )}
          </FormControl>

          {/* Submit Button */}
          <Button
            type="submit"
            w="full"
            h="56px"
            bg="brand.500"
            color="white"
            fontSize="md"
            fontWeight="700"
            borderRadius="xl"
            isLoading={isSubmitting}
            loadingText="Signing in..."
            _hover={{
              bg: 'brand.600',
              transform: 'translateY(-2px)',
              boxShadow: '0 8px 20px rgba(201, 31, 61, 0.3)',
            }}
            _active={{
              transform: 'scale(0.98)',
            }}
            transition="all 0.2s"
            mt={4}
          >
            Sign In
          </Button>

          {/* Security Badge */}
          <HStack spacing={2} color="gray.400" fontSize="xs" pt={2}>
            <Icon as={LockIcon} boxSize={3} />
            <Text>Secured with 256-bit encryption</Text>
          </HStack>
        </VStack>

        {/* Footer */}
        <Box textAlign="center" mt={12} pb={8}>
          <Text fontSize="sm" color="gray.600">
            Don't have an account?{' '}
            <Text
              as="span"
              color="gray.500"
              fontWeight="600"
            >
              Contact admin
            </Text>
          </Text>
        </Box>
      </Container>
    </Box>
  );
};

export default LoginPage;
