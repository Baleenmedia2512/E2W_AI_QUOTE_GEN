import React from 'react';
import { Box, Container, HStack, Heading, Spacer } from '@chakra-ui/react';
import { UserProfile } from '../UserProfile';

export const Header: React.FC = () => {
  return (
    <Box
      bg="white"
      borderBottom="1px solid"
      borderColor="gray.200"
      position="sticky"
      top={0}
      zIndex={999}
      display={{ base: 'none', md: 'block' }} // Only show on desktop
    >
      <Container maxW="container.xl" py={3}>
        <HStack spacing={4}>
          <Heading size="md" color="blue.600">
            Quote Buddy
          </Heading>
          <Spacer />
          <UserProfile />
        </HStack>
      </Container>
    </Box>
  );
};

export default Header;
