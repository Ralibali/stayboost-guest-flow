import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

/* StayBoost: Supabase-klient + delade typer för operatörs-UI:t (/app).
   Kräver VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY i miljön —
   saknas de visar appen en konfigurationsvy i stället för att krascha. */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!)
  : null;

/* ---------- Typer (speglar migrationerna) ---------- */

export type Property = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  checkin_time: string;
  checkout_time: string;
  directions: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  house_rules: string | null;
  contact_phone: string | null;
  review_url: string | null;
  swish_number: string | null;
  swish_hold_minutes: number;
  sirvoy_webhook_token: string;
};

export type Unit = {
  id: string;
  property_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  max_guests: number;
  bed_description: string | null;
  size_sqm: number | null;
  amenities: string[];
  checkin_instructions: string | null;
  active: boolean;
  door_code: string | null;
  sort_order: number;
  ical_feed_token: string;
  base_price: number;
  weekend_pct: number;
  min_stay: number;
  cleaning_fee: number;
  monthly_mult: number[];
  external_ref: string | null;
};

/** Publik iCal-exportlänk för en enhet (klistras in i Airbnb/Booking). */
export const icalExportUrl = (unit: Unit) => {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
  return base ? `${base}/functions/v1/ical-export?token=${unit.ical_feed_token}` : "";
};

export type Booking = {
  id: string;
  property_id: string;
  unit_id: string | null;
  source: "manual" | "ical" | "direct" | "sirvoy";
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  checkin_date: string;
  checkout_date: string;
  status: "confirmed" | "cancelled";
  guest_token: string;
  notes: string | null;
  payment_status: "none" | "pending" | "paid" | "refunded";
  payment_amount: number | null;
  payment_ref: string | null;
  payment_method: "none" | "swish" | "stripe";
  payment_expires_at: string | null;
  stripe_session_id: string | null;
  addons_total: number;
  guests: number | null;
  created_at: string;
  updated_at: string;
  unit?: { name: string; max_guests?: number } | null;
};

export type ScheduledMessage = {
  id: string;
  booking_id: string;
  channel: "email" | "sms";
  send_at: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  error: string | null;
  template?: { trigger_type: string } | null;
};

export type IcalChannelType = "sirvoy" | "booking" | "airbnb" | "other";

export type IcalSource = {
  id: string;
  property_id: string;
  unit_id: string;
  name: string;
  url: string;
  channel_type: IcalChannelType;
  paused: boolean;
  last_synced_at: string | null;
  last_status: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  unit?: { name: string } | null;
};

export const CHANNEL_LABELS: Record<IcalChannelType, string> = {
  sirvoy: "Sirvoy",
  booking: "Booking.com",
  airbnb: "Airbnb",
  other: "Annan",
};

/** Härleder kanaltyp från namn/URL när fältet saknas (t.ex. äldre rader). */
export function inferChannelType(source: Pick<IcalSource, "name" | "url">): IcalChannelType {
  const haystack = `${source.name} ${source.url}`.toLowerCase();
  if (haystack.includes("sirvoy")) return "sirvoy";
  if (haystack.includes("airbnb")) return "airbnb";
  if (haystack.includes("booking")) return "booking";
  return "other";
}

export type IcalHealth = "green" | "yellow" | "red" | "paused";

/** Klassificerar en källas hälsa. Röd vid ≥2 fel i följd, gul vid ett fel
 *  eller synk äldre än 6 timmar, grön vid färsk lyckad synk. */
export function classifyIcalHealth(
  source: Pick<
    IcalSource,
    "paused" | "consecutive_failures" | "last_success_at" | "last_synced_at" | "last_status"
  >,
  now: Date = new Date(),
): IcalHealth {
  if (source.paused) return "paused";
  const failures = source.consecutive_failures ?? 0;
  if (failures >= 2) return "red";
  const lastOk = source.last_success_at ?? (
    source.last_status?.toLowerCase().startsWith("ok") ? source.last_synced_at : null
  );
  const ageMs = lastOk ? now.getTime() - new Date(lastOk).getTime() : Infinity;
  const sixHours = 6 * 60 * 60 * 1000;
  if (failures >= 1 || ageMs > sixHours) return "yellow";
  return "green";
}

export type MessageTemplate = {
  id: string;
  property_id: string;
  trigger_type: "booking_created" | "pre_arrival" | "checkin_day" | "post_stay";
  offset_days: number;
  send_time: string;
  channel: "email" | "sms" | "both";
  subject: string | null;
  body: string;
  enabled: boolean;
};

export const TRIGGER_LABELS: Record<MessageTemplate["trigger_type"], string> = {
  booking_created: "Bokningsbekräftelse",
  pre_arrival: "Inför ankomst",
  checkin_day: "Incheckningsdagen",
  post_stay: "Efter vistelsen",
};

export type Addon = {
  id: string;
  property_id: string;
  name: string;
  description: string | null;
  price: number;
  price_type: "per_booking" | "per_night";
  image_url: string | null;
  active: boolean;
  sort_order: number;
};

/* ---------- Hooks ---------- */

/** Aktuell Supabase-session (null = utloggad, undefined = laddar). */
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

/** Anläggningen som den inloggade äger (null = saknas, undefined = laddar). */
export function useProperty(session: Session | null | undefined) {
  const [property, setProperty] = useState<Property | null | undefined>(undefined);
  const [units, setUnits] = useState<Unit[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!supabase || !session) {
      setProperty(session === null ? null : undefined);
      return;
    }
    let alive = true;
    (async () => {
      const { data: props } = await supabase
        .from("properties")
        .select("*")
        .order("created_at")
        .limit(1);
      if (!alive) return;
      const p = (props?.[0] as Property | undefined) ?? null;
      setProperty(p);
      if (p) {
        const { data: us } = await supabase
          .from("units")
          .select("*")
          .eq("property_id", p.id)
          .order("sort_order")
          .order("created_at");
        if (alive) setUnits((us as Unit[]) ?? []);
      } else {
        setUnits([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session, reloadTick]);

  return { property, units, reload: () => setReloadTick((t) => t + 1) };
}

export const guestPageUrl = (token: string) => `${window.location.origin}/g/${token}`;
