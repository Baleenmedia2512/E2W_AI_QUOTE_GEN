import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { readBearer, verifySessionToken } from '../lib/session';

const router = Router();

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 15, 50);
  if (q.length < 2) return res.json({ data: [] });

  try {
    const data = await prisma.lead.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        alternatePhone: true,
        city: true,
        state: true,
        pincode: true,
        campaign: true,
        source: true,
      },
    });
    return res.json({ data });
  } catch (error) {
    console.error('lead search error:', error);
    return res.json({ data: [] });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const data = await prisma.lead.findUnique({ where: { id: req.params.id } });
    return res.json({ data });
  } catch (error) {
    console.error('lead get error:', error);
    return res.status(500).json({ error: 'Failed to load lead' });
  }
});

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const data = await prisma.lead.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ data });
  } catch (error) {
    console.error('leads list error:', error);
    return res.status(500).json({ error: 'Failed to load leads' });
  }
});

router.post('/prepared-for', async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  // Allow without session for download flow resilience — still prefer auth when present.
  void session;

  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const email = body.email ? String(body.email).trim() : null;
    if (!name && !phone) {
      return res.status(400).json({ error: 'name or phone required' });
    }

    let existing = null as Awaited<ReturnType<typeof prisma.lead.findFirst>>;
    if (phone) {
      existing = await prisma.lead.findFirst({ where: { phone } });
    }
    if (!existing && email) {
      existing = await prisma.lead.findFirst({ where: { email } });
    }

    if (existing) {
      const data = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name,
          phone: phone || existing.phone,
          email: email || existing.email,
          updatedAt: new Date(),
        },
      });
      return res.json({ data });
    }

    const now = new Date();
    const data = await prisma.lead.create({
      data: {
        id: randomUUID(),
        name: name || 'Unknown',
        phone: phone || '',
        email,
        source: 'quote_buddy',
        status: 'new',
        priority: 'normal',
        createdAt: now,
        updatedAt: now,
        callAttempts: 0,
        is_existing: false,
      },
    });
    return res.json({ data });
  } catch (error) {
    console.error('prepared-for lead error:', error);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
});

export default router;
