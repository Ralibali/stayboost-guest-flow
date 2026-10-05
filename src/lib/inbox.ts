import { z } from "zod";
import type { ChatMessage } from "./supabase";

export const channelLabels = {
  webchat: "Webbchatt",
  email: "E-post",
  sms: "SMS",
  whatsapp: "WhatsApp",
} as const;
export const statusLabels = { open: "Öppen", waiting: "Väntar", resolved: "Klar" } as const;
export type InboxChannel = keyof typeof channelLabels;
export type InboxStatus = keyof typeof statusLabels;
export type InboxMessage = ChatMessage & {
  channel: InboxChannel;
  logged_manually: boolean;
  visitor_phone: string | null;
  booking_id: string | null;
  inbox_status: InboxStatus;
  assigned_to: string;
  followup_date: string | null;
  internal_note: string;
  inbox_version: number;
};
export type InboxBooking = {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  checkin_date: string;
  checkout_date: string;
  status: string;
};
export const manualMessageSchema = z
  .object({
    channel: z.enum(["email", "sms", "whatsapp"]),
    visitor_name: z.string().trim().min(1, "Ange gästens namn").max(120),
    visitor_email: z.union([
      z.literal(""),
      z.string().trim().email("Kontrollera e-postadressen").max(254),
    ]),
    visitor_phone: z.string().trim().max(30),
    message: z.string().trim().min(1, "Skriv meddelandet").max(4000),
  })
  .refine(
    (v) =>
      v.channel === "email"
        ? !!v.visitor_email
        : (v.channel === "whatsapp" ? /^\+\d{7,15}$/ : /^\+?\d{6,15}$/).test(
            v.visitor_phone.replace(/[ ()-]/g, ""),
          ),
    {
      message:
        "Ange e-post för mejl eller telefonnummer för SMS/WhatsApp (landskod krävs för WhatsApp)",
    },
  );
export function isOverdue(
  message: Pick<InboxMessage, "inbox_status" | "followup_date">,
  today: string,
) {
  return (
    message.inbox_status !== "resolved" && !!message.followup_date && message.followup_date < today
  );
}
export function replyLink(
  message: Pick<InboxMessage, "channel" | "visitor_email" | "visitor_phone">,
  propertyName: string,
) {
  if (message.channel === "sms" || message.channel === "whatsapp") {
    const phone = (message.visitor_phone ?? "").replace(/[ ()-]/g, "");
    if (!/^\+?\d{6,15}$/.test(phone)) return null;
    if (message.channel === "whatsapp")
      return /^\+\d{7,15}$/.test(phone) ? `https://wa.me/${phone.slice(1)}` : null;
    return `sms:${phone}`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.visitor_email)) return null;
  return `mailto:${encodeURIComponent(message.visitor_email)}?subject=${encodeURIComponent(`Svar från ${propertyName}`)}`;
}
export function safePageUrl(url: string | null) {
  try {
    const parsed = new URL(url ?? "");
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
