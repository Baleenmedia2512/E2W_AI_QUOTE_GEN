import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import nodemailer from 'npm:nodemailer@^9';

const SMTP_HOST = Deno.env.get('SMTP_HOST');
const SMTP_PORT = Deno.env.get('SMTP_PORT') ? parseInt(Deno.env.get('SMTP_PORT')!, 10) : undefined;
const SMTP_USER = Deno.env.get('SMTP_USER');
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD');
const SMTP_FROM = Deno.env.get('SMTP_FROM');
const SMTP_SECURE = Deno.env.get('SMTP_SECURE') === 'true';

const INTERNAL_QUOTE_EMAIL_1 = Deno.env.get('INTERNAL_QUOTE_EMAIL_1');
const INTERNAL_QUOTE_EMAIL_2 = Deno.env.get('INTERNAL_QUOTE_EMAIL_2');
const INTERNAL_QUOTE_EMAIL_3 = Deno.env.get('INTERNAL_QUOTE_EMAIL_3');

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

function getRecipients(): string[] {
  return [INTERNAL_QUOTE_EMAIL_1, INTERNAL_QUOTE_EMAIL_2, INTERNAL_QUOTE_EMAIL_3].filter(Boolean) as string[];
}

function validateSmtpConfig(): string | null {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    return 'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM secrets.';
  }
  return null;
}

const BRAND_COLOR = '#750926';
const BRAND_COLOR_DARK = '#5a071e';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface LogoEmbedResult {
  headerHtml: string;
  inlineAttachment?: {
    filename: string;
    content: string;
    encoding: 'base64';
    cid: string;
    contentType: string;
  };
}

function buildLogoEmbed(companyName: string, companyLogo?: string): LogoEmbedResult {
  const safeCompanyName = escapeHtml(companyName);

  if (!companyLogo) {
    return {
      headerHtml: `
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">
          ${safeCompanyName}
        </p>
      `,
    };
  }

  const dataUrlMatch = companyLogo.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const [, contentType, base64Content] = dataUrlMatch;
    const extension = contentType.includes('png') ? 'png' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';

    return {
      headerHtml: `
        <img
          src="cid:company-logo"
          alt="${safeCompanyName}"
          width="180"
          style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:180px;height:auto;"
        />
      `,
      inlineAttachment: {
        filename: `company-logo.${extension}`,
        content: base64Content,
        encoding: 'base64',
        cid: 'company-logo',
        contentType,
      },
    };
  }

  if (companyLogo.startsWith('http://') || companyLogo.startsWith('https://')) {
    return {
      headerHtml: `
        <img
          src="${escapeHtml(companyLogo)}"
          alt="${safeCompanyName}"
          width="180"
          style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:180px;height:auto;"
        />
      `,
    };
  }

  return {
    headerHtml: `
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">
        ${safeCompanyName}
      </p>
    `,
  };
}

function buildCallClientSection(clientName: string, clientPhoneNumber?: string): string {
  const safeClientName = escapeHtml(clientName);

  if (!clientPhoneNumber) {
    return `
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0 8px 0;">
        <tr>
          <td align="center" style="padding:24px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
            <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;">
              Client Contact
            </p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#1e293b;">
              ${safeClientName}
            </p>
            <p style="margin:8px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#64748b;">
              Phone number not provided
            </p>
          </td>
        </tr>
      </table>
    `;
  }

  const normalizedPhone = clientPhoneNumber.replace(/[^\d+]/g, '');
  const displayPhone = escapeHtml(clientPhoneNumber);

  return `
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0 8px 0;">
      <tr>
        <td align="center">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-radius:14px;overflow:hidden;">
            <tr>
              <td align="center" bgcolor="${BRAND_COLOR}" style="background:${BRAND_COLOR};padding:0;">
                <a
                  href="tel:${normalizedPhone}"
                  style="display:block;padding:22px 36px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;"
                >
                  <span style="display:block;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:0.9;margin-bottom:10px;">
                    Call Client Now
                  </span>
                  <span style="display:block;font-size:30px;font-weight:700;line-height:1.1;margin-bottom:8px;">
                    ${displayPhone}
                  </span>
                  <span style="display:block;font-size:16px;font-weight:500;opacity:0.95;">
                    ${safeClientName}
                  </span>
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildDetailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.6px;border-bottom:1px solid #eef2f7;width:38%;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:#1e293b;border-bottom:1px solid #eef2f7;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `;
}

function buildAttachmentsSection(filenames: string[]): string {
  const attachmentLabel = filenames.length > 1 ? 'Attachments' : 'Attachment';
  const attachmentDescription =
    filenames.length > 1
      ? `${filenames.length} quote PDFs are attached to this email.`
      : 'The quote PDF is attached to this email.';

  const fileRows = filenames
    .map(
      (name) => `
        <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:#7c2d12;">
          ${escapeHtml(name)}
        </p>
      `,
    )
    .join('');

  return `
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#9a3412;letter-spacing:0.8px;text-transform:uppercase;">
            ${attachmentLabel}
          </p>
          ${fileRows}
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#9a3412;">
            ${attachmentDescription}
          </p>
        </td>
      </tr>
    </table>
  `;
}

