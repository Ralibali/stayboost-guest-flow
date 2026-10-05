import { describe, expect, it } from "vitest";
import { isOverdue, manualMessageSchema, replyLink, safePageUrl } from "./inbox";

describe("Inbox triage and external reply boundaries", () => {
  it("does not mark resolved or same-day followups overdue", () => {
    expect(isOverdue({ inbox_status: "open", followup_date: "2026-10-04" }, "2026-10-05")).toBe(
      true,
    );
    expect(isOverdue({ inbox_status: "resolved", followup_date: "2026-10-04" }, "2026-10-05")).toBe(
      false,
    );
    expect(isOverdue({ inbox_status: "waiting", followup_date: "2026-10-05" }, "2026-10-05")).toBe(
      false,
    );
  });
  it("requires an actual contact for the selected manual channel", () => {
    const input = {
      channel: "sms",
      visitor_name: "Guest",
      visitor_email: "",
      visitor_phone: "+46701234567",
      message: "Arrival question",
    };
    expect(manualMessageSchema.safeParse(input).success).toBe(true);
    expect(manualMessageSchema.safeParse({ ...input, visitor_phone: "" }).success).toBe(false);
    expect(manualMessageSchema.safeParse({ ...input, visitor_phone: "------" }).success).toBe(
      false,
    );
    expect(
      manualMessageSchema.safeParse({ ...input, channel: "whatsapp", visitor_phone: "0701234567" })
        .success,
    ).toBe(false);
    expect(manualMessageSchema.safeParse({ ...input, channel: "email" }).success).toBe(false);
    expect(manualMessageSchema.safeParse({ ...input, channel: "webchat" }).success).toBe(false);
  });
  it("requires an international WhatsApp number and blocks unsafe URL schemes", () => {
    expect(
      replyLink({ channel: "whatsapp", visitor_email: "", visitor_phone: "070-123 45 67" }, "Stay"),
    ).toBeNull();
    expect(
      replyLink(
        { channel: "whatsapp", visitor_email: "", visitor_phone: "+46 70-123 45 67" },
        "Stay",
      ),
    ).toBe("https://wa.me/46701234567");
    expect(safePageUrl("javascript:alert(1)")).toBeNull();
    expect(safePageUrl("https://stayboost.se/test")).toBe("https://stayboost.se/test");
  });
});
