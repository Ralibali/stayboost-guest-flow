import { createClient } from "https://esm.sh/@supabase/supabase-js@2.109.0";
import { buildIcs, closedRuleEvents, type IcsClosedRule } from "../_shared/ics-export.ts";

// Publikt token-skyddat iCal-flöde per enhet. Bara bokade/stängda datum exporteras,
// aldrig gästuppgifter eller privata namn/anteckningar från stängningsregler.
// CTA, CTD och minsta vistelse kan inte uttryckas som blockerade nätter i iCal.

const PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 10_000;
interface ExportPage<T> {
  data: T[] | null;
  error: unknown;
  count: number | null;
}

async function readAll<T>(
  readPage: (from: number, to: number) => PromiseLike<ExportPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | undefined;
  do {
    const page = await readPage(rows.length, rows.length + PAGE_SIZE - 1);
    if (
      page.error ||
      !Array.isArray(page.data) ||
      !Number.isSafeInteger(page.count) ||
      page.count! < 0 ||
      page.count! > MAX_EXPORT_ROWS
    ) {
      throw new Error("calendar_read_failed");
    }
    if (total !== undefined && page.count !== total)
      throw new Error("calendar_changed_during_read");
    total = page.count!;
    if ((page.data.length === 0 && rows.length < total) || rows.length + page.data.length > total) {
      throw new Error("calendar_read_incomplete");
    }
    rows.push(...page.data);
  } while (rows.length < total);
  return rows;
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{24}$/.test(token)) return new Response("invalid_token", { status: 400 });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: unit, error: unitError } = await admin
      .from("units")
      .select("id, property_id, name, property:properties(name)")
      .eq("ical_feed_token", token)
      .maybeSingle();
    if (unitError) throw new Error("calendar_read_failed");
    if (!unit) return new Response("not_found", { status: 404 });

    // Samma fönster för bokningar och stängningar. Behåll hela överlappande intervall.
    const now = Date.now();
    const since = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
    const until = new Date(now + 365 * 86400000).toISOString().slice(0, 10);
    const [bookings, rules] = await Promise.all([
      readAll<{ id: string; checkin_date: string; checkout_date: string }>((from, to) =>
        admin
          .from("bookings")
          .select("id, checkin_date, checkout_date", { count: "exact" })
          .eq("unit_id", unit.id)
          .eq("status", "confirmed")
          .gte("checkout_date", since)
          .lte("checkin_date", until)
          .order("id")
          .range(from, to),
      ),
      readAll<IcsClosedRule>((from, to) =>
        admin
          .from("rate_rules")
          .select("id, unit_id, kind, active, date_from, date_to", { count: "exact" })
          .eq("property_id", unit.property_id)
          .eq("active", true)
          .eq("kind", "closed")
          .or(`unit_id.is.null,unit_id.eq.${unit.id}`)
          .gte("date_to", since)
          .lte("date_from", until)
          .order("id")
          .range(from, to),
      ),
    ]);
    const events = [
      ...bookings.map((b) => ({
        uid: `${b.id}@stayboost`,
        startDate: b.checkin_date,
        endDate: b.checkout_date,
        summary: "Bokad",
      })),
      ...closedRuleEvents(rules, unit.id),
    ].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.uid.localeCompare(b.uid));
    const propertyName = (unit as { property?: { name?: string } }).property?.name ?? "StayBoost";
    return new Response(buildIcs(events, `${propertyName} — ${unit.name}`), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${unit.name.replace(/[^a-z0-9]+/gi, "_")}.ics"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    // An empty/partial success response would incorrectly reopen dates on the receiving channel.
    return new Response("calendar_unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
});
