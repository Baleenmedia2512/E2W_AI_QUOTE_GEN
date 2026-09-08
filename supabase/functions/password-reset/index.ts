import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import bcrypt from 'npm:bcryptjs@^3.0.3';
import nodemailer from 'npm:nodemailer@^9';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SMTP_HOST = Deno.env.get('SMTP_HOST');
const SMTP_PORT = Deno.env.get('SMTP_PORT') ? parseInt(Deno.env.get('SMTP_PORT')!, 10) : undefined;
const SMTP_USER = Deno.env.get('SMTP_USER');
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD');
const SMTP_FROM = Deno.env.get('SMTP_FROM');
const SMTP_SECURE = Deno.env.get('SMTP_SECURE') === 'true';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const PASSWORD_RESET_TOKEN_SECRET =
  Deno.env.get('PASSWORD_RESET_TOKEN_SECRET') || SUPABASE_SERVICE_ROLE_KEY || '';

const OTP_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MINUTES = 15;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidOtp(otp: string): boolean {
  return /^\d{4}$/.test(otp);
}

function isValidPassword(password: string): boolean {
  return typeof password === 'string' && password.trim().length >= 8;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSign(message: string): Promise<string> {
  if (!PASSWORD_RESET_TOKEN_SECRET) {
    throw new Error('Password reset token secret is not configured.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PASSWORD_RESET_TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function hmacVerify(message: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(message);
  return expected === signature;
}

function generateOtp(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const number = bytes[0] * 256 + bytes[1];
  return String(number % 10000).padStart(4, '0');
}

function getMailer() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    throw new Error('SMTP is not configured for password reset emails.');
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE || SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
  });
}

function buildOtpEmail(otp: string): { subject: string; html: string; text: string } {
  return {
    subject: 'Quote Buddy password reset OTP',
    text: `Your Quote Buddy password reset code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes and can be used only once.`,
    html: `
      <div style="margin:0;padding:0;background:#f7f7f8;font-family:Arial,Helvetica,sans-serif;">
        <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;padding:32px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="font-size:18px;font-weight:700;color:#1f2937;letter-spacing:-0.02em;">Quote Buddy</div>
              <div style="font-size:13px;color:#6b7280;margin-top:6px;">Password Reset OTP</div>
            </div>
            <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#374151;">
              Use the one-time code below to continue resetting your password.
            </p>
            <div style="text-align:center;background:#fff1f4;border:1px solid #f8c7d1;border-radius:16px;padding:20px 16px;margin:0 0 20px 0;">
              <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#c91f3d;">${otp}</div>
            </div>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
              This code expires in ${OTP_TTL_MINUTES} minutes and can only be used once.
            </p>
          </div>
        </div>
      </div>
    `,
  };
}

async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const transporter = getMailer();
  const content = buildOtpEmail(otp);

  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

async function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service role credentials are missing.');
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

type SupabaseClientType = Awaited<ReturnType<typeof getSupabaseClient>>;

