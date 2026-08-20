import { AuthUser } from '../types/auth';

function normalizeRoleName(roleName: string): string {
  return roleName.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Company Profile is limited to Developer and Super Agent.
 * Role permissions do not broaden this access.
 */
export function canAccessCompanyProfile(user: AuthUser | null | undefined): boolean {
  if (!user?.role) return false;

  const normalized = normalizeRoleName(user.role.role_name || '');
  return normalized === 'developer' || normalized === 'superagent';
}
