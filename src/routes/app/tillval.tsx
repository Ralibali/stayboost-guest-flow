import { createFileRoute } from "@tanstack/react-router";
import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  supabase,
  useProperty,
  useSession,
  type Addon,
  type AddonPriceType,
} from "@/lib/supabase";

export const Route = createFileRoute("/app/tillval")({ component: AddonsPage });

type ServiceTiming = "arrival" | "each_stay_day" | "each_morning";
type ManagedAddon = Addon & { service_timing: ServiceTiming };

type Draft = {
  name: string;
  description: string;
  price: string;
  price_type: AddonPriceType;
  image_url: string;
  capacity_per_day: string;
  fulfillment_note: string;
  service_timing: ServiceTiming;
};

const EMPTY: Draft = {
  name: "",
  description: "",
  price: "",
  price_type: "per_booking",
  image_url: "",
  capacity_per_day: "",
  fulfillment_note: "",
  service_timing: "arrival",
};

const PRICE_TYPES: { value: AddonPriceType; label: string }[] = [
  { value: "per_booking", label: "Per bokning" },
  { value: "per_night", label: "Per natt" },
  { value: "per_person", label: "Per person" },
  { value: "per_person_per_night", label: "Per person & dygn" },
];

const SERVICE_TIMINGS: { value: ServiceTiming; label: string }[] = [
  { value: "arrival", label: "Ankomstdagen" },
  { value: "each_stay_day", label: "Varje vistelsedag (t.ex. cykel)" },
  { value: "each_morning", label: "Varje morgon efter övernattning (t.ex. frukost)" },
];

const fmtKr = (n: number) => `${n.toLocaleString("sv-SE")} kr`;
const priceLabel = (addon: ManagedAddon) => {
  const suffix =
    addon.price_type === "per_night"
      ? "/natt"
      : addon.price_type === "per_person"
        ? "/person"
        : addon.price_type === "per_person_per_night"
          ? "/person & dygn"
          : "";
  return `${fmtKr(addon.price)}${suffix}`;
};

function AddonsPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [addons, setAddons] = useState<ManagedAddon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    const { data, error } = await supabase
      .from("addons")
      .select("*")
      .eq("property_id", property.id)
      .order("sort_order")
      .order("created_at");
    if (error) setActionError(error.message);
    setAddons((data as ManagedAddon[]) ?? []);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadImage = async (file: File) => {
    if (!supabase || !property) return;
    setActionError(null);
    if (!file.type.startsWith("image/")) return setActionError("Välj en bildfil.");
    if (file.size > 6 * 1024 * 1024) return setActionError("Bilden får vara högst 6 MB.");

    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${property.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("addon-images")
      .upload(path, file, { cacheControl: "31536000", upsert: false });
    if (error) setActionError(`Kunde inte ladda upp bilden: ${error.message}`);
    else {
      const { data } = supabase.storage.from("addon-images").getPublicUrl(path);
      setDraft((current) => ({ ...current, image_url: data.publicUrl }));
    }
    setUploading(false);
  };

  const reset = () => {
    setDraft(EMPTY);
    setEditingId(null);
    setShowForm(false);
    setActionError(null);
  };

  const save = async () => {
    if (!supabase || !property || !draft.name.trim()) return;
    setSaving(true);
    setActionError(null);
    const capacity = draft.capacity_per_day.trim()
      ? Math.max(1, Math.round(Number(draft.capacity_per_day)))
      : null;
    const row = {
      property_id: property.id,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      price: Math.max(0, Math.round(Number(draft.price) || 0)),
      price_type: draft.price_type,
      image_url: draft.image_url.trim() || null,
      capacity_per_day: capacity,
      fulfillment_note: draft.fulfillment_note.trim() || null,
      service_timing: draft.service_timing,
    };
    const result = editingId
      ? await supabase.from("addons").update(row).eq("id", editingId)
      : await supabase.from("addons").insert({ ...row, sort_order: addons.length });
    setSaving(false);
    if (result.error) return setActionError(`Kunde inte spara tillvalet: ${result.error.message}`);
    reset();
    load();
  };

  const startEdit = (addon: ManagedAddon) => {
    setEditingId(addon.id);
    setDraft({
      name: addon.name,
      description: addon.description ?? "",
      price: String(addon.price),
      price_type: addon.price_type,
      image_url: addon.image_url ?? "",
      capacity_per_day: addon.capacity_per_day ? String(addon.capacity_per_day) : "",
      fulfillment_note: addon.fulfillment_note ?? "",
      service_timing: addon.service_timing ?? "arrival",
    });
    setShowForm(true);
    setActionError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleActive = async (addon: ManagedAddon) => {
    if (!supabase) return;
    const next = !addon.active;
    setAddons((items) => items.map((item) => (item.id === addon.id ? { ...item, active: next } : item)));
    const { error } = await supabase.from("addons").update({ active: next }).eq("id", addon.id);
    if (error) {
      setAddons((items) => items.map((item) => (item.id === addon.id ? { ...item, active: addon.active } : item)));
      setActionError(error.message);
    }
  };

  const remove = async (addon: ManagedAddon) => {
    if (!supabase) return;
    const { error } = await supabase.from("addons").delete().eq("id", addon.id);
    if (error) return setActionError(`Kunde inte ta bort tillvalet: ${error.message}`);
    setConfirmDelete(null);
    load();
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Merförsäljning</p>
          <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Tillval & upplevelser</h1>
          <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
            Frukost, cykelpaket, sen utcheckning och andra uppgraderingar. Kapacitet per dag stoppar överbokning automatiskt.
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn-primary !rounded-xl !py-2.5">
            <Plus size={16} /> Nytt tillval
          </button>
        )}
      </div>

      {actionError && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{actionError}</p>}

      {showForm && (
        <section className="mt-6 rounded-2xl border border-[color:var(--line)] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold">{editingId ? "Redigera tillval" : "Nytt tillval"}</h2>
            <button onClick={reset} className="text-[color:var(--ink)]/40 hover:text-[color:var(--ink)]" aria-label="Stäng"><X size={18} /></button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Namn, t.ex. Canal Picnic Ride" className="inp sm:col-span-2" />
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Kort säljande beskrivning" rows={3} className="inp resize-none sm:col-span-2" />
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">Pris</label>
              <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d]/g, "") })} placeholder="895" inputMode="numeric" className="inp" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">Prismodell</label>
              <select value={draft.price_type} onChange={(e) => setDraft({ ...draft, price_type: e.target.value as AddonPriceType })} className="inp">
                {PRICE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">Max per dag</label>
              <input value={draft.capacity_per_day} onChange={(e) => setDraft({ ...draft, capacity_per_day: e.target.value.replace(/[^\d]/g, "") })} placeholder="Tomt = obegränsat, t.ex. 6 cyklar" inputMode="numeric" className="inp" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">När ska det förberedas?</label>
              <select value={draft.service_timing} onChange={(e) => setDraft({ ...draft, service_timing: e.target.value as ServiceTiming })} className="inp">
                {SERVICE_TIMINGS.map((timing) => <option key={timing.value} value={timing.value}>{timing.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">Driftinstruktion</label>
              <input value={draft.fulfillment_note} onChange={(e) => setDraft({ ...draft, fulfillment_note: e.target.value })} placeholder="T.ex. Matsäck i Guest Pantry kl 08.30" className="inp" />
            </div>
          </div>

          <div className="mt-4">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
            {draft.image_url ? (
              <div className="relative overflow-hidden rounded-xl border border-[color:var(--line)]">
                <img src={draft.image_url} alt="" className="h-44 w-full object-cover" />
                <button onClick={() => setDraft({ ...draft, image_url: "" })} className="absolute right-2 top-2 rounded-full bg-black/65 p-2 text-white" aria-label="Ta bort bild"><X size={14} /></button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--line)] py-7 text-[13px] font-semibold text-[color:var(--ink)]/55">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} Lägg till bild
              </button>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={reset} className="btn-ghost !rounded-xl">Avbryt</button>
            <button onClick={save} disabled={saving || !draft.name.trim()} className="btn-primary !rounded-xl disabled:opacity-50">
              {saving && <Loader2 size={15} className="animate-spin" />} Spara
            </button>
          </div>
        </section>
      )}

      <div className="mt-6 space-y-3">
        {addons.length === 0 ? (
          <div className="card-surface px-6 py-12 text-center text-[13px] text-[color:var(--ink)]/45">Inga tillval ännu.</div>
        ) : addons.map((addon) => (
          <article key={addon.id} className={`card-surface overflow-hidden ${addon.active ? "" : "opacity-60"}`}>
            <div className="flex gap-4 p-4 sm:p-5">
              {addon.image_url && <img src={addon.image_url} alt="" className="h-24 w-28 shrink-0 rounded-xl object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-[15px] font-bold">{addon.name}</h2>
                    <p className="mt-1 text-[13px] font-semibold text-[color:var(--brass)]">{priceLabel(addon)}</p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold">
                    Aktiv
                    <input type="checkbox" checked={addon.active} onChange={() => toggleActive(addon)} />
                  </label>
                </div>
                {addon.description && <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--ink)]/55">{addon.description}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[color:var(--ink)]/55">
                  {addon.capacity_per_day && <span className="rounded-full bg-[color:var(--bg)] px-2.5 py-1">Max {addon.capacity_per_day}/dag</span>}
                  <span className="rounded-full bg-[color:var(--bg)] px-2.5 py-1">{SERVICE_TIMINGS.find((x) => x.value === addon.service_timing)?.label ?? "Ankomstdagen"}</span>
                  {addon.fulfillment_note && <span className="rounded-full bg-[color:var(--bg)] px-2.5 py-1">{addon.fulfillment_note}</span>}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[color:var(--line)] px-4 py-3">
              <button onClick={() => startEdit(addon)} className="btn-ghost !rounded-xl !px-3 !py-2 text-[12px]"><Pencil size={14} /> Redigera</button>
              {confirmDelete === addon.id ? (
                <><button onClick={() => setConfirmDelete(null)} className="btn-ghost !rounded-xl !px-3 !py-2 text-[12px]">Avbryt</button><button onClick={() => remove(addon)} className="rounded-xl bg-red-600 px-3 py-2 text-[12px] font-semibold text-white">Ta bort</button></>
              ) : (
                <button onClick={() => setConfirmDelete(addon.id)} className="btn-ghost !rounded-xl !px-3 !py-2 text-[12px] text-red-600"><Trash2 size={14} /> Ta bort</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
