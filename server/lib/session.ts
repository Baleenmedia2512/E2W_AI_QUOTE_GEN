import crypto from 'crypto';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function authSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.AUTH_SESSION_SECRET || '';
  if (!secret) throw new Error('AUTH_SECRET is not configured.');
  return secret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payloadPart: string): string {
  return crypto
    .createHmac('sha256', authSecret())
    .update(payloadPart)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function createSessionToken(user: { id: string; email: string }): string {
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email.trim().toLowerCase(),
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }),
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
): { sub: string; email: string } | null {
  if (!token) return null;
  const raw = token.replace(/^Bearer\s+/i, '').trim();
  const [payloadPart, signature] = raw.split('.');
  if (!payloadPart || !signature) return null;
  try {
    const expected = sign(payloadPart);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(base64UrlDecode(payloadPart)) as {
      sub?: unknown;
      email?: unknown;
      exp?: unknown;
    };
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const exp = Number(payload.exp);
    if (!sub || !email || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { sub, email };
  } catch {
    return null;
  }
}

export function readBearer(req: { headers: { authorization?: string } }): string | null {
  const authorization = req.headers.authorization || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}
