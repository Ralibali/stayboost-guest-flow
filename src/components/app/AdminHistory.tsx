import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Event = {
  id: string;
  entity: string;
  entity_id: string | null;
  action: string;
  actor_id: string | null;
  changes: { fields?: string[] } | null;
  created_at: string;
};
const entities: Record<string, string> = {
  properties: "Anläggning",
  units: "Boende",
  bookings: "Bokning",
  addons: "Tillval",
  rate_rules: "Prisregel",
  message_templates: "Meddelandemall",
  ical_sources: "Kalenderkoppling",
};
const actions: Record<string, string> = { INSERT: "Skapad", UPDATE: "Ändrad", DELETE: "Borttagen" };
const fields: Record<string, string> = {
  guest_name: "gästnamn",
  guest_email: "e-post",
  guest_phone: "telefon",
  guests: "antal gäster",
  unit_id: "boende",
  checkin_date: "ankomst",
  checkout_date: "avresa",
  internal_notes: "intern anteckning",
  stay_status: "ankomststatus",
  status: "bokningsstatus",
  name: "namn",
  active: "synlighet",
  price: "pris",
  base_price: "nattpris",
  max_guests: "kapacitet",
  booking_enabled: "bokningsstatus",
  max_stay: "längsta vistelse",
  date_from: "startdatum",
  date_to: "slutdatum",
  body: "meddelandetext",
  enabled: "aktivering",
  door_code: "portkod",
  wifi_password: "wifi-lösenord",
};

export function AdminHistory({
  propertyId,
  bookingId,
}: {
  propertyId: string;
  bookingId?: string;
}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(false);
    let query = supabase
      .from("admin_audit_log")
      .select("id,entity,entity_id,action,actor_id,changes,created_at")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (bookingId) query = query.eq("entity", "bookings").eq("entity_id", bookingId);
    const { data, error: failure } = await query;
    setError(Boolean(failure));
    setEvents((data ?? []) as Event[]);
    setLoading(false);
  }, [propertyId, bookingId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="card-surface mt-6 p-5">
      <div className="flex justify-between gap-3">
        <h2 className="font-semibold">Ändringshistorik</h2>
        <button type="button" disabled={loading} onClick={load} className="text-sm underline">
          Uppdatera
        </button>
      </div>
      <p className="mt-1 text-sm text-[color:var(--ink)]/60">
        De 50 senaste administrativa ändringarna. Innehållet i lösenord och gästuppgifter sparas
        inte i historiken.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          Historiken kunde inte hämtas. Försök igen.
        </p>
      ) : loading ? (
        <p className="mt-3 text-sm">Laddar…</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-sm text-[color:var(--ink)]/60">Inga registrerade ändringar ännu.</p>
      ) : (
        <ol className="mt-3 divide-y divide-[color:var(--line)]">
          {events.map((event) => (
            <li key={event.id} className="py-3 text-sm">
              <p className="font-medium">
                {entities[event.entity] ?? "Inställning"} · {actions[event.action] ?? event.action}
              </p>
              <p className="mt-1 text-[color:var(--ink)]/60">
                {new Date(event.created_at).toLocaleString("sv-SE")} ·{" "}
                {event.actor_id ? "Anläggningens administratör" : "System"}
              </p>
              {event.changes?.fields?.length ? (
                <p className="mt-1">
                  {event.changes.fields
                    .map((field) => fields[field] ?? field.replaceAll("_", " "))
                    .join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
