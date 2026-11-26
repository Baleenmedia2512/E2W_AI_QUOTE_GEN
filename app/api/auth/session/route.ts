import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@lib/prisma';
import { buildAuthUser } from '@lib/authUser';
import { createSessionToken, readBearer, verifySessionToken } from '@lib/session';

/**
 * POST /api/auth/session — login + refresh.
 * Parity with server/routes/auth.ts (same body, status codes, error strings).
 */
function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : 'login';

    if (action === 'refresh') {
      const authorization = req.headers.get('authorization') || undefined;
      const session = verifySessionToken(readBearer({ headers: { authorization } }));
      if (!session) {
        return NextResponse.json(
          { error: 'Session expired. Please log in again.' },
          { status: 401 },
        );
      }
      const authUser = await buildAuthUser(session.sub);
      if (!authUser) {
        return NextResponse.json(
          { error: 'Session expired. Please log in again.' },
          { status: 401 },
        );
      }
      return NextResponse.json({
        user: authUser,
        token: createSessionToken({
          id: String(authUser.id),
          email: String(authUser.email),
        }),
      });
    }

    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM `user` WHERE LOWER(email) = ? LIMIT 1',
      email,
    );
    const user = rows[0]
      ? await prisma.user.findUnique({ where: { id: rows[0].id } })
      : null;

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const passwordHash = user.password;
    if (typeof passwordHash !== 'string' || !(await bcrypt.compare(password, passwordHash))) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const authUser = await buildAuthUser(user.id);
    if (!authUser) {
      return NextResponse.json({ error: 'Unable to fetch user role' }, { status: 500 });
    }

    return NextResponse.json({
      user: authUser,
      token: createSessionToken({
        id: String(authUser.id),
        email: String(authUser.email),
      }),
    });
  } catch (error) {
    console.error('Auth session error:', error);
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
}
