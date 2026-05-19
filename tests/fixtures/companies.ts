import { CompanyInfo } from '../../src/types/company';

export const sampleCompany: CompanyInfo = {
  name: 'Baleen Media Pvt. Ltd.',
  address: '123 Business Park, Mumbai, Maharashtra 400001',
  gst: '27AABCB1234E1ZX',
  abn: '',
  phone: '+91 98765 43210',
  email: 'info@baleenmedia.com',
  logo: '',
  website: 'https://baleenmedia.com',
  signature: '',
  designation: 'Sales Manager',
};

export const minimalCompany: CompanyInfo = {
  name: 'Test Company',
  address: '',
  gst: '',
  abn: '',
  phone: '',
  email: '',
  logo: '',
  website: '',
  signature: '',
  designation: '',
};
