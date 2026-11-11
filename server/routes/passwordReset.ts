import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';

const router = Router();

const OTP_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MINUTES = 15;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resetSecret(): string {
  return (
    process.env.PASSWORD_RESET_TOKEN_SECRET
    || process.env.AUTH_SECRET
    || process.env.AUTH_SESSION_SECRET
    || ''
  );
}

function sign(message: string): string {
  const secret = resetSecret();
  if (!secret) throw new Error('Password reset token secret is not configured.');
  return crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) {
    throw new Error('SMTP is not configured.');
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
  await transporter.sendMail({
    from,
    to,
    subject: 'Quote Buddy password reset OTP',
    text: `Your OTP is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  });
}

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const action = String(body.action || '');
    const email = normalizeEmail(String(body.email || ''));

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required.' });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email } },
    });

    if (action === 'request_otp') {
      if (!user || !user.isActive) {
        // Do not reveal whether the email exists.
        return res.json({
          success: true,
          message: 'If that email exists, an OTP was sent.',
          expiresInMinutes: OTP_TTL_MINUTES,
          cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        });
      }

      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await prisma.otprequest.count({
        where: { email, createdAt: { gte: since } },
      });
      if (recentCount >= MAX_REQUESTS_PER_HOUR) {
        return res.status(429).json({
          success: false,
          message: 'Too many OTP requests. Try again later.',
        });
      }

      const latest = await prisma.otprequest.findFirst({
        where: { email },
        orderBy: { createdAt: 'desc' },
      });
      if (latest) {
        const elapsed = (Date.now() - latest.createdAt.getTime()) / 1000;
        if (elapsed < RESEND_COOLDOWN_SECONDS) {
          return res.status(429).json({
            success: false,
            message: 'Please wait before requesting another OTP.',
            cooldownSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed),
          });
        }
      }

      const otp = String(Math.floor(1000 + Math.random() * 9000));
      const hashedOtp = await bcrypt.hash(otp, 10);
      await prisma.otprequest.create({
        data: {
          id: randomUUID(),
          email,
          hashedOtp,
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
          attempts: 0,
          used: false,
          createdAt: new Date(),
        },
      });

      await sendOtpEmail(email, otp);
      return res.json({
        success: true,
        message: 'OTP sent.',
        expiresInMinutes: OTP_TTL_MINUTES,
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
      });
    }

    if (action === 'verify_otp') {
      const otp = String(body.otp || '');
      if (!/^\d{4}$/.test(otp)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
      }
      const row = await prisma.otprequest.findFirst({
        where: { email, used: false },
        orderBy: { createdAt: 'desc' },
      });
      if (!row || row.expiresAt.getTime() < Date.now()) {
        return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
      }
      if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
        return res.status(400).json({ success: false, message: 'Too many attempts.' });
      }
      const ok = await bcrypt.compare(otp, row.hashedOtp);
      await prisma.otprequest.update({
        where: { id: row.id },
        data: { attempts: row.attempts + 1, used: ok },
      });
      if (!ok) {
        return res.status(400).json({
          success: false,
          message: 'Incorrect OTP.',
          verifyAttemptsRemaining: Math.max(0, MAX_VERIFY_ATTEMPTS - (row.attempts + 1)),
        });
      }
      const payload = `${email}.${Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000}`;
      const resetToken = `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload)}`;
      return res.json({
        success: true,
        message: 'OTP verified.',
        resetToken,
        resetTokenExpiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      });
    }

    if (action === 'reset_password') {
      const resetToken = String(body.resetToken || '');
      const password = String(body.password || '');
      const confirmPassword = String(body.confirmPassword || '');
      if (!password || password.length < 8 || password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Invalid password confirmation.' });
      }
      const [encoded, signature] = resetToken.split('.');
      if (!encoded || !signature) {
        return res.status(400).json({ success: false, message: 'Invalid reset token.' });
      }
      const payload = Buffer.from(encoded, 'base64url').toString('utf8');
      if (sign(payload) !== signature) {
        return res.status(400).json({ success: false, message: 'Invalid reset token.' });
      }
      const [tokenEmail, expRaw] = payload.split('.');
      if (normalizeEmail(tokenEmail) !== email || Number(expRaw) < Date.now()) {
        return res.status(400).json({ success: false, message: 'Reset token expired.' });
      }
      if (!user) return res.status(400).json({ success: false, message: 'Unable to reset password.' });
      const hash = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hash, updatedAt: new Date() },
      });
      return res.json({ success: true, message: 'Password updated.' });
    }

    return res.status(400).json({ success: false, message: 'Unknown action.' });
  } catch (error) {
    console.error('password-reset error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Password reset failed.',
    });
  }
});

export default router;
