import { NextRequest, NextResponse } from 'next/server';
import { sessionFromRequest } from '@lib/httpAuth';

/** POST /api/quotes/push-baleen — parity with Express (HTML upstream sanitization included) */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Session invalid or expired. Log in again, then retry.' },
      { status: 401 },
    );
  }

  const QUOTE_BUDDY_API_KEY = process.env.QUOTE_BUDDY_API_KEY || '';
  const BALEEN_MEDIA_URL = (process.env.BALEEN_MEDIA_URL || '').replace(/\/$/, '');
  if (!QUOTE_BUDDY_API_KEY || !BALEEN_MEDIA_URL) {
    return NextResponse.json(
      {
        error:
          'Baleen Media is not configured. Set QUOTE_BUDDY_API_KEY and BALEEN_MEDIA_URL.',
      },
      { status: 500 },
    );
  }

  try {
    const payload = (await req.json().catch(() => null)) as {
      quoteId?: unknown;
      lines?: unknown;
    } | null;
    if (!payload?.quoteId || !Array.isArray(payload?.lines) || !payload.lines.length) {
      return NextResponse.json(
        { error: 'Invalid quote payload (quoteId and lines required).' },
        { status: 400 },
      );
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
      const looksLikeHtml = /^\s*</.test(text) || /<!DOCTYPE/i.test(text);
      const detail =
        (typeof parsed.error === 'string' && parsed.error)
        || (typeof parsed.message === 'string' && parsed.message)
        || (looksLikeHtml
          ? `Baleen Media returned HTTP ${upstream.status} (HTML page — check BALEEN_MEDIA_URL, expected …/api/integrations/quote-buddy/inbox).`
          : (text.slice(0, 240) || `Baleen Media returned HTTP ${upstream.status}`));
      return NextResponse.json(
        { error: detail },
        { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
      );
    }

    const id = parsed.id == null || parsed.id === '' ? '' : String(parsed.id);
    if (!id) {
      return NextResponse.json({ error: 'Baleen Media response missing id.' }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      success: true,
      id,
      openUrl: `${BALEEN_MEDIA_URL}/orders/from-quote?id=${encodeURIComponent(id)}`,
      message: 'Sent to Baleen Media.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('push-baleen error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
