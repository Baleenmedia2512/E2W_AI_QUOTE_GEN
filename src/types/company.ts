export interface CompanyInfo {
  name: string;
  address: string;
  gst: string;
  abn?: string; // Australian Business Number
  phone: string;
  email: string;
  logo?: string;
  website?: string;
  signature?: string;
  designation?: string;
}

export interface CompanyState {
  companyInfo: CompanyInfo | null;
}
