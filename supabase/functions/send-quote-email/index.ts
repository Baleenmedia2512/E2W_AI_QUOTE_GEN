import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import nodemailer from 'npm:nodemailer@^9';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@^0.18.5';

const SMTP_HOST = Deno.env.get('SMTP_HOST');
const SMTP_PORT = Deno.env.get('SMTP_PORT') ? parseInt(Deno.env.get('SMTP_PORT')!, 10) : undefined;
const SMTP_USER = Deno.env.get('SMTP_USER');
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD');
const SMTP_FROM = Deno.env.get('SMTP_FROM');
const SMTP_SECURE = Deno.env.get('SMTP_SECURE') === 'true';

const INTERNAL_QUOTE_EMAIL_1 = Deno.env.get('INTERNAL_QUOTE_EMAIL_1');
const INTERNAL_QUOTE_EMAIL_2 = Deno.env.get('INTERNAL_QUOTE_EMAIL_2');
const INTERNAL_QUOTE_EMAIL_3 = Deno.env.get('INTERNAL_QUOTE_EMAIL_3');
const INTERNAL_QUOTE_CC_EMAIL = Deno.env.get('INTERNAL_QUOTE_CC_EMAIL');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

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

const EMAIL_HEADER_BG = '#F8EFCF';
const EMAIL_PAGE_BG = '#F6F7F9';
const EMAIL_CARD_BG = '#FFFFFF';
const EMAIL_GOLD_SOFT = '#E8D39A';
const EMAIL_CALL_BG = '#FFF8E7';
const EMAIL_CALL_ACCENT = '#D8B85A';
const EMAIL_TEXT = '#344054';
const EMAIL_TEXT_MUTED = '#667085';
const EMAIL_BORDER = '#E6E8EC';
const EMAIL_ATTACH_BG = '#FFF9F0';
const EMAIL_ATTACH_BORDER = '#F1D9A8';
const EMAIL_ATTACH_HEADING = '#A87920';
const EMAIL_ATTACH_FILENAME = '#5B4A2A';
const EMAIL_ATTACH_DESC = '#8A7A5A';
const EMAIL_FOOTER = '#98A2B3';

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
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:${EMAIL_TEXT};letter-spacing:0.3px;">
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
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:${EMAIL_TEXT};letter-spacing:0.3px;">
        ${safeCompanyName}
      </p>
    `,
  };
}

function buildPhoneIconHtml(): string {
  return `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" valign="middle" width="42" height="42" bgcolor="${EMAIL_CALL_ACCENT}" style="width:42px;height:42px;background-color:${EMAIL_CALL_ACCENT};border-radius:10px;text-align:center;vertical-align:middle;">
          <p style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:42px;color:#FFFFFF;">
            &#128222;
          </p>
        </td>
      </tr>
    </table>
  `;
}

function buildCallClientInner(clientNameHtml: string, phoneHtml: string): string {
  return `
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td width="4" bgcolor="${EMAIL_CALL_ACCENT}" style="width:4px;background-color:${EMAIL_CALL_ACCENT};font-size:0;line-height:0;">&nbsp;</td>
        <td bgcolor="${EMAIL_CALL_BG}" style="background-color:${EMAIL_CALL_BG};">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td width="58" valign="middle" style="padding:16px 12px 16px 16px;">
                ${buildPhoneIconHtml()}
              </td>
              <td valign="middle" style="padding:16px 18px 16px 0;font-family:Arial,Helvetica,sans-serif;">
                <span style="display:block;font-size:22px;font-weight:700;line-height:1.25;color:${EMAIL_TEXT};margin:0 0 3px 0;">
                  ${clientNameHtml}
                </span>
                <span style="display:block;font-size:14px;font-weight:500;line-height:1.4;color:${EMAIL_TEXT_MUTED};">
                  ${phoneHtml}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildCallClientSection(clientName: string, clientPhoneNumber?: string): string {
  const safeClientName = escapeHtml(clientName);

  if (!clientPhoneNumber) {
    return `
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border:1px solid ${EMAIL_GOLD_SOFT};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:0;">
            ${buildCallClientInner(safeClientName, 'Phone number not provided')}
          </td>
        </tr>
      </table>
    `;
  }

  const normalizedPhone = clientPhoneNumber.replace(/[^\d+]/g, '');
  const displayPhone = escapeHtml(clientPhoneNumber);

  return `
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border:1px solid ${EMAIL_GOLD_SOFT};border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:0;">
          <a href="tel:${normalizedPhone}" style="display:block;text-decoration:none;color:${EMAIL_TEXT};">
            ${buildCallClientInner(safeClientName, displayPhone)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function buildDetailRow(label: string, value: string, isLast = false): string {
  const borderBottom = isLast ? 'none' : `1px solid ${EMAIL_BORDER}`;

  return `
    <tr>
      <td style="padding:13px 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:${EMAIL_TEXT_MUTED};text-transform:uppercase;letter-spacing:0.8px;border-bottom:${borderBottom};width:38%;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:13px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:${EMAIL_TEXT};border-bottom:${borderBottom};">
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
        <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:${EMAIL_ATTACH_FILENAME};line-height:1.4;">
          ${escapeHtml(name)}
        </p>
      `,
    )
    .join('');

  return `
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:${EMAIL_ATTACH_BG};border:1px solid ${EMAIL_ATTACH_BORDER};border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:${EMAIL_ATTACH_HEADING};letter-spacing:1px;text-transform:uppercase;">
            ${attachmentLabel}
          </p>
          ${fileRows}
          <p style="margin:8px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${EMAIL_ATTACH_DESC};line-height:1.5;">
            ${attachmentDescription}
          </p>
        </td>
      </tr>
    </table>
  `;
}

function formatServiceLocationLabel(item: QuoteItemInput): string {
  const serviceName = pickString(item.serviceName, item.description, item.serviceId) || 'Service';
  const parsedCity = item.serviceId ? parseServiceIdParts(item.serviceId).city : '';
  const city = pickString(item.city, parsedCity.replace(/-/g, ' '));
  if (!city) return serviceName;

  const cityLower = city.toLowerCase();
  if (serviceName.toLowerCase().includes(cityLower)) return serviceName;

  const displayCity = city.replace(/\b\w/g, (char) => char.toUpperCase());
  return `${serviceName} ${displayCity}`;
}

function buildServiceLocationSection(items: QuoteItemInput[]): string {
  const grouped = new Map<string, { label: string; quantity: number }>();

  for (const item of items) {
    const label = formatServiceLocationLabel(item);
    const quantity = Math.max(0, Math.round(toNumber(item.quantity) || 0));
    const key = normalizeString(item.serviceId) || label.toLowerCase();
    if (!key || !label) continue;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { label, quantity });
      continue;
    }

    existing.quantity = Math.max(existing.quantity, quantity);
    if (label.length > existing.label.length) existing.label = label;
  }

  const rows = [...grouped.values()]
    .map(
      (row) => `
        <tr>
          <td valign="top" style="padding:12px 14px;width:64px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:${EMAIL_TEXT};border-bottom:1px solid ${EMAIL_BORDER};">
            ${row.quantity || '-'}
          </td>
          <td valign="top" style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:${EMAIL_TEXT};border-bottom:1px solid ${EMAIL_BORDER};">
            ${escapeHtml(row.label)}
          </td>
        </tr>
      `,
    )
    .join('');

  if (!rows) return '';

  return `
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#FCFCFD;border:1px solid ${EMAIL_BORDER};border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:10px 14px;width:64px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:${EMAIL_TEXT_MUTED};letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid ${EMAIL_BORDER};background-color:${EMAIL_HEADER_BG};">
          Qty
        </td>
        <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:${EMAIL_TEXT_MUTED};letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid ${EMAIL_BORDER};background-color:${EMAIL_HEADER_BG};">
          Service &amp; Location
        </td>
      </tr>
      ${rows}
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
  quoteItems: QuoteItemInput[];
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
    quoteItems,
  } = params;

  const displayDate = date || new Date().toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });

  const callClientSection = buildCallClientSection(clientName, clientPhoneNumber);
  const serviceLocationSection = buildServiceLocationSection(quoteItems);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <title>${escapeHtml(emailSubject)}</title>
    </head>
    <body style="margin:0;padding:0;background-color:${EMAIL_PAGE_BG};">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
        ${escapeHtml(emailSubject)}
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:${EMAIL_PAGE_BG};padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;background-color:${EMAIL_CARD_BG};border-radius:16px;overflow:hidden;border:2px solid ${EMAIL_CALL_ACCENT};box-shadow:0 2px 8px rgba(52,64,84,0.04);">
              <tr>
                <td align="center" bgcolor="${EMAIL_HEADER_BG}" style="background-color:${EMAIL_HEADER_BG};padding:32px 24px;">
                  ${logoHeaderHtml}
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:28px 28px 18px 28px;">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:700;color:${EMAIL_TEXT};line-height:1.3;text-align:center;">
                    New quote downloaded
                  </p>
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px 20px 28px;">
                  ${callClientSection}
                </td>
              </tr>

              ${serviceLocationSection ? `
              <tr>
                <td style="padding:0 28px 20px 28px;">
                  ${serviceLocationSection}
                </td>
              </tr>
              ` : ''}

              <tr>
                <td style="padding:0 28px 20px 28px;">
                  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#FCFCFD;border:1px solid ${EMAIL_BORDER};border-radius:12px;overflow:hidden;">
                    ${buildDetailRow('Quote Number', quoteNumber)}
                    ${buildDetailRow('Client Name', clientName)}
                    ${buildDetailRow('Downloaded By', downloadedBy, true)}
                    ${'' /* buildDetailRow('Date', displayDate, true) */}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px 24px 28px;">
                  ${buildAttachmentsSection(filenames)}
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:4px 28px 28px 28px;">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${EMAIL_FOOTER};">
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

