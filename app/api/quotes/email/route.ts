import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { sessionFromRequest } from '@lib/httpAuth';

function getConfiguredQuoteEmails(): string[] {
  return [
    process.env.INTERNAL_QUOTE_EMAIL_1,
    process.env.INTERNAL_QUOTE_EMAIL_2,
    process.env.INTERNAL_QUOTE_EMAIL_3,
  ].filter(Boolean) as string[];
}

/** POST /api/quotes/email — parity with Express quoteEmail.ts */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      {
        success: false,
        message: 'Session expired. Please log in again, then retry sending the email.',
      },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const allowed = getConfiguredQuoteEmails().map((e) => e.trim().toLowerCase());
    if (allowed.length && !allowed.includes(session.email)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Email sending is not enabled for this account.',
        },
        { status: 403 },
      );
    }

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    const from = process.env.SMTP_FROM || user;
    if (!host || !user || !pass || !from) {
      return NextResponse.json(
        { success: false, message: 'SMTP is not configured on the server.' },
        { status: 500 },
      );
    }

    const attachments = Array.isArray(body.pdfAttachments) ? body.pdfAttachments : [];
    if (!attachments.length) {
      return NextResponse.json(
        { success: false, message: 'No PDF attachments to send.' },
        { status: 400 },
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });

    const mailAttachments = attachments.map(
      (a: { base64Pdf?: string; filename?: string }, i: number) => ({
        filename: a.filename || `quote-${i + 1}.pdf`,
        content: Buffer.from(String(a.base64Pdf || ''), 'base64'),
        contentType: 'application/pdf',
      }),
    );

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

    return NextResponse.json({
      success: true,
      message: 'Quote emailed successfully.',
    });
  } catch (error) {
    console.error('quote email error:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send quote email.',
      },
      { status: 500 },
    );
  }
}
