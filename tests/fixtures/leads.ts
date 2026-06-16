import { Lead, LeadSearchResult } from '../../src/types/lead';

export const sampleLead: Lead = {
  id: 'lead-001',
  name: 'Acme Corporation',
  phone: '9876543210',
  email: 'contact@acme.com',
  address: '456 Industrial Area, Pune',
  alternatePhone: '9123456789',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  campaign: 'Spring 2026',
  source: 'referral',
  created_at: '2026-01-15T10:00:00Z',
};

export const sampleLeadSearchResults: LeadSearchResult[] = [
  {
    id: 'lead-001',
    name: 'Acme Corporation',
    phone: '9876543210',
    email: 'contact@acme.com',
    address: '456 Industrial Area, Pune',
    city: 'Pune',
    state: 'Maharashtra',
  },
  {
    id: 'lead-002',
    name: 'Acme Retail',
    phone: '9000000001',
    email: 'retail@acme.com',
    address: '789 Retail Park, Mumbai',
    city: 'Mumbai',
    state: 'Maharashtra',
  },
];