function buildEmailHtml(params: {
  emailSubject: string;
  companyName: string;
  logoHeaderHtml: string;
  clientName: string;
  clientPhoneNumber?: string;
  quoteNumber: string;
  downloadedBy: string;
  date?: string;
  filenames: string[];
}): string {
  const {
    emailSubject,
    companyName,
    logoHeaderHtml,
    clientName,
    clientPhoneNumber,
    quoteNumber,
    downloadedBy,
    date,
    filenames,
  } = params;

  const displayDate = date || new Date().toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });

  const callClientSection = buildCallClientSection(clientName, clientPhoneNumber);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <title>${escapeHtml(emailSubject)}</title>
    </head>
    <body style="margin:0;padding:0;background-color:#edf2f7;">
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#edf2f7;padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
              <tr>
                <td align="center" bgcolor="${BRAND_COLOR_DARK}" style="background:${BRAND_COLOR_DARK};padding:28px 24px 22px 24px;">
                  ${logoHeaderHtml}
                  <p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#f8fafc;letter-spacing:1.4px;text-transform:uppercase;opacity:0.92;">
                    Quote Download Alert
                  </p>
                </td>
              </tr>

              <tr>
                <td style="padding:32px 28px 8px 28px;">
                  <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;color:#0f172a;line-height:1.3;">
                    New quote downloaded
                  </p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#475569;">
                    ${filenames.length > 1
                      ? 'Executive summary quote PDFs were downloaded from Quote Buddy. Review the details below and follow up with the client.'
                      : 'A quotation PDF was downloaded from Quote Buddy. Review the details below and follow up with the client.'}
                  </p>
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px;">
                  ${callClientSection}
                </td>
              </tr>

              <tr>
                <td style="padding:8px 28px 0 28px;">
                  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                    ${buildDetailRow('Quote Number', quoteNumber)}
                    ${buildDetailRow('Client Name', clientName)}
                    ${buildDetailRow('Downloaded By', downloadedBy)}
                    ${buildDetailRow('Date', displayDate)}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:24px 28px 32px 28px;">
                  ${buildAttachmentsSection(filenames)}
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:0 28px 24px 28px;">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#94a3b8;">
                    Sent automatically by Quote Buddy &bull; ${escapeHtml(companyName)}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  try {
    const smtpConfigError = validateSmtpConfig();
    if (smtpConfigError) {
      return jsonResponse({ error: smtpConfigError }, 500);
    }

    const recipients = getRecipients();
    if (recipients.length === 0) {
      return jsonResponse({ error: 'No internal quote email recipients configured' }, 500);
    }

    const body = await req.json();
    const {
      pdfAttachments,
      base64Pdf,
      filename,
      quoteNumber,
      clientName,
      clientPhoneNumber,
      downloadedBy,
      companyName,
      companyLogo,
      date,
    } = body;

    const resolvedPdfAttachments: Array<{ base64Pdf: string; filename: string }> = Array.isArray(pdfAttachments) &&
        pdfAttachments.length > 0
      ? pdfAttachments
      : base64Pdf && filename
      ? [{ base64Pdf, filename }]
      : [];

    if (
      !resolvedPdfAttachments.length ||
      resolvedPdfAttachments.some((attachment) => !attachment.base64Pdf || !attachment.filename) ||
      !quoteNumber ||
      !clientName ||
      !downloadedBy ||
      !companyName
    ) {
      return jsonResponse({ error: 'Missing required fields in request body' }, 400);
    }

    const filenames = resolvedPdfAttachments.map((attachment) => attachment.filename);

    const emailSubject = `New Quote Downloaded - ${quoteNumber}`;
    const logoEmbed = buildLogoEmbed(companyName, companyLogo);
    const emailHtml = buildEmailHtml({
      emailSubject,
      companyName,
      logoHeaderHtml: logoEmbed.headerHtml,
      clientName,
      clientPhoneNumber,
      quoteNumber,
      downloadedBy,
      date,
      filenames,
    });

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE || SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
    });

    const attachments: Array<Record<string, unknown>> = resolvedPdfAttachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.base64Pdf,
      encoding: 'base64',
      contentType: 'application/pdf',
    }));

    if (logoEmbed.inlineAttachment) {
      attachments.push(logoEmbed.inlineAttachment);
    }

    await transporter.sendMail({
      from: SMTP_FROM,
      to: recipients,
      subject: emailSubject,
      html: emailHtml,
      attachments,
    });

    return jsonResponse({ success: true, message: 'Email sent successfully.' }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Edge Function error:', error);
    if (error instanceof Error && error.stack) {
      console.error('Error stack:', error.stack);
    }

    const smtpPortHint =
      SMTP_PORT && [25, 465, 587].includes(SMTP_PORT)
        ? ' Supabase Edge Functions may block SMTP ports 25, 465, and 587. Ask your email provider for an alternate port such as 2525 or 2587.'
        : '';

    return jsonResponse(
      {
        success: false,
        error: `${message}.${smtpPortHint}`.trim(),
      },
      500,
    );
  }
});
