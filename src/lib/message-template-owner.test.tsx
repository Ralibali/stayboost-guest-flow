import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageTemplate } from "./supabase";
import {
  editMessageLanguage,
  messageDraftPatch,
  MessagePreview,
  MessageTemplateEditor,
  saveMessageDraft,
} from "../routes/app/mallar";
import { MESSAGE_LANGUAGES } from "../../supabase/functions/_shared/message-content";

const exact = "  Första raden 💚\n\nSista raden.  ";
const legacy: MessageTemplate = {
  id: "template",
  property_id: "property",
  revision: 4,
  name: "Mall",
  trigger_type: "pre_arrival",
  offset_days: -1,
  send_time: "09:30:00",
  channel: "email",
  subject: "Legacy ämne",
  body: exact,
  body_format: "text",
  content_translations: {},
  enabled: false,
  source_archive_id: null,
  source_template_id: null,
  source_schedule_archive_id: null,
  source_metadata: {},
  source_reviewed_at: null,
  activation_starts_at: null,
};
const imported: MessageTemplate = {
  ...legacy,
  name: "Importerad mall",
  body_format: "html",
  source_archive_id: "PRIVATE-ARCHIVE",
  source_template_id: "32166",
  source_metadata: {
    event: { value_exact: "none", label_display_normalized: "Nej" },
    days: { value_exact: "0", hidden_in_saved_dom: true },
  },
  content_translations: Object.fromEntries(
    MESSAGE_LANGUAGES.map((lang) => [
      lang,
      {
        subject: lang === "sv" ? "Exakt ämne" : "123",
        body: `<p>${lang}: ${exact}</p>`,
      },
    ]),
  ),
};
const editor = (template: MessageTemplate) =>
  renderToStaticMarkup(
    <MessageTemplateEditor
      template={template}
      dirty={false}
      saving={false}
      busy={false}
      saved={false}
      onEdit={() => {}}
      onSave={() => {}}
      onReload={() => {}}
    />,
  );

