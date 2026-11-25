import { Router } from 'express';

const router = Router();

const ALLOWED_HOSTS = new Set([
  'rms.baleenmedia.com',
  'www.rms.baleenmedia.com',
  'baleenmedia.com',
  'www.baleenmedia.com',
  'baleenmedia.in',
  'www.baleenmedia.in',
  'wellnessvalley.in',
  'www.wellnessvalley.in',
  'wkwrrdcjknvupwsfdjtd.supabase.co',
]);

/**
 * Same-origin image proxy for PDF export / preview prefetch.
 * Browser → /api/media-proxy?url=… → remote CDN (no CORS in the browser).
 */
router.get('/', async (req, res) => {
  try {
    const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!raw) {
      return res.status(400).json({ error: 'url query required' });
    }

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return res.status(400).json({ error: 'Invalid url' });
    }

    if (!/^https?:$/i.test(target.protocol) || !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
      return res.status(403).json({ error: 'Host not allowed' });
    }

    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: { Accept: 'image/*,*/*' },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Upstream HTTP ${upstream.status}`,
      });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('media-proxy error:', error);
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Proxy failed',
    });
  }
});

export default router;
