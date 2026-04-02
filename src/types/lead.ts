// Lead type definition
export interface Lead {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  alternatePhone?: string;
  city?: string;
  state?: string;
  pincode?: string;
  campaign?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface LeadSearchResult {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  alternatePhone?: string;
  city?: string;
  state?: string;
  pincode?: string;
  campaign?: string;
  source?: string;
}
