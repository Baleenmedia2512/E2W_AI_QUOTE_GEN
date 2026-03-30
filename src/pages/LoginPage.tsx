import React, { useState, useEffect } from 'react';
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
} from '@chakra-ui/react';
import { ViewIcon, ViewOffIcon } from '@chakra-ui/icons';
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
    <Flex
      minH="100vh"
      align="center"
      justify="center"
      bg="gray.50"
      p={4}
    >
      <Container maxW="container.sm">
        <Box
          bg="white"
          p={8}
          borderRadius="xl"
          boxShadow="2xl"
          w="100%"
        >
          <VStack spacing={6} as="form" onSubmit={handleSubmit}>
            {/* Logo/Header */}
            <VStack spacing={2}>
              <Heading size="xl" color="blue.600">
                Quote Buddy
              </Heading>
              <Text color="gray.600" fontSize="lg">
                Sign in to your account
              </Text>
            </VStack>

            {/* Email Field */}
            <FormControl isRequired isInvalid={!!error}>
              <FormLabel>Email Address</FormLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                size="lg"
                autoComplete="email"
                autoFocus
              />
            </FormControl>

            {/* Password Field */}
            <FormControl isRequired isInvalid={!!error}>
              <FormLabel>Password</FormLabel>
              <InputGroup size="lg">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <InputRightElement>
                  <IconButton
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                    variant="ghost"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  />
                </InputRightElement>
              </InputGroup>
              {error && (
                <FormErrorMessage>{error}</FormErrorMessage>
              )}
            </FormControl>

            {/* Submit Button */}
            <Button
              type="submit"
              colorScheme="blue"
              size="lg"
              w="full"
              isLoading={isSubmitting}
              loadingText="Signing in..."
            >
              Sign In
            </Button>

            {/* Additional Links */}
            <VStack spacing={2} w="full">
              <Text fontSize="sm" color="gray.600">
                Don't have an account?{' '}
                <Link color="blue.600" fontWeight="medium">
                  Contact administrator
                </Link>
              </Text>
            </VStack>
          </VStack>
        </Box>

        {/* Footer Info */}
        <Text mt={6} textAlign="center" fontSize="sm" color="gray.500">
          AI-Powered Quote Generation System
        </Text>
      </Container>
    </Flex>
  );
};

export default LoginPage;
