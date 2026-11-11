import { prisma } from './prisma';

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function internalEmails(): string[] {
  return [
    process.env.INTERNAL_QUOTE_EMAIL_1,
    process.env.INTERNAL_QUOTE_EMAIL_2,
    process.env.INTERNAL_QUOTE_EMAIL_3,
  ]
    .filter(Boolean)
    .map((v) => normalizeEmail(v));
}

export async function buildAuthUser(userId: string): Promise<Record<string, unknown> | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;

  const role = await prisma.role.findUnique({ where: { id: user.roleId } });
  if (!role) return null;

  let permissions: Record<string, boolean> = {};
  if (role.permissions) {
    try {
      permissions =
        typeof role.permissions === 'string'
          ? JSON.parse(role.permissions)
          : (role.permissions as Record<string, boolean>);
    } catch {
      permissions = {};
    }
  }

  let phone: string | null = null;
  if (user.settings) {
    try {
      const settings =
        typeof user.settings === 'string' ? JSON.parse(user.settings) : user.settings;
      if (settings && typeof settings === 'object' && typeof (settings as { phone?: unknown }).phone === 'string') {
        phone = (settings as { phone: string }).phone;
      }
    } catch {
      phone = null;
    }
  }

  return {
    id: user.id,
    email: user.email,
    canSendQuoteEmail: internalEmails().includes(normalizeEmail(user.email)),
    full_name: user.name,
    phone,
    profileImage: user.image || null,
    role: { role_name: role.name || 'user', permissions },
  };
}
