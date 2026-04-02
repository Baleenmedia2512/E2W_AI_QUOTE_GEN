import { supabase } from './supabaseClient';
import { Lead, LeadSearchResult } from '../types/lead';

/**
 * Search leads by name, phone, or company
 * @param searchTerm - The search term (minimum 2 characters)
 * @param limit - Maximum number of results (default: 15)
 * @returns Array of matching leads
 */
export const searchLeads = async (
  searchTerm: string,
  limit: number = 15
): Promise<LeadSearchResult[]> => {
  try {
    if (searchTerm.length < 2) {
      return [];
    }

    console.log('🗄️ LeadService: Searching database for:', searchTerm);

    const searchPattern = `%${searchTerm}%`;
    
    const { data, error } = await supabase
      .from('Lead')
      .select('id, name, phone, email, address, alternatePhone')
      .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      .limit(limit)
      .order('name', { ascending: true });

    console.log('🔍 Query result - Error:', error, 'Data:', data);

    if (error) {
      console.error('❌ LeadService: Database error:', error);
      return [];
    }

    console.log('✅ LeadService: Found leads:', data?.length || 0, data);
    return data || [];
  } catch (error) {
    console.error('❌ LeadService: Exception:', error);
    return [];
  }
};

/**
 * Get lead by ID
 * @param id - Lead ID
 * @returns Lead details or null
 */
export const getLeadById = async (id: string): Promise<Lead | null> => {
  try {
    const { data, error } = await supabase
      .from('Lead')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching lead:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getLeadById:', error);
    return null;
  }
};

/**
 * Get all leads
 * @param limit - Maximum number of results
 * @returns Array of all leads
 */
export const getAllLeads = async (limit: number = 100): Promise<Lead[]> => {
  try {
    const { data, error } = await supabase
      .from('Lead')
      .select('*')
      .limit(limit)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching leads:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getAllLeads:', error);
    return [];
  }
};
