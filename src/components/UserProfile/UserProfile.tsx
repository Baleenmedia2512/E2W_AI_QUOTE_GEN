import React from 'react';
import {
  Avatar,
  Button,
  HStack,
  IconButton,
  Text,
  Tooltip,
  VStack,
  useToast,
} from '@chakra-ui/react';
import { useHistory } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store';
import { FiLogOut, FiUser } from 'react-icons/fi';

export const UserProfile: React.FC = () => {
  const { user, logout, isAuthenticated } = useAuthStore();
  const openChatProfile = useAppStore((state) => state.openChatProfile);
  const history = useHistory();
  const toast = useToast();

  if (!isAuthenticated || !user) {
    return (
      <Button
        size="sm"
        colorScheme="blue"
        onClick={() => history.push('/login')}
      >
        Login
      </Button>
    );
  }

  const handleLogout = () => {
    logout();
    toast({
      title: 'Logged out successfully',
      status: 'success',
      duration: 2000,
      isClosable: true,
    });
    history.push('/login');
  };

  const roleName = user.role?.role_name || 'User';

  return (
    <HStack spacing={{ base: 2, md: 3 }}>
      <Tooltip label="Open profile">
        <HStack
          as="button"
          type="button"
          onClick={() => {
            openChatProfile();
            if (history.location.pathname !== '/') history.push('/');
          }}
          spacing={{ base: 1.5, md: 2 }}
          minW={{ base: 'auto', md: '145px' }}
          textAlign="left"
          cursor="pointer"
          _hover={{ opacity: 0.8 }}
        >
          {user.profileImage ? (
            <Avatar size="sm" name={user.full_name} src={user.profileImage} />
          ) : (
            <Avatar
              size="sm"
              name={user.full_name}
              bg="gray.100"
              color="gray.600"
              icon={<FiUser />}
            />
          )}
          <VStack
            align="flex-start"
            spacing={0}
            display={{ base: 'none', sm: 'flex' }}
            maxW={{ sm: '105px', md: '135px' }}
          >
            <Text
              fontSize={{ sm: 'xs', md: 'sm' }}
              fontWeight="700"
              color="gray.800"
              noOfLines={1}
            >
              {user.full_name || 'User'}
            </Text>
            <Text
              fontSize="xs"
              color="gray.500"
              noOfLines={1}
            >
              {roleName}
            </Text>
          </VStack>
        </HStack>
      </Tooltip>
      <Tooltip label="Logout">
        <IconButton
          aria-label="Logout"
          icon={<FiLogOut />}
          onClick={handleLogout}
          variant="ghost"
          color="red.500"
          borderRadius="full"
          _hover={{ bg: 'red.50', color: 'red.600' }}
        />
      </Tooltip>
    </HStack>
  );
};

export default UserProfile;