async function getLatestOtpRequest(supabase: SupabaseClientType, email: string) {
  const { data, error } = await supabase
    .from('OtpRequest')
    .select('id, email, hashedOtp, expiresAt, attempts, used, createdAt')
    .ilike('email', email)
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getRecentRequestCount(supabase: SupabaseClientType, email: string): Promise<number> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('OtpRequest')
    .select('id', { count: 'exact', head: true })
    .ilike('email', email)
    .gte('createdAt', hourAgo);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function findUserByEmail(supabase: SupabaseClientType, email: string) {
  const { data: user, error } = await supabase
    .from('User')
    .select('id, email, password, isActive')
    .ilike('email', email)
    .single();

  if (error || !user) {
    return null;
  }

  return user;
}

async function handleRequestOtp(
  supabase: SupabaseClientType,
  body: Record<string, unknown>,
  request: Request,
): Promise<Response> {
  const email = normalizeEmail(String(body?.email || ''));

  if (!isValidEmail(email)) {
    return jsonResponse({ success: false, message: 'Please enter a valid email address.' }, 400);
  }

  const user = await findUserByEmail(supabase, email);
  if (!user) {
    return jsonResponse(
      { success: false, message: 'No account found with this email address.' },
      404,
    );
  }

  const recentCount = await getRecentRequestCount(supabase, email);
  if (recentCount >= MAX_REQUESTS_PER_HOUR) {
    return jsonResponse(
      { success: false, message: 'Too many OTP requests. Please try again later.' },
      429,
    );
  }

  const latestRequest = await getLatestOtpRequest(supabase, email);
  if (latestRequest?.createdAt) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(latestRequest.createdAt).getTime()) / 1000);
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      return jsonResponse(
        {
          success: false,
          message: `Please wait ${RESEND_COOLDOWN_SECONDS - elapsedSeconds} seconds before requesting another OTP.`,
        },
        429,
      );
    }
  }

  const otp = generateOtp();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const now = new Date().toISOString();
  const otpRequestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
  const ipAddress = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || null;
  const userAgent = request.headers.get('user-agent') || null;

  const { error: insertError } = await supabase.from('OtpRequest').insert({
    id: otpRequestId,
    email,
    hashedOtp,
    expiresAt,
    attempts: 0,
    used: false,
    createdAt: now,
    ipAddress,
    userAgent,
  });

  if (insertError) {
    throw insertError;
  }

  await sendOtpEmail(email, otp);

  return jsonResponse(
    {
      success: true,
      message: 'OTP sent to your registered email address.',
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
      verifyAttemptsRemaining: MAX_VERIFY_ATTEMPTS,
      expiresInMinutes: OTP_TTL_MINUTES,
    },
    200,
  );
}

async function handleVerifyOtp(
  supabase: SupabaseClientType,
  body: Record<string, unknown>,
): Promise<Response> {
  const email = normalizeEmail(String(body?.email || ''));
  const otp = String(body?.otp || '').trim();

  if (!isValidEmail(email)) {
    return jsonResponse({ success: false, message: 'Please enter a valid email address.' }, 400);
  }

  if (!isValidOtp(otp)) {
    return jsonResponse({ success: false, message: 'The OTP must be exactly 4 digits.' }, 400);
  }

  const otpRequest = await getLatestOtpRequest(supabase, email);
  if (!otpRequest) {
    return jsonResponse({ success: false, message: 'No active OTP was found. Please request a new one.' }, 404);
  }

  if (otpRequest.used) {
    return jsonResponse({ success: false, message: 'This OTP has already been used. Please request a new one.' }, 410);
  }

  if (new Date(otpRequest.expiresAt).getTime() <= Date.now()) {
    return jsonResponse({ success: false, message: 'This OTP has expired. Please request a new one.' }, 410);
  }

  if (Number(otpRequest.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    return jsonResponse(
      { success: false, message: 'Too many incorrect attempts. Please request a new OTP.' },
      429,
    );
  }

  const isValid = await bcrypt.compare(otp, otpRequest.hashedOtp);
  if (!isValid) {
    const nextAttempts = Number(otpRequest.attempts || 0) + 1;
    const lockOut = nextAttempts >= MAX_VERIFY_ATTEMPTS;

    await supabase
      .from('OtpRequest')
      .update({
        attempts: nextAttempts,
        used: lockOut ? true : otpRequest.used,
      })
      .eq('id', otpRequest.id);

    const attemptsLeft = Math.max(0, MAX_VERIFY_ATTEMPTS - nextAttempts);
    return jsonResponse(
      {
        success: false,
        message: attemptsLeft > 0
          ? `Invalid OTP. You have ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`
          : 'Too many incorrect attempts. Please request a new OTP.',
        verifyAttemptsRemaining: attemptsLeft,
      },
      attemptsLeft > 0 ? 400 : 429,
    );
  }

  const verifyAttempts = Number(otpRequest.attempts || 0);
  const resetTokenPayload = {
    kind: 'password_reset',
    email,
    requestId: otpRequest.id,
    attempts: verifyAttempts,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_MINUTES * 60,
  };
  const payloadJson = JSON.stringify(resetTokenPayload);
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(payloadJson));
  const signature = await hmacSign(payloadB64);
  const resetToken = `${payloadB64}.${signature}`;

  const { error: updateError } = await supabase
    .from('OtpRequest')
    .update({
      used: true,
    })
    .eq('id', otpRequest.id);

  if (updateError) {
    throw updateError;
  }

  return jsonResponse(
    {
      success: true,
      message: 'OTP verified successfully.',
      resetToken,
      resetTokenExpiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    },
    200,
  );
}

