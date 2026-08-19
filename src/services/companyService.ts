import { supabase } from './supabaseClient';
import { CompanyInfo } from '../types/company';
import { updateCompanyProfile } from './userProfileService';

/**
 * Company Service - Manages company information with database sync
 * Provides fallback to localStorage if database is unavailable
 */
export const companyService = {
  /**
   * Fetch active company settings from database
   * Returns null if no company exists or on error
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
   * Save/Update company settings in database.
   * Writes go through a permission-checked RPC (admin / super agent only).
   */
  async saveCompanySettings(companyInfo: CompanyInfo): Promise<boolean> {
    try {
      const result = await updateCompanyProfile(companyInfo);
      if (!result.success) {
        console.warn('⚠️ Company profile update rejected:', result.message);
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
    const subscription = supabase
      .channel('company_settings_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'company_settings',
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
