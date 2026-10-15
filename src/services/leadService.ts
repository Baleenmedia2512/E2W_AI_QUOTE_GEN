import { supabase } from './supabaseClient';
import { Lead, LeadSearchResult, PreparedForLeadInput } from '../types/lead';

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
    
    const { data, error } = await supabase
      .from('Lead')
      .select('id, name, phone, email, address, alternatePhone, city, state, pincode, campaign, source')
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

/** Lead.id is text and required — generate a client UUID when DB has no default. */
function newLeadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lead_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Persist Quote Prepared For fields into Lead.
 * - Requires name + 10-digit phone (same rules as preview validation).
 * - New phone → INSERT with id + status "new".
 * - Existing phone → update name/email only (does not change status).
 * Failures are logged only; callers should not block UI on the result.
 */
export const savePreparedForLead = async (
  input: PreparedForLeadInput,
): Promise<Lead | null> => {
  const name = (input.name || '').trim();
  const phone = (input.phone || '').trim();
  const email = (input.email || '').trim();

  if (!name || !/^\d{10}$/.test(phone)) {
    return null;
  }

  try {
    const { data: existingRows, error: findError } = await supabase
      .from('Lead')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    if (findError) {
      console.error('❌ LeadService: Lookup failed:', findError.message, findError);
      return null;
    }

    const existing = existingRows?.[0];

    if (existing?.id) {
      const nextEmail = email || existing.email || '';
      const nameChanged = (existing.name || '') !== name;
      const emailChanged = (existing.email || '') !== nextEmail;
      if (!nameChanged && !emailChanged) {
        return existing as Lead;
      }

      const { data: updated, error: updateError } = await supabase
        .from('Lead')
        .update({
          name,
          email: nextEmail,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (updateError) {
        console.error('❌ LeadService: Update failed:', updateError.message, updateError);
        return null;
      }
      return updated as Lead;
    }

    const now = new Date().toISOString();
    const payload = {
      id: newLeadId(),
      name,
      phone,
      email: email || '',
      address: '',
      // Lead.source / updatedAt are NOT NULL in this DB (no defaults).
      source: 'Quote Buddy',
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };

    const { data: created, error: insertError } = await supabase
      .from('Lead')
      .insert(payload)
      .select('*')
      .single();

    if (insertError) {
      console.error('❌ LeadService: Insert failed:', insertError.message, insertError, payload);
      return null;
    }

    console.log('✅ LeadService: Saved prepared-for lead:', created?.id);
    return created as Lead;
  } catch (error) {
    console.error('❌ LeadService: savePreparedForLead exception:', error);
    return null;
  }
};