async function verifyResetToken(token: string) {
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) {
    return null;
  }

  const validSignature = await hmacVerify(payloadB64, signature);
  if (!validSignature) {
    return null;
  }

  const payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadB64));
  const payload = JSON.parse(payloadJson) as {
    kind?: string;
    email?: string;
    requestId?: string;
    attempts?: number;
    exp?: number;
  };

  if (payload.kind !== 'password_reset') {
    return null;
  }

  if (!payload.email || !payload.requestId || typeof payload.attempts !== 'number' || typeof payload.exp !== 'number') {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

async function handleResetPassword(
  supabase: SupabaseClientType,
  body: Record<string, unknown>,
): Promise<Response> {
  const email = normalizeEmail(String(body?.email || ''));
  const resetToken = String(body?.resetToken || '').trim();
  const password = String(body?.password || '');
  const confirmPassword = String(body?.confirmPassword || '');

  if (!isValidEmail(email)) {
    return jsonResponse({ success: false, message: 'Please enter a valid email address.' }, 400);
  }

  if (!resetToken) {
    return jsonResponse({ success: false, message: 'Reset token is required.' }, 400);
  }

  if (!isValidPassword(password)) {
    return jsonResponse({ success: false, message: 'Password must be at least 8 characters long.' }, 400);
  }

  if (password !== confirmPassword) {
    return jsonResponse({ success: false, message: 'Passwords do not match.' }, 400);
  }

  const tokenPayload = await verifyResetToken(resetToken);
  if (!tokenPayload || tokenPayload.email !== email) {
    return jsonResponse(
      { success: false, message: 'The reset session is invalid or expired. Please request a new OTP.' },
      401,
    );
  }

  const { data: otpRequest, error: otpRequestError } = await supabase
    .from('OtpRequest')
    .select('id, email, attempts, used, expiresAt')
    .eq('id', tokenPayload.requestId)
    .eq('email', email)
    .maybeSingle();

  if (otpRequestError) {
    throw otpRequestError;
  }

  if (
    !otpRequest
    || !otpRequest.used
    || Number(otpRequest.attempts || 0) !== tokenPayload.attempts
    || new Date(otpRequest.expiresAt).getTime() <= Date.now()
  ) {
    return jsonResponse(
      { success: false, message: 'The reset session is invalid or expired. Please request a new OTP.' },
      401,
    );
  }

  const { data: user, error: userError } = await supabase
    .from('User')
    .select('id, email')
    .eq('email', email)
    .single();

  if (userError || !user) {
    return jsonResponse({ success: false, message: 'No employee account was found for that email.' }, 404);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();

  const { error: updateUserError } = await supabase
    .from('User')
    .update({
      password: hashedPassword,
      updatedAt: now,
    })
    .eq('id', user.id);

  if (updateUserError) {
    throw updateUserError;
  }

  const { error: invalidateTokenError } = await supabase
    .from('OtpRequest')
    .update({
      attempts: Number(otpRequest.attempts || 0) + 1,
      used: true,
    })
    .eq('id', otpRequest.id);

  if (invalidateTokenError) {
    throw invalidateTokenError;
  }

  return jsonResponse(
    {
      success: true,
      message: 'Password reset successfully.',
    },
    200,
  );
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed.' }, 405);
  }

  try {
    const supabase = await getSupabaseClient();
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '');

    if (action === 'request_otp') {
      return await handleRequestOtp(supabase, body, request);
    }

    if (action === 'verify_otp') {
      return await handleVerifyOtp(supabase, body);
    }

    if (action === 'reset_password') {
      return await handleResetPassword(supabase, body);
    }

    return jsonResponse({ success: false, message: 'Invalid action.' }, 400);
  } catch (error: any) {
    console.error('Password reset function failed:', error);
    return jsonResponse(
      {
        success: false,
        message: error?.message || 'Unexpected password reset error.',
      },
      500,
    );
  }
});
