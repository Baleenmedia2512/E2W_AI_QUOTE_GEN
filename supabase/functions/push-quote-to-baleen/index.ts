import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

/**
 * Server-only bridge: Quote Buddy UI → this Edge Function → Baleen Media inbox.
 * Browser must never call Baleen Media /inbox (CORS + API key exposure).
 */

const AUTH_SESSION_SECRET =
  Deno.env.get('AUTH_SESSION_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const QUOTE_BUDDY_API_KEY = Deno.env.get('QUOTE_BUDDY_API_KEY') || '';
const BALEEN_MEDIA_URL = (Deno.env.get('BALEEN_MEDIA_URL') || '').replace(/\/$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}

async function hmacVerify(message: string, signature: string): Promise<boolean> {
  if (!AUTH_SESSION_SECRET) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(AUTH_SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureBytes = Uint8Array.from(base64UrlDecode(signature), (char) => char.charCodeAt(0));
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(message),
  );
}

async function isAuthenticated(req: Request): Promise<boolean> {
  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) return false;
  try {
    if (!(await hmacVerify(payloadPart, signature))) return false;
    const payload = JSON.parse(base64UrlDecode(payloadPart)) as { exp?: unknown };
    const expiresAt = Number(payload.exp);
    return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

interface BaleenLine {
  serviceId?: unknown;
  medium?: unknown;
  adType?: unknown;
  city?: unknown;
  vendorName?: unknown;
  vendorCostExclGst?: unknown;
  priceInclGst?: unknown;
  qty?: unknown;
  qtyUnit?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePayload(body: Record<string, unknown>): {
  quoteId: string;
  clientName: string;
  mobile: string;
  lines: Array<{
    serviceId: string;
    medium: string;
    adType: string;
    city: string;
    vendorName: string;
    vendorCostExclGst: number;
    priceInclGst: number;
    qty: number;
    qtyUnit: string;
  }>;
} | null {
  const quoteId = asString(body.quoteId);
  const clientName = asString(body.clientName);
  const mobile = asString(body.mobile).replace(/\D/g, '');
  const rawLines = Array.isArray(body.lines) ? body.lines as BaleenLine[] : [];
  if (!quoteId || !rawLines.length) return null;

  const lines = rawLines.map((line) => ({
    serviceId: asString(line.serviceId),
    medium: asString(line.medium),
    adType: asString(line.adType),
    city: asString(line.city),
    vendorName: asString(line.vendorName),
    vendorCostExclGst: asNumber(line.vendorCostExclGst),
    priceInclGst: asNumber(line.priceInclGst),
    qty: asNumber(line.qty),
    qtyUnit: asString(line.qtyUnit),
  }));

  return { quoteId, clientName, mobile, lines };
}

/** Page link only — not the inbox API. */
function buildOpenUrl(id: string): string {
  return `${BALEEN_MEDIA_URL}/orders/from-quote?id=${encodeURIComponent(id)}`;
}

function isNgrokHost(url: string): boolean {
  return /ngrok/i.test(url);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  try {
    if (!(await isAuthenticated(req))) {
      return jsonResponse(
        { error: 'Session invalid or expired. Log in again, then retry.' },
        401,
      );
    }

    if (!QUOTE_BUDDY_API_KEY || !BALEEN_MEDIA_URL) {
      return jsonResponse(
        {
          error:
            'Baleen Media is not configured. Set QUOTE_BUDDY_API_KEY and BALEEN_MEDIA_URL Edge secrets.',
        },
        500,
      );
    }

    const body = await req.json().catch(() => ({}));
    const payload = normalizePayload(body as Record<string, unknown>);
    if (!payload) {
      return jsonResponse({ error: 'Invalid quote payload (quoteId and lines required).' }, 400);
    }

    const inboxUrl = `${BALEEN_MEDIA_URL}/api/integrations/quote-buddy/inbox`;
    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QUOTE_BUDDY_API_KEY}`,
    };
    // Free ngrok interstitial blocks headless fetch without this header.
    if (isNgrokHost(BALEEN_MEDIA_URL)) {
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
      parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      parsed = {};
    }

    if (!upstream.ok) {
      const detail =
        asString(parsed.error)
        || asString(parsed.message)
        || text.slice(0, 240)
        || `Baleen Media returned HTTP ${upstream.status}`;
      console.error('Baleen inbox error:', upstream.status, detail);
      return jsonResponse(
        { error: detail },
        upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      );
    }

    // Baleen returns { ok: true, id: 123 }
    const idRaw = parsed.id;
    const id = idRaw == null || idRaw === '' ? '' : String(idRaw);
    if (!id) {
      return jsonResponse({ error: 'Baleen Media response missing id.' }, 502);
    }

    return jsonResponse({
      ok: true,
      success: true,
      id,
      openUrl: buildOpenUrl(id),
      message: 'Sent to Baleen Media.',
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('push-quote-to-baleen error:', error);
    return jsonResponse({ error: message }, 500);
  }
});
