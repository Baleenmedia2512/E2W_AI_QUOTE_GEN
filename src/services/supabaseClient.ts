import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

// Read from environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  logger.warn('⚠️ Supabase credentials missing in .env file');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public',
  },
});

// Helper to test connection
export const testConnection = async () => {
  try {
    const { error } = await supabase.from('User').select('count');
    if (error) throw error;
    logger.info('✅ Supabase connection successful');
    return true;
  } catch (error) {
    logger.error('❌ Supabase connection failed:', error);
    return false;
  }
};
