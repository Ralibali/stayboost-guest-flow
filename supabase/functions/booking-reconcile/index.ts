import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: session, error: authenticationError } = await user.auth.getUser();
  if (authenticationError || !session.user) return json({ error: "unauthorized" }, 401);
  let body: {
    bookingId?: string;
    action?: string;
    amount?: number;
    occurredAt?: string;
    evidence?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.bookingId ?? "") ||
    !["record_payment", "record_refund"].includes(body.action ?? "") ||
    !Number.isSafeInteger(body.amount) ||
    (body.amount ?? 0) < 1 ||
    (body.amount ?? 0) > 10000000 ||
    typeof body.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(body.occurredAt)) ||
    typeof body.evidence !== "string" ||
    body.evidence.trim().length < 3 ||
    body.evidence.trim().length > 1000
  )
    return json({ error: "invalid_payment_evidence" }, 400);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin.rpc("reconcile_imported_payment", {
    p_actor: session.user.id,
    p_booking: body.bookingId,
    p_action: body.action,
    p_amount: body.amount,
    p_occurred_at: body.occurredAt,
    p_evidence: body.evidence,
  });
  if (error) {
    const codes = [
      "booking_not_found",
      "not_imported_payment",
      "invalid_payment_evidence",
      "payment_amount_mismatch",
      "payment_already_recorded",
      "invalid_import_payment_state",
      "invalid_import_refund_state",
    ];
    const code =
      codes.find((value) => error.message.includes(value)) ?? "payment_reconciliation_failed";
    return json(
      { error: code },
      code === "booking_not_found" ? 404 : code === "payment_reconciliation_failed" ? 503 : 409,
    );
  }
  return json(data);
});
