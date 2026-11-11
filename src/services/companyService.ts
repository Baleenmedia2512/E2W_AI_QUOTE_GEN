import { CompanyInfo } from '../types/company';
import { apiFetch } from './apiClient';

export const companyService = {
  async getCompanySettings(): Promise<CompanyInfo | null> {
    try {
      const { data, error } = await apiFetch<{ data?: Record<string, unknown> | null }>(
        '/api/company',
      );
      if (error || !data?.data) {
        if (error) console.warn('⚠️ Database fetch failed, using localStorage fallback:', error);
        return null;
      }
      const row = data.data;
      return {
        name: String(row.name || ''),
        address: String(row.address || ''),
        gst: String(row.gst || ''),
        abn: String(row.abn || ''),
        phone: String(row.phone || ''),
        email: String(row.email || ''),
        logo: String(row.logo || ''),
        website: String(row.website || ''),
        signature: String(row.signature || ''),
        designation: String(row.designation || ''),
      };
    } catch (error) {
      console.error('❌ Error fetching company settings:', error);
      return null;
    }
  },

  async saveCompanySettings(companyInfo: CompanyInfo): Promise<boolean> {
    try {
      const { error } = await apiFetch('/api/company', {
        method: 'PUT',
        body: JSON.stringify(companyInfo),
      });
      if (error) {
        console.warn('⚠️ Company profile save failed:', error);
        return false;
      }
      console.log('✅ Company settings saved');
      return true;
    } catch (error) {
      console.error('❌ Error saving company settings:', error);
      return false;
    }
  },

  /** Realtime removed with Supabase — no-op unsubscribe. */
  subscribeToChanges(_callback: (companyInfo: CompanyInfo) => void) {
    return { unsubscribe: () => undefined };
  },
};
