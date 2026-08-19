import { AuthUser } from '../types/auth';

function normalizeRoleName(roleName: string): string {
  return roleName.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Company Profile is limited to Admin / Super Agent, or roles that
 * already have access_settings / manage_users in the Role.permissions JSON.
 */
export function canAccessCompanyProfile(user: AuthUser | null | undefined): boolean {
  if (!user?.role) return false;

  const normalized = normalizeRoleName(user.role.role_name || '');
  if (normalized === 'admin' || normalized === 'superagent') {
    return true;
  }

  const permissions = user.role.permissions || {};
  return permissions.access_settings === true || permissions.manage_users === true;
}