function debugMailFail(message: string, details?: unknown): void {
  if (details !== undefined) {
    console.log(`DEBUG MAIL FAIL: ${message}`, details);
    return;
  }
  console.log(`DEBUG MAIL FAIL: ${message}`);
}

interface QuoteItemInput {
  serviceId?: string;
  serviceName?: string;
  description?: string;
  quantity?: number;
  duration?: number;
  durationUnit?: 'months' | 'days' | string;
  minimumQuantity?: number;
  total?: number;
  city?: string;
}

interface QuoteServiceSummary {
  serviceId: string;
  serviceName: string;
  quantity: number;
  minimumQuantity: number;
  campaignDays: number;
}

/** Raw row from vendor_rate_chunks (pricing/cost fields live in metadata JSON). */
interface VendorRateChunkRow {
  service_id?: string;
  service_name?: string;
  rate_key?: string;
  medium?: string;
  city?: string;
  vendor_name?: string;
  preferred_vendor_rank?: number;
  pricing?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  min_qty?: number | string;
  min_days?: number | string;
  min_duration?: number | string;
  total_cost?: number | string;
  display_unit_price_per_day?: number | string;
  display_unit_cost_per_day?: number | string;
  display_cost?: number | string;
  printing_cost?: number | string;
  mounting_cost?: number | string;
  printing_and_mounting_cost?: number | string;
  official_and_incidental_cost?: number | string;
  rto_cost?: number | string;
  extra_km_cost?: number | string;
  freight_cost?: number | string;
  space_rental_cost?: number | string;
  rental_cost?: number | string;
  display_cost_measurement_unit?: string;
}

