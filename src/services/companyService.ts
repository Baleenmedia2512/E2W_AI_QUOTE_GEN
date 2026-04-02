import { supabase } from './supabaseClient';
import { CompanyInfo } from '../types/company';

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
        .single();

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
   * Save/Update company settings in database
   * Updates the active company record or creates new one
   */
  async saveCompanySettings(companyInfo: CompanyInfo): Promise<boolean> {
    try {
      // First, try to get existing active company
      const { data: existing } = await supabase
        .from('company_settings')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single();

      if (existing?.id) {
        // Update existing record
        const { error } = await supabase
          .from('company_settings')
          .update({
            name: companyInfo.name,
            address: companyInfo.address,
            gst: companyInfo.gst,
            abn: companyInfo.abn,
            phone: companyInfo.phone,
            email: companyInfo.email,
            logo: companyInfo.logo,
            website: companyInfo.website,
            signature: companyInfo.signature,
            designation: companyInfo.designation,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (error) {
          console.warn('⚠️ Database update failed, using localStorage only:', error.message);
          return false;
        }

        console.log('✅ Company settings updated in database');
        return true;
      } else {
        // Insert new record
        const { error } = await supabase
          .from('company_settings')
          .insert({
            name: companyInfo.name,
            address: companyInfo.address,
            gst: companyInfo.gst,
            abn: companyInfo.abn,
            phone: companyInfo.phone,
            email: companyInfo.email,
            logo: companyInfo.logo,
            website: companyInfo.website,
            signature: companyInfo.signature,
            designation: companyInfo.designation,
            is_active: true,
          });

        if (error) {
          console.warn('⚠️ Database insert failed, using localStorage only:', error.message);
          return false;
        }

        console.log('✅ Company settings created in database');
        return true;
      }
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
