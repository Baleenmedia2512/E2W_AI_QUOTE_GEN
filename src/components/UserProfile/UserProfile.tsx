import React from 'react';
import {
  Avatar,
  Button,
  IconButton,
  Tooltip,
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

  return (
    <>
      <Tooltip label="Open profile">
        <IconButton
          aria-label="Open profile"
          icon={
            user.profileImage ? (
              <Avatar size="sm" name={user.full_name} src={user.profileImage} />
            ) : (
              <FiUser />
            )
          }
          onClick={() => {
            openChatProfile();
            if (history.location.pathname !== '/') history.push('/');
          }}
          variant="ghost"
          color="brand.600"
          borderRadius="full"
        />
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
    </>
  );
};

export default UserProfile;
