import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleGuestPage } from "../_shared/guest-page.ts";

// Publik gästsida. Tokenen i länken är nyckeln; endast kuraterade fält lämnar servern.

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return handleGuestPage(req, admin);
});
