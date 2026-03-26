import React from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { FiHome, FiFileText, FiEye } from 'react-icons/fi';
import { useHistory, useLocation } from 'react-router-dom';
import './BottomNav.css';

interface NavItem {
  path: string;
  icon: any;
  label: string;
}

const navItems: NavItem[] = [
  { path: '/', icon: FiHome, label: 'Home' },
  { path: '/quote', icon: FiFileText, label: 'Quote' },
  { path: '/preview', icon: FiEye, label: 'Preview' },
];

const BottomNav: React.FC = () => {
  const history = useHistory();
  const location = useLocation();

  const handleNavigate = (path: string) => {
    // Add haptic-like animation feel
    const button = document.activeElement as HTMLElement;
    if (button) {
      button.style.transform = 'scale(0.92)';
      setTimeout(() => {
        button.style.transform = 'scale(1)';
      }, 100);
    }
    history.push(path);
  };

  return (
    <Box
      className="bottom-nav"
      position="fixed"
      bottom="0"
      left="0"
      right="0"
      bg="white"
      borderTop="1px solid"
      borderColor="gray.200"
      boxShadow="0 -2px 10px rgba(0, 0, 0, 0.05)"
      zIndex={1000}
      pb="env(safe-area-inset-bottom)"
      display={{ base: 'block', md: 'none' }} // Only show on mobile
    >
      <HStack spacing={0} justify="space-around" h="64px" px={2}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <VStack
              key={item.path}
              spacing={0}
              flex={1}
              h="full"
              justify="center"
              cursor="pointer"
              onClick={() => handleNavigate(item.path)}
              transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
              role="button"
              aria-label={item.label}
              _active={{
                transform: 'scale(0.92)',
              }}
            >
              <Box
                position="relative"
                display="flex"
                alignItems="center"
                justifyContent="center"
                w="56px"
                h="32px"
                borderRadius="16px"
                bg={isActive ? 'brand.500' : 'transparent'}
                transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                mb={1}
              >
                <Icon
                  as={item.icon}
                  boxSize={isActive ? '22px' : '24px'}
                  color={isActive ? 'white' : 'gray.500'}
                  transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                />
              </Box>
              <Text
                fontSize="11px"
                fontWeight={isActive ? '600' : '500'}
                color={isActive ? 'brand.500' : 'gray.600'}
                transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
              >
                {item.label}
              </Text>
            </VStack>
          );
        })}
      </HStack>
    </Box>
  );
};

export default BottomNav;