/** Only columns that exist on vendor_rate_chunks (cost/vendor fields are in metadata). */
const VENDOR_CHUNK_SELECT = 'service_id, service_name, preferred_vendor_rank, metadata';

function normalizeVendorChunkRow(raw: Record<string, unknown>): VendorRateChunkRow {
  const metadata = toRecord(raw.metadata);
  const pricing = toRecord(metadata.pricing);

  return {
    service_id: pickString(raw.service_id, metadata.service_id) || undefined,
    service_name: pickString(raw.service_name, metadata.service_name) || undefined,
    rate_key: pickString(metadata.rate_key, raw.rate_key) || undefined,
    medium: pickString(metadata.medium, raw.medium, raw.service_name) || undefined,
    city: pickString(metadata.city, raw.city) || undefined,
    vendor_name: pickString(metadata.vendor_name, raw.vendor_name) || undefined,
    preferred_vendor_rank: pickNumber(raw.preferred_vendor_rank, metadata.preferred_vendor_rank),
    pricing,
    metadata,
    min_qty: metadata.min_qty ?? raw.min_qty,
    min_days: metadata.min_days ?? metadata.min_duration ?? raw.min_days,
    min_duration: metadata.min_duration ?? raw.min_duration,
    total_cost: metadata.total_cost ?? raw.total_cost,
    display_unit_price_per_day:
      metadata.display_unit_price_per_day ?? pricing.display_unit_price_per_day,
    display_unit_cost_per_day: metadata.display_unit_cost_per_day ?? pricing.display_unit_cost_per_day,
    display_cost: metadata.display_cost,
    printing_cost: metadata.printing_cost,
    mounting_cost: metadata.mounting_cost,
    printing_and_mounting_cost: metadata.printing_and_mounting_cost,
    official_and_incidental_cost: metadata.official_and_incidental_cost,
    rto_cost: metadata.rto_cost,
    extra_km_cost: metadata.extra_km_cost ?? metadata.freight_cost,
    freight_cost: metadata.freight_cost,
    space_rental_cost: metadata.space_rental_cost ?? metadata.rental_cost,
    rental_cost: metadata.rental_cost,
    display_cost_measurement_unit: pickString(
      metadata.display_cost_measurement_unit,
      pricing.display_cost_measurement_unit,
    ) || undefined,
  };
}

function normalizeVendorChunkRows(data: unknown): VendorRateChunkRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => normalizeVendorChunkRow(row));
}

const VENDOR_EXCEL_HEADERS = [
  'Service ID',
  'Medium Name',
  'Vendor Name',
  'Margin %',
  'Qty',
  'Duration (Days)',
  'Total Cost',
  'Total Price',
] as const;

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Excel presentation rounding: nearest 10 rupees (e.g. 12499 -> 12500). */
function roundRupeeForExcel(value: number): number {
  return Math.round(value / 10) * 10;
}

const DAYS_PER_MONTH = 30;

function pickPositive(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value == null || value === '') continue;
    if (typeof value === 'string' && value.trim().toUpperCase() === 'NA') continue;
    const raw = typeof value === 'string'
      ? value.replace(/,/g, '').replace(/^₹\s*/u, '').replace(/^Rs\.?\s*/i, '').trim()
      : value;
    const n = toNumber(raw);
    if (n !== undefined && n > 0) return n;
  }
  return undefined;
}

function toCampaignDays(duration: unknown, durationUnit?: unknown): number {
  const d = Math.max(0, Math.round(toNumber(duration) || 0));
  if (d <= 0) return 0;
  const unit = normalizeString(durationUnit).toLowerCase();
  if (unit.startsWith('month')) return d * DAYS_PER_MONTH;
  return d;
}

