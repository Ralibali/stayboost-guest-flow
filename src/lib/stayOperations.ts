import { z } from "zod";
import { supabase } from "./supabase";
export const operationSchema = z.object({
  id: z.string().uuid(),
  booking_id: z.string().uuid(),
  property_id: z.string().uuid(),
  kind: z.enum(["cleaning", "addon"]),
  title: z.string(),
  details: z.record(z.unknown()),
  due_date: z.string(),
  status: z.enum(["pending", "in_progress", "done"]),
  assigned_to: z.string(),
  revision: z.number().int(),
  history: z.array(
    z.object({
      label: z.string(),
      at: z.string(),
      note: z.string().optional(),
      assigned_to: z.string().optional(),
    }),
  ),
  context_changed: z.boolean().optional(),
  booking: z
    .object({
      guest_name: z.string().nullable(),
      checkin_date: z.string(),
      checkout_date: z.string(),
      status: z.string(),
      stay_status: z.string(),
      payment_status: z.string().nullable(),
      unit_name: z.string().nullable(),
    })
    .optional(),
});
export type StayOperation = z.infer<typeof operationSchema>;
export async function operationsBoard(property: string, from: string, to: string) {
  if (!supabase) throw new Error("Anslutningen saknas");
  const { data, error } = await supabase.rpc("stay_operations_board", {
    p_property: property,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return z.array(operationSchema).parse(data);
}
export async function changeOperation(
  id: string,
  revision: number,
  action: string,
  payload: Record<string, unknown>,
) {
  if (!supabase) throw new Error("Anslutningen saknas");
  const { data, error } = await supabase.rpc("change_stay_operation", {
    p_id: id,
    p_revision: revision,
    p_action: action,
    p_data: payload,
  });
  if (error) throw new Error(error.message);
  return operationSchema.parse(data);
}
export function operationLabel(task: Pick<StayOperation, "kind" | "status">) {
  if (task.status === "done") return task.kind === "cleaning" ? "Städat" : "Levererat";
  if (task.status === "in_progress")
    return task.kind === "cleaning" ? "Städning pågår" : "Förbereds";
  return task.kind === "cleaning" ? "Återstår att städa" : "Inväntar leverans";
}
export function localDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
