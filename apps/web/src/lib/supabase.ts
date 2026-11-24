import type { SupabaseClient } from '@supabase/supabase-js';
import { createCalxSupabaseClient } from '@calx/messaging';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseConfigStatus(): { configured: boolean; url: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const configured =
    Boolean(url) &&
    Boolean(anonKey) &&
    !url.includes('your-project-ref') &&
    !anonKey.includes('your-supabase-anon-key');
  return { configured, url };
}

export function getWebSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes('your-project-ref')) {
    return null;
  }
  cachedClient = createCalxSupabaseClient({ url, anonKey });
  return cachedClient;
}
