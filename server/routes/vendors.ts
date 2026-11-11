import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { readBearer, verifySessionToken } from '../lib/session';

const router = Router();

router.get('/', async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const rows = await prisma.vendors.findMany({
      orderBy: { name: 'asc' },
    });
    return res.json({ data: rows });
  } catch (error) {
    console.error('vendors list error:', error);
    return res.status(500).json({ error: 'Failed to load vendors' });
  }
});

router.get('/rates', async (req, res) => {
  try {
    const preferredOnly = String(req.query.preferred || '1') !== '0';
    const rows = preferredOnly
      ? await prisma.vendor_rate_chunks.findMany({
          where: { preferred_vendor_rank: 1 },
        })
      : await prisma.vendor_rate_chunks.findMany();

    // Fallback: if preferred filter empty, return all (client still filters).
    const data =
      preferredOnly && rows.length === 0
        ? await prisma.vendor_rate_chunks.findMany()
        : rows;

    return res.json({ data });
  } catch (error) {
    console.error('vendor rates error:', error);
    return res.status(500).json({ error: 'Failed to load vendor rates', data: [] });
  }
});

export default router;
