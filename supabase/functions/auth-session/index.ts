import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import bcrypt from 'npm:bcryptjs@^3.0.3';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const AUTH_SESSION_SECRET =
  Deno.env.get('AUTH_SESSION_SECRET') || SUPABASE_SERVICE_ROLE_KEY || '';
const INTERNAL_QUOTE_EMAILS = [
  Deno.env.get('INTERNAL_QUOTE_EMAIL_1'),
  Deno.env.get('INTERNAL_QUOTE_EMAIL_2'),
  Deno.env.get('INTERNAL_QUOTE_EMAIL_3'),
].filter(Boolean).map((value) => normalizeEmail(value));
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return base64UrlEncode(binary);
}

async function sign(value: string): Promise<string> {
  if (!AUTH_SESSION_SECRET) throw new Error('AUTH_SESSION_SECRET is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(AUTH_SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function createSession(user: { id: string; email: string }): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.id,
    email: user.email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }));
  return `${payload}.${await sign(payload)}`;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method Not Allowed' }, 405);

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: 'Authentication service is not configured.' }, 500);
    }

    const body = await req.json();
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return jsonResponse({ error: 'Invalid email or password' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: user, error: userError } = await admin
      .from('User')
      .select('*')
      .ilike('email', email)
      .single();

    if (userError || !user || !user.isActive) {
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }

    const passwordHash = user.passwordHash || user.password;
    if (typeof passwordHash !== 'string' || !(await bcrypt.compare(password, passwordHash))) {
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }

    const { data: role, error: roleError } = await admin
      .from('Role')
      .select('*')
      .eq('id', user.roleId)
      .single();
    if (roleError || !role) return jsonResponse({ error: 'Unable to fetch user role' }, 500);

    let permissions: Record<string, boolean> = {};
    if (role.permissions) {
      permissions = typeof role.permissions === 'string'
        ? JSON.parse(role.permissions)
        : role.permissions;
    }

    const authUser = {
      id: user.id,
      email: user.email,
      canSendQuoteEmail: INTERNAL_QUOTE_EMAILS.includes(normalizeEmail(user.email)),
      full_name: user.name,
      phone: user.phone || null,
      profileImage: user.image || null,
      role: { role_name: role.name || 'user', permissions },
    };

    return jsonResponse({ user: authUser, token: await createSession(authUser) }, 200);
  } catch (error) {
    console.error('Auth session error:', error);
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }
});
