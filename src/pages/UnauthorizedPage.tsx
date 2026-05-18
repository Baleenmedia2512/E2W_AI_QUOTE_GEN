import { Box, Button, Container, Heading, Text, VStack } from '@chakra-ui/react';
import React from 'react';
import { useHistory } from 'react-router-dom';

import { useAuthStore } from '../store/authStore';

const UnauthorizedPage: React.FC = () => {
  const history = useHistory();
  const { user, logout } = useAuthStore();

  const handleGoBack = () => {
    history.goBack();
  };

  const handleGoHome = () => {
    history.push('/');
  };

  const handleLogout = () => {
    logout();
    history.push('/login');
  };

  return (
    <Box minH="100vh" bg="gray.50" display="flex" alignItems="center" justifyContent="center">
      <Container maxW="container.md">
        <VStack spacing={6} textAlign="center" bg="white" p={10} borderRadius="xl" boxShadow="lg">
          <Box fontSize="6xl">🔒</Box>
          
          <Heading size="xl" color="red.600">
            Access Denied
          </Heading>
          
          <Text fontSize="lg" color="gray.700">
            You don't have permission to access this page.
          </Text>

          {user && (
            <Text fontSize="md" color="gray.600">
              Current role: <strong>{user.role.role_name}</strong>
            </Text>
          )}

          <VStack spacing={3} w="full" maxW="sm">
            <Button
              colorScheme="blue"
              size="lg"
              w="full"
              onClick={handleGoHome}
            >
              Go to Home
            </Button>
            
            <Button
              variant="outline"
              size="lg"
              w="full"
              onClick={handleGoBack}
            >
              Go Back
            </Button>

            <Button
              variant="ghost"
              size="md"
              w="full"
              onClick={handleLogout}
              colorScheme="red"
            >
              Logout
            </Button>
          </VStack>

          <Text fontSize="sm" color="gray.500" mt={4}>
            If you believe this is an error, please contact your administrator.
          </Text>
        </VStack>
      </Container>
    </Box>
  );
};

export default UnauthorizedPage;
