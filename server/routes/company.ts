import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { readBearer, verifySessionToken } from '../lib/session';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const data = await prisma.company_settings.findFirst({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ data });
  } catch (error) {
    console.error('company get error:', error);
    return res.status(500).json({ error: 'Failed to load company settings' });
  }
});

router.put('/', async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const body = req.body || {};
    const existing = await prisma.company_settings.findFirst({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
    });

    const payload = {
      name: body.name || '',
      address: body.address || '',
      gst: body.gst || '',
      abn: body.abn || '',
      phone: body.phone || '',
      email: body.email || '',
      logo: body.logo || '',
      website: body.website || '',
      signature: body.signature || '',
      designation: body.designation || '',
      is_active: true,
      updated_at: new Date(),
    };

    const data = existing
      ? await prisma.company_settings.update({
          where: { id: existing.id },
          data: payload,
        })
      : await prisma.company_settings.create({
          data: {
            id: randomUUID(),
            ...payload,
            created_at: new Date(),
          },
        });

    return res.json({ data });
  } catch (error) {
    console.error('company save error:', error);
    return res.status(500).json({ error: 'Failed to save company settings' });
  }
});

export default router;
