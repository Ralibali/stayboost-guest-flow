// StayBoost: mappning av Sirvoys "Booking event webhook"-payloads.
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen
// sirvoy-webhook och av enhetstesterna.
// Sirvoys JSON-schema är inte öppet dokumenterat, därför är mapparen
// tolerant mot flera fältnamn (samma verklighet som deras iCal-flöden).

export interface SirvoyBooking {
  externalId: string;
  roomRef: string | null;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  checkin: string; // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
  cancelled: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    let cur = obj;
    for (const key of p.split(".")) {
      cur = cur?.[key];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

const asDate = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m = v.match(ISO_DATE);
  return m ? m[0] : null;
};

const asString = (v: unknown): string | null => {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : null;
  return s && s.trim() ? s.trim() : null;
};

/** Normaliserar en Sirvoy-webhook-payload till vår bokningsform. Null = oanvändbar. */
export function mapSirvoyPayload(payload: any): SirvoyBooking | null {
  if (!payload || typeof payload !== "object") return null;

  const externalId = asString(
    pick(payload, ["booking_id", "bookingId", "id", "reservation_id", "reservationId"])
  );
  const checkin = asDate(
    pick(payload, ["checkin", "check_in", "checkin_date", "arrival", "from", "start_date"])
  );
  const checkout = asDate(
    pick(payload, ["checkout", "check_out", "checkout_date", "departure", "to", "end_date"])
  );
  if (!externalId || !checkin || !checkout || checkout <= checkin) return null;

  const statusRaw = String(
    pick(payload, ["status", "event", "type", "action", "booking_status"]) ?? ""
  ).toLowerCase();
  const cancelled = /cancel|delete|void|remove/.test(statusRaw);

  return {
    externalId,
    roomRef: asString(
      pick(payload, ["room_id", "roomId", "room", "room_name", "roomName", "unit_id", "unit"])
    ),
    guestName: asString(
      pick(payload, [
        "guest_name",
        "guestName",
        "guest.name",
        "customer_name",
        "name",
        "guest",
      ])
    ),
    guestEmail: asString(
      pick(payload, ["guest_email", "guestEmail", "guest.email", "email", "customer_email"])
    ),
    guestPhone: asString(
      pick(payload, ["guest_phone", "guestPhone", "guest.phone", "phone", "customer_phone"])
    ),
    checkin,
    checkout,
    cancelled,
  };
}
