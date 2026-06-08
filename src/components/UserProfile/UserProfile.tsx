import React from 'react';
import {
  Box,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  Avatar,
  Text,
  HStack,
  VStack,
  Badge,
  useToast,
} from '@chakra-ui/react';
import { ChevronDownIcon } from '@chakra-ui/icons';
import { useHistory } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export const UserProfile: React.FC = () => {
  const { user, logout, isAuthenticated } = useAuthStore();
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

  // Get role color
  const getRoleColor = (roleName: string) => {
    const colors: Record<string, string> = {
      admin: 'red',
      manager: 'purple',
      sales: 'blue',
      user: 'gray',
      viewer: 'green',
    };
    return colors[roleName.toLowerCase()] || 'gray';
  };

  return (
    <Menu>
      <MenuButton
        as={Button}
        rightIcon={<ChevronDownIcon display={{ base: 'none', md: 'inline' }} />}
        variant="ghost"
        size="sm"
        px={{ base: 1, md: 3 }}
      >
        <HStack spacing={2}>
          <Avatar
            size="sm"
            name={user.full_name}
            bg="blue.500"
            color="white"
          />
          <VStack spacing={0} align="start" display={{ base: 'none', md: 'flex' }}>
            <Text fontSize="sm" fontWeight="medium" lineHeight="1.2">
              {user.full_name}
            </Text>
            <Badge
              fontSize="xs"
              colorScheme={getRoleColor(user.role.role_name)}
              variant="subtle"
            >
              {user.role.role_name}
            </Badge>
          </VStack>
        </HStack>
      </MenuButton>
      <MenuList>
        <Box px={3} py={2}>
          <Text fontWeight="bold" fontSize="sm">
            {user.full_name}
          </Text>
          <Text fontSize="xs" color="gray.600">
            {user.email}
          </Text>
          <Badge
            mt={1}
            fontSize="xs"
            colorScheme={getRoleColor(user.role.role_name)}
          >
            {user.role.role_name}
          </Badge>
        </Box>
        <MenuDivider />
        <MenuItem 
          icon={<Text fontSize="sm">📊</Text>}
          onClick={() => history.push('/token-usage')}
        >
          AI Token Usage
        </MenuItem>
        <MenuDivider />
        <MenuItem onClick={handleLogout} color="red.600">
          Logout
        </MenuItem>
      </MenuList>
    </Menu>
  );
};

export default UserProfile;
