import { formatSvDate, renderTemplate } from "./templates.ts";
import { appBaseUrl } from "./app-url.ts";

// The cron worker owns the global queue. Each row still needs a consistent
// booking -> property -> template/unit binding before guest content is delivered.
export type PendingMessage = {
  id: string;
  booking_id: string;
  template_id: string | null;
  channel: "email" | "sms";
  send_at: string;
  booking: {
    id: string;
    property_id: string | null;
    status: string;
    guest_name: string | null;
    guest_email: string | null;
    guest_phone: string | null;
    checkin_date: string;
    checkout_date: string;
    guest_token: string;
    payment_status: string | null;
    unit: { name: string; property_id: string } | null;
    property: {
      id: string;
      name: string;
      checkin_time: string | null;
      checkout_time: string | null;
      directions: string | null;
      wifi_name: string | null;
      wifi_password: string | null;
      contact_phone: string | null;
      review_url: string | null;
    } | null;
  } | null;
  template: {
    id: string;
    property_id: string;
    subject: string | null;
    body: string;
  } | null;
};

type QueryResult = {
  data: PendingMessage[] | null;
  error: { message: string } | null;
};
export interface MessageQuery extends PromiseLike<QueryResult> {
  select(columns: string): MessageQuery;
  update(values: Record<string, unknown>): MessageQuery;
  eq(column: string, value: unknown): MessageQuery;
  is(column: string, value: null): MessageQuery;
  lte(column: string, value: string): MessageQuery;
  order(column: string, options: { ascending: boolean }): MessageQuery;
  limit(count: number): MessageQuery;
}
export type MessageStore = { from(table: "scheduled_messages"): MessageQuery };
export type DeliveryOptions = {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => Date;
};

function messageUpdate(admin: MessageStore, row: PendingMessage, patch: Record<string, unknown>) {
  // scheduled_messages has no property_id. Pin writes to the validated parent
  // binding, including the template, and never revive a cancelled/sent item.
  const query = admin
    .from("scheduled_messages")
    .update(patch)
    .eq("id", row.id)
    .eq("booking_id", row.booking_id)
    .eq("status", "pending");
  return row.template_id === null
    ? query.is("template_id", null)
    : query.eq("template_id", row.template_id);
}

export async function sendScheduledMessages(admin: MessageStore, options: DeliveryOptions) {
  const baseUrl = appBaseUrl(options.env("GUEST_PAGE_BASE_URL"));
  const now = options.now().toISOString();

  const { data: due, error } = await admin
    .from("scheduled_messages")
    .select(
      "id, booking_id, template_id, channel, send_at, template:message_templates(id, property_id, subject, body), booking:bookings(id, property_id, status, guest_name, guest_email, guest_phone, checkin_date, checkout_date, guest_token, payment_status, unit:units(name, property_id), property:properties(id, name, checkin_time, checkout_time, directions, wifi_name, wifi_password, contact_phone, review_url))",
    )
    .eq("status", "pending")
    .lte("send_at", now)
    .order("send_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;
  let waitingContact = 0;
  let waitingPayment = 0;
  const sevenDaysAgo = options.now().getTime() - 7 * 24 * 60 * 60 * 1000;

  for (const row of due ?? []) {
    const b = row.booking;
    const p = b?.property;
    const tpl = row.template;
    if (
      !b ||
      !p ||
      !tpl ||
      !b.property_id ||
      b.id !== row.booking_id ||
      tpl.id !== row.template_id ||
      p.id !== b.property_id ||
      tpl.property_id !== b.property_id ||
      (b.unit !== null && b.unit?.property_id !== b.property_id)
    ) {
      await messageUpdate(admin, row, { status: "failed", error: "message_scope_invalid" });
      failed++;
      continue;
    }

    if (b.status !== "confirmed") {
      await messageUpdate(admin, row, { status: "failed", error: "booking_not_confirmed" });
      failed++;
      continue;
    }

    // Skicka endast när betalningsläget faktiskt tillåter gästkommunikation.
    // none = extern/manuell bokning utan StayBoost-betalning, paid = betalad direktbokning.
    if (!["none", "paid"].includes(String(b.payment_status ?? "none"))) {
      waitingPayment++;
      continue;
    }

    const contact = row.channel === "email" ? b.guest_email : b.guest_phone;
    if (!contact) {
      if (new Date(row.send_at).getTime() < sevenDaysAgo) {
        await messageUpdate(admin, row, { status: "failed", error: "saknar kontaktuppgift" });
        failed++;
      } else {
        waitingContact++;
      }
      continue;
    }

    const vars: Record<string, string> = {
      gäst_namn: b.guest_name || "gäst",
      anläggning: p.name ?? "",
      enhet: b.unit?.name ?? "",
      incheckning: formatSvDate(b.checkin_date),
      utcheckning: formatSvDate(b.checkout_date),
      incheckningstid: p.checkin_time ?? "",
      utcheckningstid: p.checkout_time ?? "",
      gästsida_länk: `${baseUrl}/g/${b.guest_token}`,
      wifi_namn: p.wifi_name ?? "",
      wifi_lösenord: p.wifi_password ?? "",
      vägbeskrivning: p.directions ?? "",
      recensionslänk: p.review_url ?? "",
    };
    const body = renderTemplate(tpl.body ?? "", vars);
    const subject = renderTemplate(tpl.subject ?? "", vars);

    try {
      if (row.channel === "email") {
        const apiKey = options.env("BREVO_API_KEY") ?? "";
        const senderEmail = options.env("BREVO_SENDER_EMAIL") ?? "";
        if (!apiKey || !senderEmail) throw new Error("Brevo är inte konfigurerat");
        const response = await options.fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: { email: senderEmail, name: options.env("BREVO_SENDER_NAME") ?? p.name },
            to: [{ email: contact, name: b.guest_name ?? undefined }],
            subject: subject || `Meddelande från ${p.name}`,
            textContent: body,
          }),
        });
        if (!response.ok) {
          throw new Error(`Brevo ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
      } else {
        const user = options.env("ELKS_API_USER") ?? "";
        const password = options.env("ELKS_API_PASSWORD") ?? "";
        if (!user || !password) throw new Error("46elks är inte konfigurerat");
        const auth = btoa(`${user}:${password}`);
        const response = await options.fetch("https://api.46elks.com/a1/sms", {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            from: options.env("ELKS_SENDER") ?? "StayBoost",
            to: contact,
            message: body,
          }),
        });
        if (!response.ok) {
          throw new Error(`46elks ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
      }

      await messageUpdate(admin, row, {
        status: "sent",
        sent_at: options.now().toISOString(),
        error: null,
      });
      sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await messageUpdate(admin, row, { status: "failed", error: message.slice(0, 500) });
      failed++;
    }
  }

  return {
    due: due?.length ?? 0,
    sent,
    failed,
    waitingContact,
    waitingPayment,
  };
}
