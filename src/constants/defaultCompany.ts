import { CompanyInfo } from '../types/company';

/**
 * Default company information - pre-fills the form for first-time users
 * Users can edit and save their own details, which will override these defaults
 */
export const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: 'Your Company Name',
  address: '123 Business Street, City, State, ZIP Code',
  gst: '',
  abn: '',
  phone: '+1 (555) 000-0000',
  email: 'contact@yourcompany.com',
  logo: '',
  website: 'www.yourcompany.com',
  signature: 'Your Name',
  designation: 'Sales Manager',
};
