// StayBoost: publikt iCal-exportflöde per enhet (GET ?token=<enhetens feed-token>).
// Isolering: property_id härleds från token eller slug. Flödet innehåller bara
// blockerade datum — inga gästnamn, inga kontaktuppgifter.
import { buildIcs } from "./ics-export.ts";

export type TenantQuery = {
  select: (columns: string) => TenantQuery;
  eq: (column: string, value: unknown) => TenantQuery;
  gte: (column: string, value: unknown) => TenantQuery;
  lte: (column: string, value: unknown) => TenantQuery;
  order: (column: string) => TenantQuery;
  maybeSingle: () => Promise<{ data: any; error: any }>;
  then: (
    resolve: (value: { data: any; error: any }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

export type TenantAdmin = {
  from: (table: string) => TenantQuery;
};

const TOKEN_RE = /^[0-9a-f]{24}$/;

async function derivePropertyId(
  admin: TenantAdmin,
  token: string,
  slug: string,
): Promise<string | null> {
  if (slug) {
    const { data } = await admin.from("properties").select("id").eq("slug", slug).maybeSingle();
    return data?.id ?? null;
  }
  const { data } = await admin
    .from("units")
    .select("property_id")
    .eq("ical_feed_token", token)
    .maybeSingle();
  return data?.property_id ?? null;
}

export async function handleIcalExport(req: Request, admin: TenantAdmin): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const slug = (url.searchParams.get("slug") ?? "").trim();
  if (!TOKEN_RE.test(token)) {
    return new Response("invalid_token", { status: 400 });
  }

  const propertyId = await derivePropertyId(admin, token, slug);
  if (!propertyId) return new Response("not_found", { status: 404 });

  const { data: unit } = await admin
    .from("units")
    .select("id, name, property_id, property:properties(name)")
    .eq("ical_feed_token", token)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!unit) return new Response("not_found", { status: 404 });

  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const until = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, checkin_date, checkout_date")
    .eq("unit_id", unit.id)
    .eq("property_id", propertyId)
    .eq("status", "confirmed")
    .gte("checkout_date", since)
    .lte("checkin_date", until)
    .order("checkin_date");

  const events = (bookings ?? []).map((b: { id: string; checkin_date: string; checkout_date: string }) => ({
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
}
