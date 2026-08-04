import React from 'react';
import { Box, HStack, Icon } from '@chakra-ui/react';
import { FiHome, FiFileText, FiFolder, FiEye, FiUsers } from 'react-icons/fi';
import { useHistory, useLocation } from 'react-router-dom';

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Home', icon: FiHome },
  { path: '/documents', label: 'Docs', icon: FiFolder },
  { path: '/vendors', label: 'Vendors', icon: FiUsers },
  { path: '/quote', label: 'Quote', icon: FiFileText },
  { path: '/preview', label: 'Preview', icon: FiEye },
];

export const DesktopNavLinks: React.FC = () => {
  const history = useHistory();
  const location = useLocation();

  return (
    <HStack spacing={2}>
      {NAV_ITEMS.map((item) => {
        const isActive = location.pathname === item.path;

        return (
          <HStack
            key={item.path}
            spacing={2}
            cursor="pointer"
            onClick={() => history.push(item.path)}
            px={4}
            py={2}
            borderRadius="12px"
            bg={isActive ? 'brand.50' : 'transparent'}
            color={isActive ? 'brand.600' : 'gray.700'}
            fontWeight={isActive ? '600' : '500'}
            _hover={{ bg: 'brand.50', color: 'brand.600' }}
            transition="all 0.2s"
          >
            <Icon as={item.icon} boxSize={5} />
            <Box>{item.label}</Box>
          </HStack>
        );
      })}
    </HStack>
  );
};

export default DesktopNavLinks;
