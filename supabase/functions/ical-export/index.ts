import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildIcs } from "../_shared/ics-export.ts";

// StayBoost: publikt iCal-exportflöde per enhet (GET ?token=<enhetens feed-token>).
// Klistras in i Airbnb ("Importera kalender") och Booking.com ("Synkronisera
// kalendrar") så blockerar kanalen datum som är bokade via andra vägar.
// Integritet: flödet innehåller bara blockerade datum — inga gästnamn,
// inga kontaktuppgifter. OBS: verify_jwt = false (se supabase/config.toml).

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{24}$/.test(token)) {
    return new Response("invalid_token", { status: 400 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: unit } = await admin
    .from("units")
    .select("id, name, property:properties(name)")
    .eq("ical_feed_token", token)
    .maybeSingle();
  if (!unit) return new Response("not_found", { status: 404 });

  // Exportera bekräftade bokningar från 30 dagar bakåt och ett år framåt.
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const until = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, checkin_date, checkout_date")
    .eq("unit_id", unit.id)
    .eq("status", "confirmed")
    .gte("checkout_date", since)
    .lte("checkin_date", until)
    .order("checkin_date");

  const events = (bookings ?? []).map((b) => ({
    uid: `${b.id}@stayboost`,
    startDate: b.checkin_date,
    endDate: b.checkout_date,
    summary: "Bokad",
  }));

  const propertyName = (unit as { property?: { name?: string } }).property?.name ?? "StayBoost";
  const ics = buildIcs(events, `${propertyName} — ${unit.name}`);
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${unit.name.replace(/[^a-z0-9]+/gi, "_")}.ics"`,
      "Cache-Control": "no-cache",
    },
  });
});