describe("message template owner drafts", () => {
  it("preserves legacy strings and does not invent translations when editing Swedish", () => {
    const draft = editMessageLanguage(legacy, "sv", { body: `${exact}\nTillägg  ` });
    expect(draft.body).toBe(`${exact}\nTillägg  `);
    expect(draft.content_translations).toEqual({});
    expect(legacy.body).toBe(exact);
    expect(legacy.content_translations).toEqual({});
  });

  it("edits each of five languages independently without trimming or replacing original subjects", () => {
    for (const lang of MESSAGE_LANGUAGES) {
      const draft = editMessageLanguage(imported, lang, { body: exact });
      expect(draft.content_translations[lang]?.body).toBe(exact);
      expect(draft.content_translations[lang]?.subject).toBe(lang === "sv" ? "Exakt ämne" : "123");
      for (const other of MESSAGE_LANGUAGES.filter((item) => item !== lang))
        expect(draft.content_translations[other]).toEqual(imported.content_translations[other]);
      expect(draft.body).toBe(lang === "sv" ? exact : imported.body);
      expect(draft.enabled).toBe(false);
    }
  });

  it("keeps manual and edited source templates disabled while allowing normal legacy activation", () => {
    expect(messageDraftPatch(legacy, { enabled: true }).enabled).toBe(true);
    expect(
      messageDraftPatch({ ...legacy, trigger_type: "manual" }, { enabled: true }).enabled,
    ).toBe(false);
    expect(messageDraftPatch({ ...imported, enabled: true }, { offset_days: -2 }).enabled).toBe(
      false,
    );
    expect(messageDraftPatch({ ...imported, enabled: true }, { body: exact }).enabled).toBe(false);
  });

  it("sends exact content and observed revision through the RPC without source fields", async () => {
    const saved = { ...imported, revision: 5 };
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
    expect(
      await saveMessageDraft({ rpc } as unknown as SupabaseClient, "property", imported),
    ).toEqual(saved);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("save_message_template");
    expect(args).toMatchObject({ p_property: "property", p_template: "template", p_revision: 4 });
    expect(args.p_data.content_translations).toEqual(imported.content_translations);
    expect(Object.keys(args.p_data).sort()).toEqual(
      [
        "name",
        "subject",
        "body",
        "content_translations",
        "body_format",
        "trigger_type",
        "offset_days",
        "send_time",
        "channel",
        "enabled",
      ].sort(),
    );
    expect(JSON.stringify(args)).not.toContain("PRIVATE-ARCHIVE");
  });

  it("retains the complete draft on a conflict and rejects unversioned or wrong-property saves before RPC", async () => {
    const before = structuredClone(imported);
    const conflict = { message: "message_template_changed", code: "40001" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: conflict });
    await expect(
      saveMessageDraft({ rpc } as unknown as SupabaseClient, "property", imported),
    ).rejects.toEqual(conflict);
    expect(imported).toEqual(before);
    rpc.mockClear();
    await expect(
      saveMessageDraft({ rpc } as unknown as SupabaseClient, "other", imported),
    ).rejects.toThrow("message_template_changed");
    await expect(
      saveMessageDraft({ rpc } as unknown as SupabaseClient, "property", {
        ...imported,
        revision: undefined as unknown as number,
      }),
    ).rejects.toThrow("message_template_changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([null, { ...legacy, property_id: "other", revision: 5 }, { ...legacy, revision: 4 }])(
    "does not claim an unconfirmed save succeeded",
    async (data) => {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      await expect(
        saveMessageDraft({ rpc } as unknown as SupabaseClient, "property", legacy),
      ).rejects.toThrow("message_save_unconfirmed");
    },
  );

  it("shows all languages, exact source subject/text and source scheduling limitations without an enabled switch", () => {
    const html = editor(imported);
    for (const label of ["Svenska", "Engelska", "Tyska", "Danska", "Norska"])
      expect(html).toContain(label);
    expect(html).toContain("Exakt ämne");
    expect(html).toContain("sv:   Första raden 💚");
    expect(html).toContain("Europe/Stockholm");
    expect(html).toContain("Dolt i källformuläret; styr inte planeringen");
    expect(html).toMatch(/role="switch"[^>]*disabled=""/);
    expect(html).not.toContain("PRIVATE-ARCHIVE");
    expect(html).not.toContain("Skicka nu");
  });

  it("requires supported source mapping and valid ordered review/cutover before enabling", () => {
    const reviewed = {
      ...imported,
      source_reviewed_at: "2026-10-06T12:00:00Z",
      activation_starts_at: "2026-10-07T12:00:00Z",
      source_metadata: { import_mapping_supported: true },
    };
    expect(editor(reviewed)).not.toMatch(/role="switch"[^>]*disabled=""/);
    for (const patch of [
      { source_metadata: { import_mapping_supported: false } },
      { source_metadata: {} },
      { source_reviewed_at: null },
      { source_reviewed_at: "invalid" },
      { activation_starts_at: null },
      { activation_starts_at: "invalid" },
      { activation_starts_at: "2026-10-05T12:00:00Z" },
    ])
      expect(editor({ ...reviewed, ...patch })).toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("hides meaningless times for manual/instant templates and prevents HTML with SMS", () => {
    const manual = editor({ ...legacy, trigger_type: "manual" });
    expect(manual).toContain("ingen automatisk kö eller sändning skapas");
    expect(manual).not.toContain('type="time"');
    expect(editor({ ...legacy, trigger_type: "booking_created" })).not.toContain('type="time"');
    expect(editor(imported)).toContain('<option value="sms" disabled="">');
    expect(editor({ ...legacy, channel: "sms" })).toContain('<option value="html" disabled="">');
  });

  it("previews all five actual language bodies with synthetic data inside a restricted frame", () => {
    for (const lang of MESSAGE_LANGUAGES) {
      const html = renderToStaticMarkup(<MessagePreview template={imported} language={lang} />);
      expect(html).toContain(`${lang}:   Första raden`);
      expect(html).toContain('sandbox=""');
      expect(html).toContain('referrerPolicy="no-referrer"');
      expect(html).toContain("default-src &#x27;none&#x27;");
      expect(html).not.toContain("PRIVATE-ARCHIVE");
      if (lang !== "sv") expect(html).toContain(">123</p>");
    }
  });

  it("never displays raw unsafe HTML and does not silently fall back for a missing imported language", () => {
    const bad = {
      ...imported,
      content_translations: {
        sv: { subject: "X", body: '<img src="https://evil.example/tracker" onerror="alert(1)">' },
      },
    };
    for (const language of ["sv", "da"] as const) {
      const html = renderToStaticMarkup(<MessagePreview template={bad} language={language} />);
      expect(html).toContain("Förhandsvisningen kunde inte skapas");
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain("<iframe");
    }
  });
});
