/** Row linking a downloaded quote to an LMS Lead. */
export interface QuoteDownload {
  id: string;
  leadId: string;
  quoteNumber: string;
  createdAt?: string;
}

export interface QuoteDownloadInput {
  leadId: string;
  quoteNumber: string;
}
