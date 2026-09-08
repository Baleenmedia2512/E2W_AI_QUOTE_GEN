export const EMAIL_ADDRESS_UNAVAILABLE = 'Email address not available.';

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function matchConfiguredRecipient(
  authenticatedEmail: unknown,
  configuredEmails: readonly (string | undefined)[],
): string | null {
  const normalizedEmail = normalizeEmail(authenticatedEmail);
  if (!normalizedEmail) return null;
  return configuredEmails.find(
    (candidate) => normalizeEmail(candidate) === normalizedEmail,
  ) || null;
}

export function normalizeCcRecipients(cc: unknown): string[] {
  if (typeof cc !== 'string') return [];
  return cc
    .split(/[;,]/)
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}
