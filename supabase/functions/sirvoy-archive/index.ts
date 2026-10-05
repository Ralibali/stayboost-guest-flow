import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { createSirvoyArchiveHandler } from "../_shared/sirvoy-archive-handler.ts";

Deno.serve(
  createSirvoyArchiveHandler(
    createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
  ),
);
