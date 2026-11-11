import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { buildAuthUser } from '../lib/authUser';
import { createSessionToken, readBearer, verifySessionToken } from '../lib/session';

const router = Router();

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

router.post('/session', async (req, res) => {
  try {
    const body = req.body || {};
    const action = typeof body.action === 'string' ? body.action : 'login';

    if (action === 'refresh') {
      const session = verifySessionToken(readBearer(req));
      if (!session) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      const authUser = await buildAuthUser(session.sub);
      if (!authUser) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      return res.json({
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
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM `user` WHERE LOWER(email) = ? LIMIT 1',
      email,
    );
    const user = rows[0]
      ? await prisma.user.findUnique({ where: { id: rows[0].id } })
      : null;

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordHash = user.password;
    if (typeof passwordHash !== 'string' || !(await bcrypt.compare(password, passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const authUser = await buildAuthUser(user.id);
    if (!authUser) return res.status(500).json({ error: 'Unable to fetch user role' });

    return res.json({
      user: authUser,
      token: createSessionToken({
        id: String(authUser.id),
        email: String(authUser.email),
      }),
    });
  } catch (error) {
    console.error('Auth session error:', error);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
});

export default router;
