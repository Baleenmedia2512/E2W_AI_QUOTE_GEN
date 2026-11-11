import { Router } from 'express';
import nodemailer from 'nodemailer';
import { readBearer, verifySessionToken } from '../lib/session';

const router = Router();

function getConfiguredQuoteEmails(): string[] {
  return [
    process.env.INTERNAL_QUOTE_EMAIL_1,
    process.env.INTERNAL_QUOTE_EMAIL_2,
    process.env.INTERNAL_QUOTE_EMAIL_3,
  ].filter(Boolean) as string[];
}

router.post('/', async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Session expired. Please log in again, then retry sending the email.',
    });
  }

  try {
    const body = req.body || {};
    const allowed = getConfiguredQuoteEmails().map((e) => e.trim().toLowerCase());
    if (allowed.length && !allowed.includes(session.email)) {
      return res.status(403).json({
        success: false,
        message: 'Email sending is not enabled for this account.',
      });
    }

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    const from = process.env.SMTP_FROM || user;
    if (!host || !user || !pass || !from) {
      return res.status(500).json({ success: false, message: 'SMTP is not configured on the server.' });
    }

    const attachments = Array.isArray(body.pdfAttachments) ? body.pdfAttachments : [];
    if (!attachments.length) {
      return res.status(400).json({ success: false, message: 'No PDF attachments to send.' });
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });

    const mailAttachments = attachments.map((a: { base64Pdf?: string; filename?: string }, i: number) => ({
      filename: a.filename || `quote-${i + 1}.pdf`,
      content: Buffer.from(String(a.base64Pdf || ''), 'base64'),
      contentType: 'application/pdf',
    }));

    const quoteNumber = String(body.quoteNumber || 'Quote');
    const clientName = String(body.clientName || '');
    const to = session.email;
    const cc = process.env.INTERNAL_QUOTE_CC_EMAIL || undefined;

    await transporter.sendMail({
      from,
      to,
      cc,
      subject: `${quoteNumber} — ${clientName || 'Client'}`.trim(),
      text: [
        `Quote ${quoteNumber}`,
        clientName ? `Client: ${clientName}` : '',
        body.clientPhoneNumber ? `Phone: ${body.clientPhoneNumber}` : '',
        body.downloadedBy ? `Downloaded by: ${body.downloadedBy}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      attachments: mailAttachments,
    });

    return res.json({
      success: true,
      message: 'Quote emailed successfully.',
    });
  } catch (error) {
    console.error('quote email error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send quote email.',
    });
  }
});

export default router;
