export interface PdfAttachmentPayload {
  base64Pdf: string;
  filename: string;
}

export function buildPdfAttachmentPayload(
  attachments: readonly PdfAttachmentPayload[],
): PdfAttachmentPayload[] {
  return attachments
    .filter((attachment) => Boolean(attachment.base64Pdf && attachment.filename))
    .map((attachment) => ({
      base64Pdf: attachment.base64Pdf,
      filename: attachment.filename,
    }));
}
