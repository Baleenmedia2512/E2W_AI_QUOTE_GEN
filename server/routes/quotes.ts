import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { readBearer, verifySessionToken } from '../lib/session';

const router = Router();

const START_NUMBER = 10001;
const LEGACY_TIMESTAMP_FLOOR = 900000;

function parseQuoteSeq(quoteNumber: string | null | undefined): number | null {
  const m = String(quoteNumber || '')
    .trim()
    .toUpperCase()
    .match(/^QT-(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function isSequentialCandidate(n: number): boolean {
  return n >= START_NUMBER && n < LEGACY_TIMESTAMP_FLOOR;
}

router.get('/numbers/max', async (_req, res) => {
  try {
    const rows = await prisma.quotedownload.findMany({
      select: { quoteNumber: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    let dbMax = START_NUMBER - 1;
    for (const row of rows) {
      const n = parseQuoteSeq(row.quoteNumber);
      if (n != null && isSequentialCandidate(n) && n > dbMax) dbMax = n;
    }
    return res.json({ max: dbMax });
  } catch (error) {
    console.error('quote max error:', error);
    return res.json({ max: START_NUMBER - 1 });
  }
});

router.get('/numbers/issued', async (req, res) => {
  const qn = String(req.query.quoteNumber || '').trim();
  if (!qn) return res.json({ issued: false });
  try {
    const row = await prisma.quotedownload.findFirst({
      where: { quoteNumber: qn },
      select: { id: true },
    });
    return res.json({ issued: !!row });
  } catch {
    return res.json({ issued: false });
  }
});

router.post('/downloads', async (req, res) => {
  try {
    const leadId = String(req.body?.leadId || '').trim();
    const quoteNumber = String(req.body?.quoteNumber || '').trim();
    if (!leadId || !quoteNumber) {
      return res.status(400).json({ error: 'leadId and quoteNumber required' });
    }

    const existing = await prisma.quotedownload.findFirst({
      where: { quoteNumber },
    });
    if (existing) return res.json({ data: existing });

    const data = await prisma.quotedownload.create({
      data: {
        id: randomUUID(),
        leadId,
        quoteNumber,
        createdAt: new Date(),
      },
    });
    return res.json({ data });
  } catch (error) {
    console.error('quote download record error:', error);
    return res.status(500).json({ error: 'Failed to record quote download' });
  }
});

router.post('/push-baleen', async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  if (!session) {
    return res.status(401).json({ error: 'Session invalid or expired. Log in again, then retry.' });
  }

  const QUOTE_BUDDY_API_KEY = process.env.QUOTE_BUDDY_API_KEY || '';
  const BALEEN_MEDIA_URL = (process.env.BALEEN_MEDIA_URL || '').replace(/\/$/, '');
  if (!QUOTE_BUDDY_API_KEY || !BALEEN_MEDIA_URL) {
    return res.status(500).json({
      error:
        'Baleen Media is not configured. Set QUOTE_BUDDY_API_KEY and BALEEN_MEDIA_URL.',
    });
  }

  try {
    const payload = req.body;
    if (!payload?.quoteId || !Array.isArray(payload?.lines) || !payload.lines.length) {
      return res.status(400).json({ error: 'Invalid quote payload (quoteId and lines required).' });
    }

    const inboxUrl = `${BALEEN_MEDIA_URL}/api/integrations/quote-buddy/inbox`;
    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QUOTE_BUDDY_API_KEY}`,
    };
    if (/ngrok/i.test(BALEEN_MEDIA_URL)) {
      upstreamHeaders['ngrok-skip-browser-warning'] = 'true';
    }

    const upstream = await fetch(inboxUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    if (!upstream.ok) {
      const detail =
        (typeof parsed.error === 'string' && parsed.error)
        || (typeof parsed.message === 'string' && parsed.message)
        || text.slice(0, 240)
        || `Baleen Media returned HTTP ${upstream.status}`;
      return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({
        error: detail,
      });
    }

    const id = parsed.id == null || parsed.id === '' ? '' : String(parsed.id);
    if (!id) return res.status(502).json({ error: 'Baleen Media response missing id.' });

    return res.json({
      ok: true,
      success: true,
      id,
      openUrl: `${BALEEN_MEDIA_URL}/orders/from-quote?id=${encodeURIComponent(id)}`,
      message: 'Sent to Baleen Media.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('push-baleen error:', error);
    return res.status(500).json({ error: message });
  }
});

export default router;
