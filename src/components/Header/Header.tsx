import React from 'react';
import { Box, Container, HStack, Heading, Spacer } from '@chakra-ui/react';
import { UserProfile } from '../UserProfile';
import { useHistory } from 'react-router-dom';

export const Header: React.FC = () => {
  const history = useHistory();

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
          <HStack
            as="button"
            type="button"
            onClick={() => history.push('/')}
            cursor="pointer"
            spacing={0}
            bg="transparent"
            border="none"
            p={0}
            aria-label="Go to Home"
            _hover={{ opacity: 0.8 }}
          >
            <Heading size="md" color="blue.600">
              Quote Buddy
            </Heading>
          </HStack>
          <Spacer />
          <UserProfile />
        </HStack>
      </Container>
    </Box>
  );
};

export default Header;
