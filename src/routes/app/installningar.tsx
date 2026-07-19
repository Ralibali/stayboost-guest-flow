import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { icalExportUrl, supabase, useProperty, useSession, type Property } from "@/lib/supabase";

export const Route = createFileRoute("/app/installningar")({
  component: SettingsPage,
});

function SettingsPage() {
  const session = useSession();
  const { property, units, reload } = useProperty(session);
  const [form, setForm] = useState<Property | null>(null);
  const [saved, setSaved] = useState(false);
  const [newUnit, setNewUnit] = useState("");
  const [copiedFeed, setCopiedFeed] = useState<string | null>(null);

  const copyFeed = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedFeed(id);
    setTimeout(() => setCopiedFeed(null), 1500);
  };

  useEffect(() => {
    if (property && !form) setForm(property);
  }, [property, form]);

  if (!property || !form) return null;

  const set =
    (k: keyof Property) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const save = async () => {
    if (!supabase) return;
    const { id, owner_id, ...patch } = form;
    await supabase.from("properties").update(patch).eq("id", id);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  };

  const addUnit = async () => {
    if (!supabase || !newUnit.trim()) return;
    await supabase
      .from("units")
      .insert({ property_id: property.id, name: newUnit.trim(), sort_order: units.length });
    setNewUnit("");
    reload();
  };

  const updateUnit = async (
    id: string,
    patch: Partial<{
      name: string;
      door_code: string | null;
      base_price: number;
      weekend_pct: number;
      min_stay: number;
      cleaning_fee: number;
    }>,
  ) => {
    if (!supabase) return;
    await supabase.from("units").update(patch).eq("id", id);
    reload();
  };

  const removeUnit = async (id: string, name: string) => {
    if (!supabase) return;
    if (
      !window.confirm(
        `Ta bort ${name}? Enhetens iCal-källor raderas, bokningar behålls men tappar enhetskopian.`,
      )
    )
      return;
    await supabase.from("units").delete().eq("id", id);
    reload();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-[Fraunces] text-2xl font-semibold">Inställningar</h1>

      <div className="card-surface mt-6 space-y-4 p-6">
        <h2 className="text-[15px] font-bold">Anläggning</h2>
        <Field label="Namn">
          <input value={form.name} onChange={set("name")} className="inp" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Incheckning från">
            <input value={form.checkin_time} onChange={set("checkin_time")} className="inp" />
          </Field>
          <Field label="Utcheckning senast">
            <input value={form.checkout_time} onChange={set("checkout_time")} className="inp" />
          </Field>
        </div>
        <Field label="Adress till din bokningssida (slug)">
          <input
            value={form.slug ?? ""}
            onChange={(e) =>
              setForm((f) =>
                f ? { ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") } : f,
              )
            }
            className="inp"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Wifi-namn">
            <input value={form.wifi_name ?? ""} onChange={set("wifi_name")} className="inp" />
          </Field>
          <Field label="Wifi-lösenord">
            <input
              value={form.wifi_password ?? ""}
              onChange={set("wifi_password")}
              className="inp"
            />
          </Field>
        </div>
        <Field label="Vägbeskrivning">
          <textarea
            value={form.directions ?? ""}
            onChange={set("directions")}
            rows={3}
            className="inp resize-none"
          />
        </Field>
        <Field label="Husregler">
          <textarea
            value={form.house_rules ?? ""}
            onChange={set("house_rules")}
            rows={3}
            className="inp resize-none"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Kontakttelefon">
            <input
              value={form.contact_phone ?? ""}
              onChange={set("contact_phone")}
              className="inp"
            />
          </Field>
          <Field label="Recensionslänk">
            <input value={form.review_url ?? ""} onChange={set("review_url")} className="inp" />
          </Field>
        </div>
        <button onClick={save} className="btn-primary !rounded-xl !px-5 !py-2.5 text-[14px]">
          {saved ? "✓ Sparat" : "Spara ändringar"}
        </button>
      </div>

      {/* Direktbokning */}
      <div className="card-surface mt-5 p-6">
        <h2 className="text-[15px] font-bold">Din bokningssida</h2>
        <p className="mt-1 text-[13px] text-[color:var(--ink)]/55">
          Gäster bokar direkt här — utan kanalprovision. Dela länken eller bädda in den på er
          hemsida.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            readOnly
            value={`${typeof window !== "undefined" ? window.location.origin : ""}/boka/${form.slug}`}
            className="inp flex-1 !bg-[color:var(--bg)]"
            onFocus={(e) => e.target.select()}
          />
          <a
            href={`/boka/${form.slug}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost shrink-0 !rounded-xl !px-4 !py-2.5 text-[13px]"
          >
            Öppna →
          </a>
        </div>
        <div className="mt-3">
          <label className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
            Bädda in på er hemsida (iframe)
          </label>
          <textarea
            readOnly
            rows={2}
            onFocus={(e) => e.target.select()}
            value={`<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/boka/${form.slug}" style="width:100%;max-width:520px;height:900px;border:0;border-radius:16px;" title="Boka ${form.name}"></iframe>`}
            className="inp mt-1.5 resize-none !bg-[color:var(--bg)] font-mono text-[11px]"
          />
        </div>
      </div>

      <div className="card-surface mt-5 p-6">
        <h2 className="text-[15px] font-bold">Enheter</h2>
        <div className="mt-3 space-y-2.5">
          {units.map((u) => (
            <div key={u.id}>
              <div className="flex items-center gap-2.5">
                <input
                  defaultValue={u.name}
                  onBlur={(e) =>
                    e.target.value !== u.name && updateUnit(u.id, { name: e.target.value })
                  }
                  className="inp flex-1"
                />
                <input
                  defaultValue={u.door_code ?? ""}
                  placeholder="Portkod"
                  onBlur={(e) =>
                    e.target.value !== (u.door_code ?? "") &&
                    updateUnit(u.id, { door_code: e.target.value || null })
                  }
                  className="inp w-28"
                />
                <button
                  onClick={() => removeUnit(u.id, u.name)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--ink)]/40 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Ta bort ${u.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {(
                  [
                    ["base_price", "Pris/natt", u.base_price],
                    ["weekend_pct", "Helg +%", u.weekend_pct],
                    ["min_stay", "Min nätter", u.min_stay],
                    ["cleaning_fee", "Städavgift", u.cleaning_fee],
                  ] as const
                ).map(([key, label, val]) => (
                  <label key={key} className="block">
                    <span className="text-[11px] font-medium text-[color:var(--ink)]/50">
                      {label}
                    </span>
                    <input
                      type="number"
                      min={0}
                      defaultValue={val}
                      onBlur={(e) => {
                        const n = Math.max(0, Math.round(Number(e.target.value)));
                        if (n !== val) updateUnit(u.id, { [key]: n });
                      }}
                      className="inp mt-0.5 !px-2.5 !py-1.5 text-[13px]"
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={() => copyFeed(u.id, icalExportUrl(u))}
                className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--brass)] hover:underline"
              >
                {copiedFeed === u.id ? <Check size={13} /> : <Copy size={13} />}
                {copiedFeed === u.id
                  ? "Exportlänk kopierad — klistra in i Airbnb/Booking"
                  : "Kopiera iCal-exportlänk (till Airbnb/Booking)"}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2.5">
          <input
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            placeholder="Ny enhet — t.ex. Vindraget"
            className="inp flex-1"
          />
          <button
            onClick={addUnit}
            disabled={!newUnit.trim()}
            className="btn-ghost !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-40"
          >
            <Plus size={15} /> Lägg till
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
