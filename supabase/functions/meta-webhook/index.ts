/**
 * Meta Business Messaging Webhook — Supabase Edge Function
 *
 * Handles three Meta platforms through a single endpoint:
 *   - Instagram Direct Messages  (object: "instagram")
 *   - Facebook Messenger         (object: "page")
 *   - WhatsApp Business Cloud    (object: "whatsapp_business_account")
 *
 * Required Edge Function secrets (set via `supabase secrets set`):
 *   META_WEBHOOK_VERIFY_TOKEN  — random string, also entered in Meta Developer Console
 *   META_APP_SECRET            — from Meta App Dashboard → App Secret
 *
 * Auto-injected by Supabase:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   META_REALTIME_CHANNEL      — defaults to "meta:notifications:v1"
 *   META_ENABLED_PLATFORMS     — comma-separated allow-list, e.g. "instagram,whatsapp"
 *                                 omit or set to "*" to allow all platforms
 */

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// ─── Types ────────────────────────────────────────────────────────────────────

interface NormalizedNotification {
  platform: 'instagram' | 'facebook' | 'whatsapp';
  senderId: string;
  senderName: string;
  messageText: string;
  timestamp: number;
  messageId: string;
}

// ─── In-memory deduplication ──────────────────────────────────────────────────
// Prevents duplicate events within a single Edge Function instance lifetime.
// Meta may deliver the same webhook event more than once on retry.

const processedMessageIds = new Set<string>();
const MAX_DEDUP_SIZE = 500;

function isDuplicate(messageId: string): boolean {
  if (processedMessageIds.has(messageId)) return true;

  if (processedMessageIds.size >= MAX_DEDUP_SIZE) {
    // Evict the oldest entry (insertion order)
    const oldest = processedMessageIds.values().next().value as string;
    processedMessageIds.delete(oldest);
  }

  processedMessageIds.add(messageId);
  return false;
}

// ─── HMAC-SHA256 Signature Validation ────────────────────────────────────────

async function validateHmacSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(rawBody),
  );

  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const expected = `sha256=${computedHex}`;

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Replay Attack Protection ─────────────────────────────────────────────────
// Rejects webhooks whose embedded timestamp is older than 5 minutes.

function isReplayAttack(timestampMs: number): boolean {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return timestampMs < fiveMinutesAgo;
}

// ─── Payload Normalization ────────────────────────────────────────────────────

function normalizeMetaPayload(payload: Record<string, unknown>): NormalizedNotification | null {
  const { object, entry } = payload as {
    object: string;
    entry: Record<string, unknown>[];
  };

  if (!Array.isArray(entry) || entry.length === 0) return null;

  // ── Instagram DM or Facebook Messenger ──────────────────────────────────────
  if (object === 'instagram' || object === 'page') {
    const platform = object === 'instagram' ? 'instagram' : 'facebook';

    for (const e of entry as Array<{ messaging?: unknown[] }>) {
      const messaging = e.messaging;
      if (!Array.isArray(messaging) || messaging.length === 0) continue;

      const msg = messaging[0] as {
        sender: { id: string };
        timestamp: number;
        message?: { mid: string; text?: string };
      };

      if (!msg.message?.text) continue;

      const messageId = msg.message.mid;

      if (isReplayAttack(msg.timestamp)) {
        console.warn(`⏰ Replay attack rejected (${platform}): timestamp too old`);
        return null;
      }

      if (isDuplicate(messageId)) {
        console.warn(`♻️ Duplicate message ignored: ${messageId}`);
        return null;
      }

      return {
        platform,
        senderId: msg.sender.id,
        senderName: `User ${msg.sender.id.slice(-4)}`,
        messageText: msg.message.text,
        timestamp: msg.timestamp,
        messageId,
      };
    }
  }

  // ── WhatsApp Business Cloud API ──────────────────────────────────────────────
  if (object === 'whatsapp_business_account') {
    for (const e of entry as Array<{ changes?: unknown[] }>) {
      const changes = e.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes as Array<{ field: string; value: Record<string, unknown> }>) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value.messages as Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          type: string;
        }> | undefined;

        const contacts = value.contacts as Array<{
          wa_id: string;
          profile: { name: string };
        }> | undefined;

        if (!Array.isArray(messages)) continue;

        for (const msg of messages) {
          if (msg.type !== 'text' || !msg.text?.body) continue;

          const timestampMs = parseInt(msg.timestamp, 10) * 1000;
          const messageId = msg.id;

          if (isReplayAttack(timestampMs)) {
            console.warn(`⏰ Replay attack rejected (whatsapp): timestamp too old`);
            return null;
          }

          if (isDuplicate(messageId)) {
            console.warn(`♻️ Duplicate message ignored: ${messageId}`);
            return null;
          }

          const contact = contacts?.find((c) => c.wa_id === msg.from);

          return {
            platform: 'whatsapp',
            senderId: msg.from,
            senderName: contact?.profile?.name ?? `+${msg.from}`,
            messageText: msg.text.body,
            timestamp: timestampMs,
            messageId,
          };
        }
      }
    }
  }

  return null;
}

