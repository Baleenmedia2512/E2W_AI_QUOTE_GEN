import { Lead, LeadSearchResult, PreparedForLeadInput } from '../types/lead';
import { apiFetch } from './apiClient';

export const searchLeads = async (
  searchTerm: string,
  limit: number = 15,
): Promise<LeadSearchResult[]> => {
  try {
    if (searchTerm.length < 2) return [];
    const { data, error } = await apiFetch<{ data?: LeadSearchResult[] }>(
      `/api/leads/search?q=${encodeURIComponent(searchTerm)}&limit=${limit}`,
    );
    if (error) {
      console.error('❌ LeadService: Database error:', error);
      return [];
    }
    return data?.data || [];
  } catch (error) {
    console.error('❌ LeadService: Exception:', error);
    return [];
  }
};

export const getLeadById = async (id: string): Promise<Lead | null> => {
  try {
    const { data, error } = await apiFetch<{ data?: Lead }>(`/api/leads/${encodeURIComponent(id)}`);
    if (error) return null;
    return data?.data || null;
  } catch {
    return null;
  }
};

export const getAllLeads = async (limit: number = 100): Promise<Lead[]> => {
  try {
    const { data, error } = await apiFetch<{ data?: Lead[] }>(`/api/leads?limit=${limit}`);
    if (error) return [];
    return data?.data || [];
  } catch {
    return [];
  }
};

export const savePreparedForLead = async (
  input: PreparedForLeadInput,
): Promise<Lead | null> => {
  try {
    const { data, error } = await apiFetch<{ data?: Lead }>('/api/leads/prepared-for', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (error) {
      console.error('❌ LeadService: savePreparedForLead failed:', error);
      return null;
    }
    return data?.data || null;
  } catch (error) {
    console.error('❌ LeadService: savePreparedForLead exception:', error);
    return null;
  }
};
