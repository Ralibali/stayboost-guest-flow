import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import {
  createSirvoyRecordsHandler,
  type SirvoyRecordsAdmin,
} from "../_shared/sirvoy-records-handler.ts";

// Keep the handler's dependency limited to the query methods exercised in its tests.
// Supabase's recursive generic query types cannot be structurally expanded by Deno.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
Deno.serve(createSirvoyRecordsHandler(admin as unknown as SirvoyRecordsAdmin));
