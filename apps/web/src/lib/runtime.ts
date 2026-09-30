export interface RuntimeConfig {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export function getRuntimeConfig(): RuntimeConfig | null {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!apiBaseUrl || !supabaseUrl || !supabasePublishableKey) return null;
  if (supabasePublishableKey.startsWith('replace-')) return null;
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    supabasePublishableKey
  };
}
