import { AuthUser } from '../../src/types/auth';

export const adminUser: AuthUser = {
  id: 'user-admin-001',
  email: 'admin@baleenmedia.com',
  full_name: 'Admin User',
  role: {
    role_name: 'Admin',
    permissions: {
      canEditQuotes: true,
      canDeleteQuotes: true,
      canViewAllQuotes: true,
      canManageUsers: true,
    },
  },
};

export const regularUser: AuthUser = {
  id: 'user-regular-002',
  email: 'user@baleenmedia.com',
  full_name: 'Regular User',
  role: {
    role_name: 'user',
    permissions: {
      canEditQuotes: true,
      canDeleteQuotes: false,
      canViewAllQuotes: false,
    },
  },
};

export const restrictedUser: AuthUser = {
  id: 'user-restricted-003',
  email: 'restricted@baleenmedia.com',
  full_name: 'Restricted User',
  role: {
    role_name: 'viewer',
    permissions: {},
  },
};
