import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/media-proxy?url=… — parity with server/routes/mediaProxy.ts
 * Same-origin image proxy for PDF export / preview prefetch.
 */
const ALLOWED_HOSTS = new Set([
  'rms.baleenmedia.com',
  'www.rms.baleenmedia.com',
  'baleenmedia.com',
  'www.baleenmedia.com',
  'baleenmedia.in',
  'www.baleenmedia.in',
  'wellnessvalley.in',
  'www.wellnessvalley.in',
]);

export async function GET(req: NextRequest) {
  try {
    const raw = (req.nextUrl.searchParams.get('url') || '').trim();
    if (!raw) {
      return NextResponse.json({ error: 'url query required' }, { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    if (!/^https?:$/i.test(target.protocol) || !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
      return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
    }

    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: { Accept: 'image/*,*/*' },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream HTTP ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('media-proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy failed' },
      { status: 502 },
    );
  }
}
