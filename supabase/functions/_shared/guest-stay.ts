export type StayPhase = "before" | "arrival" | "during" | "departure" | "finished" | "no_show";
export function stockholmDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function stayPhase(
  checkin: string,
  checkout: string,
  status: string,
  now = new Date(),
): StayPhase {
  if (status === "no_show") return "no_show";
  const day = stockholmDay(now);
  if (status === "checked_out" || day > checkout) return "finished";
  if (day < checkin) return "before";
  if (day === checkin) return "arrival";
  if (day === checkout) return "departure";
  return "during";
}
export function accessAvailable(
  checkin: string,
  checkout: string,
  status: string,
  now = new Date(),
) {
  if (status === "checked_out" || status === "no_show") return false;
  const start = new Date(`${checkin}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const day = stockholmDay(now);
  return day >= start.toISOString().slice(0, 10) && day <= checkout;
}
export function guestAddon(
  row: Record<string, unknown>,
  booking: { unit_id: string | null; checkin_date: string; checkout_date: string },
) {
  const details = row.details as Record<string, unknown> | null;
  if (
    !details ||
    typeof details.quantity !== "number" ||
    !Number.isInteger(details.quantity) ||
    details.quantity < 1
  )
    return null;
  return {
    id: row.id,
    name: row.title,
    quantity: details.quantity,
    dueDate: row.due_date,
    status: row.status,
    nameSource: details.name_source,
    contextChanged:
      details.unit_id !== booking.unit_id ||
      details.checkin_date !== booking.checkin_date ||
      details.checkout_date !== booking.checkout_date,
  };
}
