import { createClient } from '@supabase/supabase-js';

// Extract credentials from connection string
const SUPABASE_URL = 'https://wkwrrdcjknvupwsfdjtd.supabase.co';

// You need to get the anon key from Supabase Dashboard -> Settings -> API
// For direct PostgreSQL connection, we'll use the service role key or anon key
// Replace this with your actual anon key from Supabase dashboard
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key-here';

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
    console.log('✅ Supabase connection successful');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection failed:', error);
    return false;
  }
};