/** Combined P&F, else print+fix, else production, else official. Never sum combined with split. */
function resolvePfUnit(
  combined?: number,
  printFix?: number,
  printing?: number,
  mounting?: number,
  production?: number,
  official?: number,
): number {
  if (combined && combined > 0) return combined;
  if (printFix && printFix > 0) return printFix;
  const split = (printing || 0) + (mounting || 0);
  if (split > 0) return split;
  if (production && production > 0) return production;
  if (official && official > 0) return official;
  return 0;
}

type DisplayBillingBasis = 'monthly' | 'daily' | 'quantity';

function hasPositiveNumber(value: unknown): boolean {
  return pickPositive(value) !== undefined;
}

function resolveDisplayBillingBasis(params: {
  metadata: Record<string, unknown>;
  pricing: Record<string, unknown>;
  measurementUnit?: string;
  explicitDailyRate: boolean;
  recurringRentalRate: boolean;
  requiredDays?: number;
}): DisplayBillingBasis {
  if (params.explicitDailyRate) return 'daily';
  if (params.recurringRentalRate) return 'monthly';

  const unitText = [
    params.measurementUnit,
    params.metadata.display_measurement_unit,
    params.metadata.duration_measurement_unit,
    params.pricing.display_measurement_unit,
    params.pricing.duration_measurement_unit,
    params.pricing.period,
  ]
    .map(normalizeString)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(month|monthly|per\s*month)\b/.test(unitText)) return 'monthly';
  if (/\b(day|daily|per\s*day)\b/.test(unitText)) return 'daily';

  const qtyUnit = pickString(
    params.metadata.qty_measurement_unit,
    params.pricing.qty_measurement_unit,
  );
  const hasDurationUnit = [
    params.metadata.duration_measurement_unit,
    params.metadata.display_measurement_unit,
    params.pricing.duration_measurement_unit,
    params.pricing.display_measurement_unit,
    params.pricing.period,
  ].some((value) => {
    const unit = normalizeString(value);
    return unit !== '' && unit.toUpperCase() !== 'NA';
  });

  // A unit such as "Auto" with no duration basis is a per-quantity rate.
  if (qtyUnit && !hasDurationUnit && !hasPositiveNumber(params.requiredDays)) {
    return 'quantity';
  }

  // Untyped recurring display values retain the existing monthly fallback.
  return 'monthly';
}

function calculateDisplayTotal(
  rate: number | undefined,
  basis: DisplayBillingBasis,
  quantity: number,
  days: number,
): number {
  if (rate == null || rate <= 0) return 0;
  if (basis === 'daily') return rate * quantity * days;
  if (basis === 'quantity') return rate * quantity;
  return rate * quantity * (days / DAYS_PER_MONTH);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = toNumber(value);
    if (n !== undefined) return n;
  }
  return undefined;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const str = normalizeString(value);
    if (!str || str.toUpperCase() === 'NA') continue;
    return str;
  }
  return '';
}

function normalizeText(value: unknown): string {
  const text = normalizeString(value).toLowerCase();
  if (!text) return '';
  return text.replace(/[^a-z0-9]+/g, ' ').trim();
}

function toSlug(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return '';
  return text.replace(/\s+/g, '-');
}

function parseServiceIdParts(serviceId: string): { city: string; mediumSlug: string; mediumText: string } {
  const slug = toSlug(serviceId);
  if (!slug) {
    return { city: '', mediumSlug: '', mediumText: '' };
  }

  const parts = slug.split('-').filter(Boolean);
  if (parts.length <= 1) {
    return { city: '', mediumSlug: slug, mediumText: slug.replace(/-/g, ' ') };
  }

  const city = parts[parts.length - 1] || '';
  const mediumSlug = parts.slice(0, -1).join('-');
  return {
    city,
    mediumSlug,
    mediumText: mediumSlug.replace(/-/g, ' '),
  };
}

function buildQuoteServiceSummaries(items: QuoteItemInput[]): QuoteServiceSummary[] {
  const byService = new Map<string, QuoteServiceSummary>();

  for (const item of items) {
    const serviceId = normalizeString(item.serviceId);
    if (!serviceId) continue;

    const serviceName = pickString(item.serviceName, item.description, serviceId) || serviceId;
    const quantity = Math.max(0, Math.round(toNumber(item.quantity) || 0));
    const duration = toCampaignDays(item.duration, item.durationUnit);
    const minimumQuantity = Math.max(0, Math.round(toNumber(item.minimumQuantity) || 0));

    const existing = byService.get(serviceId);
    if (!existing) {
      byService.set(serviceId, {
        serviceId,
        serviceName,
        quantity,
        minimumQuantity,
        campaignDays: duration,
      });
      continue;
    }

    existing.serviceName = existing.serviceName || serviceName;
    existing.quantity = Math.max(existing.quantity, quantity);
    existing.minimumQuantity = Math.max(existing.minimumQuantity, minimumQuantity);
    existing.campaignDays = Math.max(existing.campaignDays, duration);
  }

  // Keep zero when the quote did not contain a campaign duration.
  // The Excel export uses this distinction to avoid displaying the
  // internal one-day pricing fallback as a real duration.
  return [...byService.values()];
}

