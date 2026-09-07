// Public client configuration for the existing StayBoost Supabase project.
// Environment overrides support previews and isolated test environments.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://dzicbkhtiafhsfizlxzw.supabase.co";
export const SUPABASE_PUBLIC_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_ySCqagBBHSleKHzX7B3Ksg_RcBei-eR";
