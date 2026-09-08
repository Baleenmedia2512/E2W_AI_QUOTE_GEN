import React from 'react';
import {
  Badge,
  Box,
  Container,
  HStack,
  Heading,
  Image,
  Spacer,
  Text,
  VStack,
} from '@chakra-ui/react';
import { UserProfile } from '../UserProfile';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../../store';

export const Header: React.FC = () => {
  const history = useHistory();
  const companyInfo = useAppStore((state) => state.companyInfo);

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
      <Container maxW="container.xl" py={{ base: 1, md: 2 }}>
        <HStack spacing={4} minH={{ base: '40px', md: '48px' }}>
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
            <Image
              src="/icons/icon-192x192.png"
              alt="Quote Buddy"
              boxSize={{ base: '34px', md: '42px' }}
              borderRadius={{ base: '9px', md: '12px' }}
              objectFit="cover"
            />
            <VStack spacing={0} align="flex-start" justify="center" ml={2} maxW={{ base: '180px', md: '260px' }}>
              <HStack spacing={2} w="100%" align="center">
                <Heading size={{ base: 'sm', md: 'md' }} color="red.600" letterSpacing="-0.02em">
                  Quote Buddy
                </Heading>
                {typeof __APP_VERSION__ !== 'undefined' && (
                  <Badge
                    colorScheme="red"
                    variant="subtle"
                    fontSize={{ base: '7px', md: '10px' }}
                    px={1.5}
                    borderRadius="4px"
                  >
                    v{__APP_VERSION__}
                  </Badge>
                )}
              </HStack>
              {companyInfo?.name && (
                <Text
                  fontSize={{ base: 'xs', md: 'sm' }}
                  lineHeight="14px"
                  fontWeight="600"
                  color="gray.600"
                  textAlign="left"
                  noOfLines={1}
                  maxW={{ base: '180px', md: '260px' }}
                  title={companyInfo.name}
                >
                  {companyInfo.name}
                </Text>
              )}
            </VStack>
          </HStack>
          <Spacer />
          <UserProfile />
        </HStack>
      </Container>
    </Box>
  );
};

export default Header;