async function loadPreferredVendorRows(summaries: QuoteServiceSummary[]): Promise<VendorRateChunkRow[]> {
  if (!summaries.length || !SUPABASE_URL || (!SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_ANON_KEY)) {
    debugMailFail('vendor lookup skipped: missing summaries or Supabase keys', {
      summaries: summaries.length,
      hasSupabaseUrl: !!SUPABASE_URL,
      hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
      hasAnonKey: !!SUPABASE_ANON_KEY,
    });
    return [];
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!supabaseKey) return [];

  const supabase = createClient(SUPABASE_URL, supabaseKey, {
    auth: { persistSession: false },
  });

  const serviceIds = summaries.map((summary) => summary.serviceId).filter(Boolean);

  const { data, error } = await supabase
    .from('vendor_rate_chunks')
    .select(VENDOR_CHUNK_SELECT)
    .in('service_id', serviceIds)
    .eq('preferred_vendor_rank', 1);

  if (error) {
    debugMailFail('exact service_id vendor lookup failed', error);
    console.error('Failed to load preferred vendor rows for Excel attachment:', error);
    return [];
  }

  const exactRows = normalizeVendorChunkRows(data);
  debugMailFail('exact service_id vendor lookup result', {
    requestedServiceIds: serviceIds,
    foundRows: exactRows.length,
  });
  const matchedServiceIds = new Set(
    exactRows.map((row) => toSlug(row.service_id)).filter(Boolean),
  );

  const unresolved = summaries.filter((summary) => !matchedServiceIds.has(toSlug(summary.serviceId)));
  if (!unresolved.length) {
    debugMailFail('all services resolved via exact service_id lookup');
    return exactRows;
  }

  debugMailFail('services unresolved after exact lookup', unresolved.map((s) => ({
    serviceId: s.serviceId,
    serviceName: s.serviceName,
  })));

  const fallbackCities = Array.from(
    new Set(
      unresolved
        .map((summary) => parseServiceIdParts(summary.serviceId).city)
        .filter(Boolean),
    ),
  );

  if (!fallbackCities.length) {
    return exactRows;
  }

  const cityOrFilter = fallbackCities
    .map((city) => `metadata->>city.ilike.${city}`)
    .join(',');

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('vendor_rate_chunks')
    .select(VENDOR_CHUNK_SELECT)
    .eq('preferred_vendor_rank', 1)
    .or(cityOrFilter);

  if (fallbackError) {
    debugMailFail('city fallback vendor lookup failed', fallbackError);
    console.error('Failed fallback preferred vendor lookup for Excel attachment:', fallbackError);
    return exactRows;
  }

  const fallbackRows = normalizeVendorChunkRows(fallbackData);
  debugMailFail('city fallback vendor lookup result', {
    fallbackCities,
    foundRows: fallbackRows.length,
  });

  const mediumFallbackRows: VendorRateChunkRow[] = [];
  for (const summary of unresolved) {
    const { city, mediumText } = parseServiceIdParts(summary.serviceId);
    const mediumSearch = mediumText || normalizeText(summary.serviceName);
    if (!mediumSearch) continue;

    let mediumQuery = supabase
      .from('vendor_rate_chunks')
      .select(VENDOR_CHUNK_SELECT)
      .eq('preferred_vendor_rank', 1)
      .ilike('metadata->>medium', `%${mediumSearch}%`)
      .limit(50);

    if (city) {
      mediumQuery = mediumQuery.ilike('metadata->>city', city);
    }

    const { data: mediumData, error: mediumError } = await mediumQuery;
    if (mediumError) {
      debugMailFail('medium fallback vendor lookup failed', {
        serviceId: summary.serviceId,
        mediumSearch,
        city,
        error: mediumError,
      });
      console.error('Failed medium fallback preferred vendor lookup for Excel attachment:', mediumError);
      continue;
    }

    if (Array.isArray(mediumData) && mediumData.length > 0) {
      debugMailFail('medium fallback matched rows', {
        serviceId: summary.serviceId,
        mediumSearch,
        city,
        foundRows: mediumData.length,
      });
      mediumFallbackRows.push(...normalizeVendorChunkRows(mediumData));
      continue;
    }

    let rateKeyQuery = supabase
      .from('vendor_rate_chunks')
      .select(VENDOR_CHUNK_SELECT)
      .eq('preferred_vendor_rank', 1)
      .ilike('metadata->>rate_key', `%${mediumSearch}%`)
      .limit(50);

    if (city) {
      rateKeyQuery = rateKeyQuery.ilike('metadata->>city', city);
    }

    const { data: rateKeyData, error: rateKeyError } = await rateKeyQuery;
    if (rateKeyError) {
      debugMailFail('rate_key fallback vendor lookup failed', {
        serviceId: summary.serviceId,
        mediumSearch,
        city,
        error: rateKeyError,
      });
      console.error('Failed rate_key fallback preferred vendor lookup for Excel attachment:', rateKeyError);
      continue;
    }

    if (Array.isArray(rateKeyData) && rateKeyData.length > 0) {
      debugMailFail('rate_key fallback matched rows', {
        serviceId: summary.serviceId,
        mediumSearch,
        city,
        foundRows: rateKeyData.length,
      });
      mediumFallbackRows.push(...normalizeVendorChunkRows(rateKeyData));
    } else {
      debugMailFail('no vendor row found in medium/rate_key fallback', {
        serviceId: summary.serviceId,
        serviceName: summary.serviceName,
        mediumSearch,
        city,
      });
    }
  }

  const allRows = [...exactRows, ...fallbackRows, ...mediumFallbackRows];
  debugMailFail('total vendor candidates after all lookups', {
    exactRows: exactRows.length,
    cityFallbackRows: fallbackRows.length,
    mediumRateKeyFallbackRows: mediumFallbackRows.length,
    totalRows: allRows.length,
  });
  return allRows;
}

