import type { SupabaseClient } from '@supabase/supabase-js';
import { createCalxSupabaseClient } from '@calx/messaging';

let mobileClient: SupabaseClient | null = null;

export function getMobileSupabaseClient(): SupabaseClient | null {
  if (mobileClient) return mobileClient;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes('your-project-ref')) {
    return null;
  }
  mobileClient = createCalxSupabaseClient({ url, anonKey });
  return mobileClient;
}