// ─── Supabase Realtime Broadcast ──────────────────────────────────────────────
// Uses the Realtime REST API instead of a WebSocket to avoid connection
// overhead inside a short-lived Edge Function invocation.

async function broadcastToRealtime(notification: NormalizedNotification): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return;
  }

  const channelName =
    Deno.env.get('META_REALTIME_CHANNEL') ?? 'meta:notifications:v1';

  const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: channelName,
          event: 'new_message',
          payload: notification,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ Realtime broadcast failed [${res.status}]: ${body}`);
  } else {
    console.log(
      `✅ Broadcast sent → channel "${channelName}" | ${notification.platform} | from ${notification.senderName}`,
    );
  }
}

// ─── Platform Allow-List ──────────────────────────────────────────────────────

function isPlatformEnabled(platform: string): boolean {
  const raw = Deno.env.get('META_ENABLED_PLATFORMS') ?? '*';
  if (raw === '*') return true;
  return raw.split(',').map((p) => p.trim()).includes(platform);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-hub-signature-256',
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // ── GET: Meta webhook verification challenge ─────────────────────────────────
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN');

    if (!verifyToken) {
      console.error('❌ META_WEBHOOK_VERIFY_TOKEN secret not set');
      return new Response('Server misconfiguration', { status: 500, headers: corsHeaders });
    }

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      console.log('✅ Meta webhook verification successful');
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }

    console.warn('❌ Meta webhook verification failed — token mismatch or missing params');
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }

  // ── POST: Receive webhook events ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const rawBody = await req.text();

    // Validate X-Hub-Signature-256 when META_APP_SECRET is configured
    const appSecret = Deno.env.get('META_APP_SECRET');
    if (appSecret) {
      const signature = req.headers.get('x-hub-signature-256');
      if (!signature) {
        console.error('❌ Missing X-Hub-Signature-256 header');
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      const isValid = await validateHmacSignature(rawBody, signature, appSecret);
      if (!isValid) {
        console.error('❌ Webhook signature validation failed');
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
    } else {
      console.warn('⚠️ META_APP_SECRET not set — skipping signature validation (not safe for production)');
    }

    // Parse body
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('Bad Request: invalid JSON', { status: 400, headers: corsHeaders });
    }

    // Normalize across all platforms
    const normalized = normalizeMetaPayload(payload);

    if (normalized) {
      if (!isPlatformEnabled(normalized.platform)) {
        console.log(`ℹ️ Platform "${normalized.platform}" is disabled via META_ENABLED_PLATFORMS`);
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      console.log(
        `📨 ${normalized.platform.toUpperCase()} message from "${normalized.senderName}": "${normalized.messageText.slice(0, 60)}..."`,
      );

      // Broadcast asynchronously — respond 200 immediately so Meta doesn't retry
      const broadcastPromise = broadcastToRealtime(normalized);

      try {
        // EdgeRuntime.waitUntil keeps the promise alive after the response is sent
        EdgeRuntime.waitUntil(broadcastPromise);
      } catch {
        // Fallback for local development where EdgeRuntime may not be available
        broadcastPromise.catch((e) => console.error('Broadcast error:', e));
      }
    } else {
      console.log('ℹ️ No actionable message in payload (non-text, duplicate, or replay)');
    }

    // Always return 200 to prevent Meta from retrying
    return new Response('OK', { status: 200, headers: corsHeaders });
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
});
