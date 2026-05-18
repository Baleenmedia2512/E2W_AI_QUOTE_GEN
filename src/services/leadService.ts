import { Lead, LeadSearchResult } from '../types/lead';

import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

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

    logger.info('🗄️ LeadService: Searching database for:', searchTerm);
    
    const { data, error } = await supabase
      .from('Lead')
      .select('id, name, phone, email, address, alternatePhone, city, state, pincode, campaign, source')
      .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      .limit(limit)
      .order('name', { ascending: true });

    logger.info('🔍 Query result - Error:', error, 'Data:', data);

    if (error) {
      logger.error('❌ LeadService: Database error:', error);
      return [];
    }

    logger.info('✅ LeadService: Found leads:', data?.length || 0, data);
    return data || [];
  } catch (error) {
    logger.error('❌ LeadService: Exception:', error);
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
      logger.error('Error fetching lead:', error);
      return null;
    }

    return data;
  } catch (error) {
    logger.error('Error in getLeadById:', error);
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
      logger.error('Error fetching leads:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error('Error in getAllLeads:', error);
    return [];
  }
};
