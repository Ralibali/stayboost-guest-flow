import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleIcalExport } from "../_shared/ical-export.ts";

// StayBoost: publikt iCal-exportflöde per enhet (GET ?token=<enhetens feed-token>).
// Klistras in i Airbnb ("Importera kalender") och Booking.com ("Synkronisera
// kalendrar") så blockerar kanalen datum som är bokade via andra vägar.
// Integritet: flödet innehåller bara blockerade datum — inga gästnamn,
// inga kontaktuppgifter. OBS: verify_jwt = false (se supabase/config.toml).

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return handleIcalExport(req, admin);
});
