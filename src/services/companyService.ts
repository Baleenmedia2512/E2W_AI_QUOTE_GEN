import { supabase } from './supabaseClient';
import { CompanyInfo } from '../types/company';
import { authService } from './authService';

/**
 * Company Service - Manages company information with database sync
 * Provides fallback to localStorage if database is unavailable
 */
export const companyService = {
  /**
   * Fetch the single active company profile from the database.
   *
   * Company settings are global in the current schema, so this read must not
   * depend on the optional user_id migration. This also makes the database
   * profile available in a fresh/incognito browser.
   */
  async getCompanySettings(): Promise<CompanyInfo | null> {
    try {
      const { data, error } = await supabase
        .from('company_settings')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('⚠️ Database fetch failed, using localStorage fallback:', error.message);
        return null;
      }

      if (!data) {
        return null;
      }

      // Map database fields to CompanyInfo type
      return {
        name: data.name || '',
        address: data.address || '',
        gst: data.gst || '',
        abn: data.abn || '',
        phone: data.phone || '',
        email: data.email || '',
        logo: data.logo || '',
        website: data.website || '',
        signature: data.signature || '',
        designation: data.designation || '',
      };
    } catch (error) {
      console.error('❌ Error fetching company settings:', error);
      return null;
    }
  },

  /**
   * Save the single global company profile in database.
   */
  async saveCompanySettings(companyInfo: CompanyInfo): Promise<boolean> {
    try {
      const { data: existing, error: findError } = await supabase
        .from('company_settings')
        .select('id')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (findError) {
        console.warn('⚠️ Company profile lookup failed:', findError.message);
        return false;
      }

      const payload = {
        name: companyInfo.name,
        address: companyInfo.address,
        gst: companyInfo.gst,
        abn: companyInfo.abn || '',
        phone: companyInfo.phone,
        email: companyInfo.email,
        logo: companyInfo.logo || '',
        website: companyInfo.website || '',
        signature: companyInfo.signature || '',
        designation: companyInfo.designation || '',
        is_active: true,
      };

      const mutation = existing?.id
        ? supabase
          .from('company_settings')
          .update(payload)
          .eq('id', existing.id)
        : supabase
          .from('company_settings')
          .insert(payload);

      const { error } = await mutation;
      if (error) {
        console.warn('⚠️ Company profile save failed:', error.message);
        return false;
      }

      console.log('✅ Company settings saved');
      return true;
    } catch (error) {
      console.error('❌ Error saving company settings:', error);
      return false;
    }
  },

  /**
   * Subscribe to real-time company settings changes
   * Callback is triggered when company settings are updated
   */
  subscribeToChanges(callback: (companyInfo: CompanyInfo) => void) {
    const currentUserId = authService.getCurrentUser()?.id;
    if (!currentUserId) {
      return { unsubscribe: () => undefined };
    }

    const subscription = supabase
      .channel('company_settings_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'company_settings',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          console.log('🔄 Company settings updated:', payload);
          const data = payload.new as any;
          
          if (data && data.is_active) {
            const companyInfo: CompanyInfo = {
              name: data.name || '',
              address: data.address || '',
              gst: data.gst || '',
              abn: data.abn || '',
              phone: data.phone || '',
              email: data.email || '',
              logo: data.logo || '',
              website: data.website || '',
              signature: data.signature || '',
              designation: data.designation || '',
            };
            callback(companyInfo);
          }
        }
      )
      .subscribe();

    return subscription;
  },
};