function scoreVendorMatch(summary: QuoteServiceSummary, vendor: VendorRateChunkRow): number {
  const summaryId = toSlug(summary.serviceId);
  const summaryName = normalizeText(summary.serviceName);
  const { city: summaryCity, mediumSlug: summaryMediumSlug, mediumText: summaryMediumText } = parseServiceIdParts(
    summary.serviceId,
  );

  const vendorServiceId = toSlug(vendor.service_id);
  const vendorCity = toSlug(pickString(vendor.city, toRecord(vendor.metadata).city));
  const vendorMediumText = normalizeText(pickString(vendor.medium, toRecord(vendor.metadata).medium));
  const vendorMediumSlug = vendorMediumText.replace(/\s+/g, '-');
  const vendorRateKey = normalizeText(vendor.rate_key);

  if (vendorServiceId && vendorServiceId === summaryId) {
    return 1000;
  }

  let score = 0;

  if (summaryCity && vendorCity && summaryCity === vendorCity) {
    score += 150;
  }

  if (summaryMediumSlug && vendorServiceId && vendorServiceId.includes(summaryMediumSlug)) {
    score += 280;
  }

  if (summaryMediumText && vendorMediumText && vendorMediumText === summaryMediumText) {
    score += 320;
  }

  if (summaryMediumSlug && vendorMediumSlug && vendorMediumSlug === summaryMediumSlug) {
    score += 280;
  }

  if (summaryMediumText && vendorRateKey && vendorRateKey.includes(summaryMediumText)) {
    score += 200;
  }

  if (summaryName && vendorMediumText && summaryName.includes(vendorMediumText)) {
    score += 120;
  }

  return score;
}

