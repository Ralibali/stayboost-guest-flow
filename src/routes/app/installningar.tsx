import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Eye, EyeOff, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  icalExportUrl,
  supabase,
  useProperty,
  useSession,
  type Property,
  type Unit,
} from "@/lib/supabase";

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadingUnit, setUploadingUnit] = useState<string | null>(null);
  const imageInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (property) setForm(property);
  }, [property]);

  if (!property || !form) return null;

  const set =
    (k: keyof Property) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const save = async () => {
    if (!supabase) return;
    setActionError(null);
    const { id, owner_id, ...patch } = form;
    const { error } = await supabase.from("properties").update(patch).eq("id", id);
    if (error) {
      setActionError(`Kunde inte spara anläggningen: ${error.message}`);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  };

  const addUnit = async () => {
    if (!supabase || !newUnit.trim()) return;
    setActionError(null);
    const { error } = await supabase.from("units").insert({
      property_id: property.id,
      name: newUnit.trim(),
      sort_order: units.length,
      max_guests: 2,
    });
    if (error) {
      setActionError(`Kunde inte lägga till boendet: ${error.message}`);
      return;
    }
    setNewUnit("");
    reload();
  };

  const updateUnit = async (id: string, patch: Partial<Unit>) => {
    if (!supabase) return false;
    setActionError(null);
    const { error } = await supabase.from("units").update(patch).eq("id", id);
    if (error) {
      setActionError(`Kunde inte spara boendet: ${error.message}`);
      return false;
    }
    reload();
    return true;
  };

  const removeUnit = async (id: string, name: string) => {
    if (!supabase) return;
    if (
      !window.confirm(
        `Ta bort ${name}? Enhetens iCal-källor raderas. Befintliga bokningar behålls men tappar kopplingen till boendet.`,
      )
    )
      return;
    setActionError(null);
    const { error } = await supabase.from("units").delete().eq("id", id);
    if (error) {
      setActionError(`Kunde inte ta bort boendet: ${error.message}`);
      return;
    }
    reload();
  };

  const uploadUnitImage = async (unit: Unit, file: File) => {
    if (!supabase) return;
    setActionError(null);
    if (!file.type.startsWith("image/")) {
      setActionError("Välj en bildfil.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setActionError("Bilden får vara högst 6 MB.");
      return;
    }

    setUploadingUnit(unit.id);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${property.id}/${unit.id}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("unit-images")
      .upload(path, file, { cacheControl: "31536000", upsert: false });

    if (uploadError) {
      setUploadingUnit(null);
      setActionError(`Kunde inte ladda upp bilden: ${uploadError.message}`);
      return;
    }

    const { data } = supabase.storage.from("unit-images").getPublicUrl(path);
    const ok = await updateUnit(unit.id, { image_url: data.publicUrl });
    setUploadingUnit(null);
    if (!ok) await supabase.storage.from("unit-images").remove([path]);
  };

  const copyFeed = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedFeed(id);
    setTimeout(() => setCopiedFeed(null), 1500);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Inställningar</h1>
        <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
          All information här används i bokningsmotorn, gästsidan och automatiska utskick.
        </p>
      </div>

      {actionError && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {actionError}
        </div>
      )}

      <section className="card-surface mt-6 space-y-4 p-6">
        <h2 className="text-[16px] font-bold">Anläggning</h2>
        <Field label="Namn">
          <input value={form.name} onChange={set("name")} className="inp" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Incheckning från">
            <input type="time" value={form.checkin_time} onChange={set("checkin_time")} className="inp" />
          </Field>
          <Field label="Utcheckning senast">
            <input type="time" value={form.checkout_time} onChange={set("checkout_time")} className="inp" />
          </Field>
        </div>
        <Field label="Adress till bokningssidan">
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nätverksnamn (wifi)">
            <input value={form.wifi_name ?? ""} onChange={set("wifi_name")} className="inp" />
          </Field>
          <Field label="Lösenord (wifi)">
            <input value={form.wifi_password ?? ""} onChange={set("wifi_password")} className="inp" />
          </Field>
        </div>
        <Field label="Vägbeskrivning">
          <textarea value={form.directions ?? ""} onChange={set("directions")} rows={3} className="inp resize-none" />
        </Field>
        <Field label="Husregler">
          <textarea value={form.house_rules ?? ""} onChange={set("house_rules")} rows={3} className="inp resize-none" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kontakttelefon">
            <input value={form.contact_phone ?? ""} onChange={set("contact_phone")} className="inp" />
          </Field>
          <Field label="Recensionslänk">
            <input value={form.review_url ?? ""} onChange={set("review_url")} className="inp" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Swish-nummer">
            <input value={form.swish_number ?? ""} onChange={set("swish_number")} placeholder="123 456 7890" className="inp" />
          </Field>
          <Field label="Reservera obetald Swish-bokning (minuter)">
            <input
              type="number"
              min={15}
              max={1440}
              value={form.swish_hold_minutes}
              onChange={(e) =>
                setForm((f) =>
                  f
                    ? {
                        ...f,
                        swish_hold_minutes: Math.min(1440, Math.max(15, Number(e.target.value) || 60)),
                      }
                    : f,
                )
              }
              className="inp"
            />
          </Field>
        </div>
        <button onClick={save} className="btn-primary !rounded-xl !px-5 !py-2.5 text-[14px]">
          {saved ? "✓ Sparat" : "Spara anläggningen"}
        </button>
      </section>

      <section className="card-surface mt-5 p-6">
        <h2 className="text-[16px] font-bold">Din bokningssida</h2>
        <p className="mt-1 text-[13px] text-[color:var(--ink)]/55">
          Gäster bokar direkt här utan kanalprovision. Dela länken eller bädda in formuläret på hemsidan.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={`${typeof window !== "undefined" ? window.location.origin : ""}/boka/${form.slug}`}
            className="inp flex-1 !bg-[color:var(--bg)]"
            onFocus={(e) => e.target.select()}
          />
          <a href={`/boka/${form.slug}`} target="_blank" rel="noreferrer" className="btn-ghost shrink-0 !rounded-xl !px-4 !py-2.5 text-[13px]">
            Öppna →
          </a>
        </div>
        <textarea
          readOnly
          rows={3}
          onFocus={(e) => e.target.select()}
          value={`<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/boka/${form.slug}" style="width:100%;max-width:680px;height:1100px;border:0;" title="Boka ${form.name}"></iframe>`}
          className="inp mt-3 resize-none !bg-[color:var(--bg)] font-mono text-[11px]"
        />
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Boenden</p>
            <h2 className="mt-2 font-[Fraunces] text-2xl font-semibold">Tält, stugor och rum</h2>
            <p className="mt-1 text-[13px] text-[color:var(--ink)]/55">
              Maxgäster styr exakt hur många som går att boka i respektive boende.
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="Nytt boende" className="inp flex-1 sm:w-64" />
            <button onClick={addUnit} disabled={!newUnit.trim()} className="btn-primary !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-40">
              <Plus size={15} /> Lägg till
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {units.map((u) => (
            <article key={u.id} className={`card-surface overflow-hidden ${u.active ? "" : "opacity-70"}`}>
              <div className="grid gap-0 md:grid-cols-[220px_1fr]">
                <div className="relative min-h-48 bg-[color:var(--bg)]">
                  {u.image_url ? (
                    <img src={u.image_url} alt={u.name} className="h-full min-h-48 w-full object-cover" />
                  ) : (
                    <div className="grid h-full min-h-48 place-items-center text-[color:var(--ink)]/30">
                      <ImagePlus size={30} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => imageInputs.current[u.id]?.click()}
                    disabled={uploadingUnit === u.id}
                    className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-[12px] font-semibold shadow-sm disabled:opacity-60"
                  >
                    {uploadingUnit === u.id ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    {uploadingUnit === u.id ? "Laddar upp" : "Byt bild"}
                  </button>
                  <input
                    ref={(node) => {
                      imageInputs.current[u.id] = node;
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadUnitImage(u, file);
                      e.target.value = "";
                    }}
                  />
                </div>

                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <Field label="Namn">
                        <input
                          defaultValue={u.name}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== u.name && updateUnit(u.id, { name: e.target.value.trim() })}
                          className="inp text-[16px] font-semibold"
                        />
                      </Field>
                    </div>
                    <button
                      onClick={() => updateUnit(u.id, { active: !u.active })}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold ${u.active ? "bg-emerald-100 text-emerald-800" : "bg-[color:var(--bg)] text-[color:var(--ink)]/55"}`}
                      title={u.active ? "Visas i bokningsmotorn" : "Dolt från bokningsmotorn"}
                    >
                      {u.active ? <Eye size={14} /> : <EyeOff size={14} />}
                      {u.active ? "Aktivt" : "Dolt"}
                    </button>
                    <button onClick={() => removeUnit(u.id, u.name)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--ink)]/40 hover:bg-red-50 hover:text-red-600" aria-label={`Ta bort ${u.name}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="Kort beskrivning">
                      <textarea
                        defaultValue={u.description ?? ""}
                        rows={3}
                        onBlur={(e) => e.target.value !== (u.description ?? "") && updateUnit(u.id, { description: e.target.value.trim() || null })}
                        placeholder="Vad gör just detta boende unikt?"
                        className="inp resize-none"
                      />
                    </Field>
                    <Field label="Egen incheckningsinstruktion">
                      <textarea
                        defaultValue={u.checkin_instructions ?? ""}
                        rows={3}
                        onBlur={(e) => e.target.value !== (u.checkin_instructions ?? "") && updateUnit(u.id, { checkin_instructions: e.target.value.trim() || null })}
                        placeholder="Exempel: Tältet ligger längst till vänster."
                        className="inp resize-none"
                      />
                    </Field>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <NumberField label="Max gäster" value={u.max_guests} min={1} max={20} onSave={(n) => updateUnit(u.id, { max_guests: n })} />
                    <NumberField label="Storlek m²" value={u.size_sqm ?? 0} min={0} max={999} decimals onSave={(n) => updateUnit(u.id, { size_sqm: n > 0 ? n : null })} />
                    <NumberField label="Pris/natt" value={u.base_price} min={0} max={100000} onSave={(n) => updateUnit(u.id, { base_price: n })} />
                    <NumberField label="Städavgift" value={u.cleaning_fee} min={0} max={100000} onSave={(n) => updateUnit(u.id, { cleaning_fee: n })} />
                    <NumberField label="Helgpåslag %" value={u.weekend_pct} min={0} max={500} onSave={(n) => updateUnit(u.id, { weekend_pct: n })} />
                    <NumberField label="Min nätter" value={u.min_stay} min={1} max={30} onSave={(n) => updateUnit(u.id, { min_stay: n })} />
                    <Field label="Portkod">
                      <input defaultValue={u.door_code ?? ""} onBlur={(e) => e.target.value !== (u.door_code ?? "") && updateUnit(u.id, { door_code: e.target.value.trim() || null })} className="inp" />
                    </Field>
                    <Field label="Sirvoy rums-id/namn">
                      <input defaultValue={u.external_ref ?? ""} onBlur={(e) => e.target.value !== (u.external_ref ?? "") && updateUnit(u.id, { external_ref: e.target.value.trim() || null })} className="inp" />
                    </Field>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Bäddar">
                      <input
                        defaultValue={u.bed_description ?? ""}
                        onBlur={(e) => e.target.value !== (u.bed_description ?? "") && updateUnit(u.id, { bed_description: e.target.value.trim() || null })}
                        placeholder="Dubbelsäng 180 cm + extrasäng"
                        className="inp"
                      />
                    </Field>
                    <Field label="Faciliteter, separera med kommatecken">
                      <input
                        defaultValue={(u.amenities ?? []).join(", ")}
                        onBlur={(e) => {
                          const amenities = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                          if (amenities.join("|") !== (u.amenities ?? []).join("|")) updateUnit(u.id, { amenities });
                        }}
                        placeholder="El, kylskåp, handdukar, grill"
                        className="inp"
                      />
                    </Field>
                  </div>

                  <Field label="Bildlänk (kan användas i stället för uppladdning)">
                    <input
                      defaultValue={u.image_url ?? ""}
                      onBlur={(e) => e.target.value !== (u.image_url ?? "") && updateUnit(u.id, { image_url: e.target.value.trim() || null })}
                      placeholder="https://…"
                      className="inp"
                    />
                  </Field>

                  <button onClick={() => copyFeed(u.id, icalExportUrl(u))} className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--brass)] hover:underline">
                    {copiedFeed === u.id ? <Check size={13} /> : <Copy size={13} />}
                    {copiedFeed === u.id ? "Exportlänk kopierad" : "Kopiera iCal-exportlänk till Airbnb/Booking"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card-surface mt-8 p-6">
        <h2 className="text-[16px] font-bold">Sirvoy-koppling</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--ink)]/55">
          Klistra in denna URL som Sirvoy Booking event webhook. Matcha sedan varje boende med dess Sirvoy-rums-id ovan.
        </p>
        <input
          readOnly
          onFocus={(e) => e.target.select()}
          value={`${(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "https://<projekt>.supabase.co"}/functions/v1/sirvoy-webhook?token=${property.sirvoy_webhook_token}`}
          className="inp mt-3 !bg-[color:var(--bg)] font-mono text-[11px]"
        />
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  decimals = false,
  onSave,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  decimals?: boolean;
  onSave: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={decimals ? 0.1 : 1}
        defaultValue={value}
        onBlur={(e) => {
          const parsed = decimals ? Number(e.target.value) : Math.round(Number(e.target.value));
          const next = Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
          if (next !== value) onSave(next);
        }}
        className="inp"
      />
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
