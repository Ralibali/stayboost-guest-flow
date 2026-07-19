import { createFileRoute } from "@tanstack/react-router";
import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, useProperty, useSession, type Addon } from "@/lib/supabase";

export const Route = createFileRoute("/app/tillval")({
  component: AddonsPage,
});

type Draft = {
  name: string;
  description: string;
  price: string;
  price_type: "per_booking" | "per_night";
  image_url: string;
};

const EMPTY: Draft = {
  name: "",
  description: "",
  price: "",
  price_type: "per_booking",
  image_url: "",
};

const fmtKr = (n: number) => `${n.toLocaleString("sv-SE")} kr`;

function AddonsPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    const { data } = await supabase
      .from("addons")
      .select("*")
      .eq("property_id", property.id)
      .order("sort_order")
      .order("created_at");
    setAddons((data as Addon[]) ?? []);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadImage = async (file: File) => {
    if (!supabase || !property) return;
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${property.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("addon-images").upload(path, file);
    if (!error) {
      const { data } = supabase.storage.from("addon-images").getPublicUrl(path);
      setDraft((d) => ({ ...d, image_url: data.publicUrl }));
    }
    setUploading(false);
  };

  const reset = () => {
    setDraft(EMPTY);
    setEditingId(null);
    setShowForm(false);
  };

  const save = async () => {
    if (!supabase || !property || !draft.name.trim()) return;
    setSaving(true);
    const row = {
      property_id: property.id,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      price: Math.max(0, Math.round(Number(draft.price) || 0)),
      price_type: draft.price_type,
      image_url: draft.image_url.trim() || null,
    };
    if (editingId) {
      await supabase.from("addons").update(row).eq("id", editingId);
    } else {
      await supabase.from("addons").insert({ ...row, sort_order: addons.length });
    }
    setSaving(false);
    reset();
    load();
  };

  const startEdit = (a: Addon) => {
    setEditingId(a.id);
    setDraft({
      name: a.name,
      description: a.description ?? "",
      price: String(a.price),
      price_type: a.price_type,
      image_url: a.image_url ?? "",
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleActive = async (a: Addon) => {
    if (!supabase) return;
    setAddons((as) => as.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)));
    await supabase.from("addons").update({ active: !a.active }).eq("id", a.id);
  };

  const remove = async (id: string) => {
    if (!supabase) return;
    await supabase.from("addons").delete().eq("id", id);
    setConfirmDelete(null);
    load();
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-[Fraunces] text-3xl font-semibold">Tillval</h1>
          <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
            Det gästen kan lägga till i bokningen — badtunna, vedkorg, frukost…
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn-primary !rounded-xl !py-2.5">
            <Plus size={16} /> Nytt tillval
          </button>
        )}
      </div>

      {/* ---------- Formulär (nytt / redigera) ---------- */}
      {showForm && (
        <div className="mt-6 rounded-2xl border border-[color:var(--line)] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold">
              {editingId ? "Redigera tillval" : "Nytt tillval"}
            </h2>
            <button
              onClick={reset}
              className="text-[color:var(--ink)]/40 hover:text-[color:var(--ink)]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Namn — t.ex. Badtunna under stjärnorna"
              className="inp"
            />
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Kort beskrivning (valfritt) — vad ingår, när serveras det…"
              rows={2}
              className="inp resize-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={draft.price}
                onChange={(e) =>
                  setDraft({ ...draft, price: e.target.value.replace(/[^\d]/g, "") })
                }
                placeholder="Pris i kr"
                inputMode="numeric"
                className="inp"
              />
              <select
                value={draft.price_type}
                onChange={(e) =>
                  setDraft({ ...draft, price_type: e.target.value as Draft["price_type"] })
                }
                className="inp"
              >
                <option value="per_booking">Per bokning</option>
                <option value="per_night">Per natt</option>
              </select>
            </div>

            {/* Bild: ladda upp ELLER klistra in länk */}
            <div className="flex items-center gap-3">
              {draft.image_url ? (
                <img
                  src={draft.image_url}
                  alt=""
                  className="h-16 w-16 rounded-xl object-cover ring-1 ring-[color:var(--line)]"
                />
              ) : (
                <div className="grid h-16 w-16 place-items-center rounded-xl bg-[color:var(--bg)] text-[color:var(--ink)]/30">
                  <ImagePlus size={20} />
                </div>
              )}
              <div className="flex-1 space-y-1.5">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold ring-1 ring-[color:var(--line)] transition hover:ring-[color:var(--forest)] disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ImagePlus size={14} />
                  )}
                  {uploading ? "Laddar upp…" : "Ladda upp bild"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadImage(f);
                    e.target.value = "";
                  }}
                />
                <input
                  value={draft.image_url}
                  onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
                  placeholder="…eller klistra in bildlänk"
                  className="inp !py-1.5 !text-[12px]"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={saving || !draft.name.trim()}
                className="btn-primary flex-1 justify-center !rounded-xl !py-2.5 disabled:opacity-40"
              >
                {saving ? "Sparar…" : editingId ? "Spara ändringar" : "Lägg till"}
              </button>
              <button
                onClick={reset}
                className="rounded-xl px-4 text-[14px] font-medium text-[color:var(--ink)]/60 ring-1 ring-[color:var(--line)] hover:text-[color:var(--ink)]"
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Lista — minimalistiska rader ---------- */}
      <div className="mt-6 divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
        {addons.map((a) => (
          <div
            key={a.id}
            className={`flex items-center gap-4 bg-white px-4 py-4 ${a.active ? "" : "opacity-50"}`}
          >
            {a.image_url ? (
              <img
                src={a.image_url}
                alt=""
                className="h-14 w-14 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[color:var(--bg)] text-[color:var(--ink)]/25">
                <ImagePlus size={18} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{a.name}</p>
              {a.description && (
                <p className="mt-0.5 line-clamp-1 text-[13px] text-[color:var(--ink)]/55">
                  {a.description}
                </p>
              )}
              <p className="mt-0.5 text-[13px] font-medium text-[color:var(--brass)]">
                {fmtKr(a.price)}
                {a.price_type === "per_night" && "/natt"}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => toggleActive(a)}
                title={a.active ? "Aktiv — visas i bokningsmotorn" : "Dold — visas ej"}
                className={`relative h-6 w-11 rounded-full transition ${a.active ? "bg-[color:var(--forest)]" : "bg-[color:var(--ink)]/20"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${a.active ? "left-[22px]" : "left-0.5"}`}
                />
              </button>
              <button
                onClick={() => startEdit(a)}
                className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink)]/50 hover:bg-[color:var(--bg)] hover:text-[color:var(--ink)]"
                title="Redigera"
              >
                <Pencil size={15} />
              </button>
              {confirmDelete === a.id ? (
                <button
                  onClick={() => remove(a.id)}
                  className="rounded-full bg-red-600 px-3 py-1.5 text-[12px] font-bold text-white"
                >
                  Ta bort?
                </button>
              ) : (
                <button
                  onClick={() => {
                    setConfirmDelete(a.id);
                    setTimeout(() => setConfirmDelete((c) => (c === a.id ? null : c)), 3000);
                  }}
                  className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink)]/50 hover:bg-red-50 hover:text-red-600"
                  title="Ta bort"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}

        {addons.length === 0 && (
          <div className="bg-white px-4 py-12 text-center">
            <p className="text-[15px] font-medium text-[color:var(--ink)]/50">
              Inga tillval ännu — skapa ditt första ovan.
            </p>
            <p className="mt-1 text-[13px] text-[color:var(--ink)]/40">
              Tips: badtunna, vedkorg, frukostkorg och sen utcheckning säljer bra på glamping.
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-[12px] text-[color:var(--ink)]/40">
        Aktiva tillval visas automatiskt på din bokningssida och läggs på priset — även vid Swish
        och Stripe.
      </p>
    </div>
  );
}