function pickBestVendorRow(summary: QuoteServiceSummary, rows: VendorRateChunkRow[]): VendorRateChunkRow | undefined {
  let bestRow: VendorRateChunkRow | undefined;
  let bestScore = -1;

  for (const row of rows) {
    const score = scoreVendorMatch(summary, row);
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  return bestScore > 0 ? bestRow : undefined;
}

function buildVendorExcelRow(summary: QuoteServiceSummary, vendor?: VendorRateChunkRow): Record<string, string | number> {
  const pricing = toRecord(vendor?.pricing);
  const metadata = toRecord(vendor?.metadata);
  const metadataPricing = toRecord(metadata.pricing);

  const minQty = pickPositive(vendor?.min_qty, metadata.min_qty, metadata.minimum_quantity, summary.minimumQuantity);
  const minDays = pickPositive(vendor?.min_days, vendor?.min_duration, metadata.min_days, metadata.min_duration);
  const requiredQty = minQty || 1;
  const askedQty = summary.quantity || requiredQty;
  const qty = Math.max(requiredQty, askedQty);
  const requiredDays = minDays || 1;
  const askedDays = summary.campaignDays > 0 ? summary.campaignDays : 1;
  const days = Math.max(requiredDays, askedDays);
  const hasDuration = minDays > 0 || summary.campaignDays > 0;

  const printingUnitPrice = pickPositive(pricing.printing_price, metadataPricing.printing_price);
  const printingUnitCost = pickPositive(vendor?.printing_cost, metadata.printing_cost);
  const fixingUnitPrice = pickPositive(pricing.mounting_price, metadataPricing.mounting_price, pricing.fixing_price);
  const fixingUnitCost = pickPositive(vendor?.mounting_cost, metadata.mounting_cost, metadata.fixing_cost);
  const printingAndFixingPrice = pickPositive(
    pricing.printing_and_fixing_price,
    metadataPricing.printing_and_fixing_price,
  );
  const printingAndFixingCost = pickPositive(
    metadata.printing_and_fixing_cost,
    metadataPricing.printing_and_fixing_cost,
  );
  const printingAndMountingPrice = pickPositive(
    pricing.printing_and_mounting_price,
    metadataPricing.printing_and_mounting_price,
    metadata.printing_and_mounting_price,
  );
  const printingAndMountingCost = pickPositive(
    vendor?.printing_and_mounting_cost,
    metadata.printing_and_mounting_cost,
  );
  const productionPrice = pickPositive(
    pricing.production_price,
    metadataPricing.production_price,
    metadata.production_price,
  );
  const productionCost = pickPositive(metadata.production_cost, metadataPricing.production_cost);
  const officialPrice = pickPositive(
    pricing.official_and_incidental_price,
    metadataPricing.official_and_incidental_price,
  );
  const officialCost = pickPositive(
    metadata.pf_unit_cost,
    metadata.vendor_pf_unit_cost,
    vendor?.official_and_incidental_cost,
    metadata.official_and_incidental_cost,
  );
  const rtoUnitPrice = pickPositive(pricing.rto_price, metadataPricing.rto_price) || 0;
  const rtoUnitCost = pickPositive(metadata.rto_unit_cost, vendor?.rto_cost, metadata.rto_cost) || 0;
  const extraKmPrice = pickPositive(
    pricing.extra_km_price,
    metadataPricing.extra_km_price,
    metadata.extra_km_price,
    pricing.freight_price,
    metadataPricing.freight_price,
  ) || 0;
  const extraKmCost = pickPositive(
    vendor?.extra_km_cost,
    metadata.extra_km_cost,
    vendor?.freight_cost,
    metadata.freight_cost,
  ) || 0;
  const recurringDisplayPriceRaw = pickPositive(
    pricing.space_rental_price,
    metadataPricing.space_rental_price,
    pricing.rental_price,
    metadataPricing.rental_price,
  );
  const recurringDisplayCostRaw = pickPositive(
    vendor?.space_rental_cost,
    metadata.space_rental_cost,
    vendor?.rental_cost,
    metadata.rental_cost,
  );

  const pfUnitPrice = resolvePfUnit(
    printingAndMountingPrice,
    printingAndFixingPrice,
    printingUnitPrice,
    fixingUnitPrice,
    productionPrice,
    officialPrice,
  );
  const pfUnitCost = resolvePfUnit(
    printingAndMountingCost,
    printingAndFixingCost,
    printingUnitCost,
    fixingUnitCost,
    productionCost,
    officialCost,
  );
  // Named P&F/production only (no official fallback). When these exist, official
  // must be added on top — same as quote UI. When they do not, resolvePfUnit
  // already used official as the one-time amount; do not add it twice.
  const namedPfPrice = resolvePfUnit(
    printingAndMountingPrice,
    printingAndFixingPrice,
    printingUnitPrice,
    fixingUnitPrice,
    productionPrice,
  );
  const namedPfCost = resolvePfUnit(
    printingAndMountingCost,
    printingAndFixingCost,
    printingUnitCost,
    fixingUnitCost,
    productionCost,
  );
  const officialAddonPrice = namedPfPrice > 0 ? (officialPrice || 0) : 0;
  const officialAddonCost = namedPfCost > 0
    ? (pickPositive(vendor?.official_and_incidental_cost, metadata.official_and_incidental_cost) || 0)
    : 0;

  const unitPricePerDay = pickPositive(
    vendor?.display_unit_price_per_day,
    pricing.display_unit_price_per_day,
    metadata.display_unit_price_per_day,
    metadataPricing.display_unit_price_per_day,
  );
  const rawDisplayPrice = pickPositive(
    pricing.display_price,
    metadataPricing.display_price,
    metadata.display_price,
  );
  const unitCostPerDay = pickPositive(
    vendor?.display_unit_cost_per_day,
    metadata.display_unit_cost_per_day,
    metadataPricing.display_unit_cost_per_day,
  );
  const rawDisplayCost = pickPositive(
    vendor?.display_cost,
    metadata.display_cost,
    metadataPricing.display_cost,
  );

  const oneTimePrice = pfUnitPrice + officialAddonPrice + rtoUnitPrice + extraKmPrice;
  const oneTimeCost = pfUnitCost + officialAddonCost + rtoUnitCost + extraKmCost;

  const displayPeriod = pickString(
    pricing.display_period,
    metadataPricing.display_period,
    metadata.display_period,
    vendor?.display_cost_measurement_unit,
    metadata.display_cost_measurement_unit,
  );
  const priceRate = unitPricePerDay || rawDisplayPrice || recurringDisplayPriceRaw;
  const costRate = unitCostPerDay || rawDisplayCost || recurringDisplayCostRaw;
  const priceBasis = resolveDisplayBillingBasis({
    metadata,
    pricing,
    measurementUnit: displayPeriod,
    explicitDailyRate: unitPricePerDay !== undefined,
    recurringRentalRate: recurringDisplayPriceRaw !== undefined,
    requiredDays: minDays,
  });
  const costBasis = resolveDisplayBillingBasis({
    metadata,
    pricing,
    measurementUnit: pickString(
      vendor?.display_cost_measurement_unit,
      metadata.display_cost_measurement_unit,
      metadataPricing.display_cost_measurement_unit,
      displayPeriod,
    ),
    explicitDailyRate: unitCostPerDay !== undefined,
    recurringRentalRate: recurringDisplayCostRaw !== undefined,
    requiredDays: minDays,
  });
  const totalDisplayPrice = calculateDisplayTotal(priceRate, priceBasis, qty, days);
  const totalDisplayCost = calculateDisplayTotal(costRate, costBasis, qty, days);

  const hasPriceRates = totalDisplayPrice > 0 || oneTimePrice > 0;
  const hasCostRates = totalDisplayCost > 0 || oneTimeCost > 0;
  const totalPrice = roundTwo(totalDisplayPrice + oneTimePrice * qty);
  const totalCost = roundTwo(totalDisplayCost + oneTimeCost * qty);
  const roundedTotalPrice = roundRupeeForExcel(totalPrice);
  const roundedTotalCost = roundRupeeForExcel(totalCost);
  const marginPct =
    hasPriceRates && hasCostRates && roundedTotalPrice > 0
      ? roundOne(((roundedTotalPrice - roundedTotalCost) / roundedTotalPrice) * 100)
      : undefined;

  console.log('[ExcelPricingDebug] buildVendorExcelRow', {
    serviceId: summary.serviceId,
    mediumName: pickString(vendor?.medium, metadata.medium),
    vendorName: pickString(vendor?.vendor_name, metadata.vendor_name),
    requiredQty,
    askedQty,
    finalQty: qty,
    requiredDays,
    askedDays,
    finalDays: days,
    qtyMeasurementUnit: pickString(
      metadata.qty_measurement_unit,
      pricing.qty_measurement_unit,
    ) || 'NA',
    durationMeasurementUnit: pickString(
      metadata.duration_measurement_unit,
      metadata.display_measurement_unit,
      pricing.duration_measurement_unit,
      pricing.display_measurement_unit,
      pricing.period,
    ) || 'NA',
    displayCost: rawDisplayCost ?? 'NA',
    displayPrice: rawDisplayPrice ?? 'NA',
    costRate: costRate ?? 'NA',
    priceRate: priceRate ?? 'NA',
    costBasis,
    priceBasis,
    pfUnitCost,
    pfUnitPrice,
    officialAddonCost,
    officialAddonPrice,
    rtoUnitCost,
    rtoUnitPrice,
    extraKmCost,
    extraKmPrice,
    totalDisplayCost,
    totalDisplayPrice,
    oneTimeCost,
    oneTimePrice,
    totalCost,
    totalPrice,
    roundedTotalCost,
    roundedTotalPrice,
    marginPct: marginPct ?? 'NA',
  });

  return {
    'Service ID': summary.serviceId,
    'Medium Name': pickString(vendor?.medium, metadata.medium),
    'Vendor Name': pickString(vendor?.vendor_name, metadata.vendor_name),
    'Margin %': marginPct ?? '',
    Qty: qty,
    'Duration (Days)': hasDuration ? days : 'NA',
    'Total Cost': hasCostRates ? roundedTotalCost : '',
    'Total Price': hasPriceRates ? roundedTotalPrice : '',
  };
}

async function buildVendorExcelAttachment(
  quoteNumber: string,
  quoteItems: QuoteItemInput[],
): Promise<{ filename: string; base64Content: string }> {
  const summaries = buildQuoteServiceSummaries(quoteItems);
  debugMailFail('quote summaries prepared for vendor excel', summaries);
  const preferredVendorRows = await loadPreferredVendorRows(summaries);

  const excelRows = summaries.map((summary) => {
    const bestVendor = pickBestVendorRow(summary, preferredVendorRows);
    if (!bestVendor) {
      debugMailFail('no best vendor row picked for summary', {
        serviceId: summary.serviceId,
        serviceName: summary.serviceName,
      });
    } else {
      debugMailFail('best vendor row picked for summary', {
        serviceId: summary.serviceId,
        serviceName: summary.serviceName,
        pickedVendor: bestVendor.vendor_name,
        pickedCity: bestVendor.city,
        pickedServiceId: bestVendor.service_id,
      });
    }
    return buildVendorExcelRow(summary, bestVendor);
  });

  debugMailFail('excel rows built', excelRows);

  const worksheet = excelRows.length
    ? XLSX.utils.json_to_sheet(excelRows, { header: [...VENDOR_EXCEL_HEADERS] })
    : XLSX.utils.aoa_to_sheet([[...VENDOR_EXCEL_HEADERS]]);
  XLSX.utils.sheet_add_aoa(worksheet, [[...VENDOR_EXCEL_HEADERS]], {
    origin: 'A1',
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Vendor Details');

  const safeQuoteNumber = quoteNumber.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const excelFilename = `Vendor_Details_${safeQuoteNumber || 'Quote'}.xlsx`;

  return {
    filename: excelFilename,
    base64Content: XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' }),
  };
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
      quoteItems,
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

    const resolvedQuoteItems: QuoteItemInput[] = Array.isArray(quoteItems) ? quoteItems : [];
    const vendorExcelAttachment = await buildVendorExcelAttachment(quoteNumber, resolvedQuoteItems);

    const filenames = [...resolvedPdfAttachments.map((attachment) => attachment.filename), vendorExcelAttachment.filename];

    const emailSubject = [quoteNumber, clientName].filter(Boolean).join(' ');
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
      quoteItems: resolvedQuoteItems,
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

    attachments.push({
      filename: vendorExcelAttachment.filename,
      content: vendorExcelAttachment.base64Content,
      encoding: 'base64',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    if (logoEmbed.inlineAttachment) {
      attachments.push(logoEmbed.inlineAttachment);
    }

    await transporter.sendMail({
      from: SMTP_FROM,
      to: recipients,
      cc: INTERNAL_QUOTE_CC_EMAIL || undefined,
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
