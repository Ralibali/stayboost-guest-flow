import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  RATE_RULE_LABELS,
  supabase,
  useProperty,
  useSession,
  type RateRule,
  type RateRuleKind,
} from "@/lib/supabase";

export const Route = createFileRoute("/app/prisregler")({
  component: RateRulesPage,
});

type Draft = {
  name: string;
  kind: RateRuleKind;
  unit_id: string; // "" = alla enheter
  date_from: string;
  date_to: string;
  fixed_price: string;
  pct_delta: string;
  min_stay: string;
  priority: string;
  active: boolean;
  note: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY: Draft = {
  name: "",
  kind: "price_override",
  unit_id: "",
  date_from: today(),
  date_to: today(),
  fixed_price: "",
  pct_delta: "",
  min_stay: "",
  priority: "0",
  active: true,
  note: "",
};

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

const kindHelp: Record<RateRuleKind, string> = {
  price_override: "Anger ett fast nattpris i kronor för perioden.",
  price_multiplier: "Justerar baspriset i procent (+/- värde, t.ex. 25 för +25%).",
  min_stay: "Kräver minst så här många nätter för bokningar som rör perioden.",
  closed: "Ingen försäljning tillåts under perioden.",
  no_arrival: "Ingen incheckning tillåts på dessa datum (utcheckning ok).",
  no_departure: "Ingen utcheckning tillåts på dessa datum (incheckning ok).",
};

function RateRulesPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [rules, setRules] = useState<RateRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("rate_rules")
      .select("*")
      .eq("property_id", property.id)
      .order("priority", { ascending: false })
      .order("date_from");
    if (error) setActionError(error.message);
    setRules((data as RateRule[]) ?? []);
    setLoading(false);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setDraft(EMPTY);
    setEditingId(null);
    setShowForm(false);
    setActionError(null);
  };

  const validate = (): string | null => {
    if (!draft.date_from || !draft.date_to) return "Ange både startdatum och slutdatum.";
    if (draft.date_to < draft.date_from) return "Slutdatum måste vara samma dag eller efter startdatum.";
    if (draft.kind === "price_override") {
      if (!draft.fixed_price || Number(draft.fixed_price) <= 0)
        return "Ange ett fast nattpris större än 0.";
    }
    if (draft.kind === "price_multiplier") {
      const n = Number(draft.pct_delta);
      if (!draft.pct_delta || Number.isNaN(n)) return "Ange en procentjustering (t.ex. 25 eller -10).";
      if (n <= -100) return "Procentjusteringen kan inte vara -100% eller lägre.";
    }
    if (draft.kind === "min_stay") {
      const n = Number(draft.min_stay);
      if (!Number.isFinite(n) || n < 1) return "Ange minsta vistelse (minst 1 natt).";
    }
    return null;
  };

  const save = async () => {
    if (!supabase || !property) return;
    setActionError(null);
    const err = validate();
    if (err) {
      setActionError(err);
      return;
    }
    setSaving(true);
    const row = {
      property_id: property.id,
      unit_id: draft.unit_id || null,
      name: draft.name.trim() || null,
      kind: draft.kind,
      date_from: draft.date_from,
      date_to: draft.date_to,
      fixed_price:
        draft.kind === "price_override" ? Math.round(Number(draft.fixed_price)) : null,
      pct_delta:
        draft.kind === "price_multiplier" ? Number(draft.pct_delta) : null,
      min_stay: draft.kind === "min_stay" ? Math.max(1, Math.round(Number(draft.min_stay))) : null,
      priority: Math.round(Number(draft.priority) || 0),
      active: draft.active,
      note: draft.note.trim() || null,
    };
    const result = editingId
      ? await supabase.from("rate_rules").update(row).eq("id", editingId)
      : await supabase.from("rate_rules").insert(row);
    setSaving(false);
    if (result.error) {
      setActionError(`Kunde inte spara regeln: ${result.error.message}`);
      return;
    }
    reset();
    load();
  };

  const startEdit = (rule: RateRule) => {
    setEditingId(rule.id);
    setDraft({
      name: rule.name ?? "",
      kind: rule.kind,
      unit_id: rule.unit_id ?? "",
      date_from: rule.date_from,
      date_to: rule.date_to,
      fixed_price: rule.fixed_price?.toString() ?? "",
      pct_delta: rule.pct_delta?.toString() ?? "",
      min_stay: rule.min_stay?.toString() ?? "",
      priority: String(rule.priority ?? 0),
      active: rule.active,
      note: rule.note ?? "",
    });
    setShowForm(true);
    setActionError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleActive = async (rule: RateRule) => {
    if (!supabase) return;
    setRules((cur) => cur.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)));
    const { error } = await supabase
      .from("rate_rules")
      .update({ active: !rule.active })
      .eq("id", rule.id);
    if (error) {
      setRules((cur) => cur.map((r) => (r.id === rule.id ? { ...r, active: rule.active } : r)));
      setActionError(`Kunde inte ändra regeln: ${error.message}`);
    }
  };

  const remove = async (rule: RateRule) => {
    if (!supabase) return;
    const { error } = await supabase.from("rate_rules").delete().eq("id", rule.id);
    if (error) {
      setActionError(`Kunde inte ta bort regeln: ${error.message}`);
      return;
    }
    setConfirmDelete(null);
    load();
  };

  const unitName = (id: string | null) =>
    id ? units.find((u) => u.id === id)?.name ?? "Okänd enhet" : "Alla enheter";

  const summary = (r: RateRule) => {
    switch (r.kind) {
      case "price_override":
        return `${(r.fixed_price ?? 0).toLocaleString("sv-SE")} kr/natt`;
      case "price_multiplier":
        return `${r.pct_delta && r.pct_delta > 0 ? "+" : ""}${r.pct_delta ?? 0}%`;
      case "min_stay":
        return `${r.min_stay ?? 0} nätter min.`;
      case "closed":
        return "Stängt";
      case "no_arrival":
        return "Ingen incheckning";
      case "no_departure":
        return "Ingen utcheckning";
    }
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Yield</p>
          <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Prisregler</h1>
          <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
            Höj priset i högsäsong, stäng för försäljning under underhåll eller kräv 3 nätter över helger.
            Regler tillämpas per natt — högre prioritet vinner vid överlapp.
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn-primary !rounded-xl !py-2.5">
            <Plus size={16} /> Ny regel
          </button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {actionError}
        </p>
      )}

      {showForm && (
        <section className="mt-6 rounded-2xl border border-[color:var(--line)] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold">
              {editingId ? "Redigera regel" : "Ny prisregel"}
            </h2>
            <button onClick={reset} aria-label="Stäng" className="text-[color:var(--ink)]/40 hover:text-[color:var(--ink)]">
              <X size={18} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="col-span-full text-[13px] font-medium">
              Namn (valfritt)
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Ex: Högsäsong juli" className="inp mt-1" />
            </label>

            <label className="text-[13px] font-medium">
              Typ av regel
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RateRuleKind })} className="inp mt-1">
                {(Object.keys(RATE_RULE_LABELS) as RateRuleKind[]).map((k) => (
                  <option key={k} value={k}>{RATE_RULE_LABELS[k]}</option>
                ))}
              </select>
            </label>

            <label className="text-[13px] font-medium">
              Boende
              <select value={draft.unit_id} onChange={(e) => setDraft({ ...draft, unit_id: e.target.value })} className="inp mt-1">
                <option value="">Alla enheter</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>

            <label className="text-[13px] font-medium">
              Från
              <input type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} className="inp mt-1" />
            </label>
            <label className="text-[13px] font-medium">
              Till (inkl.)
              <input type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} className="inp mt-1" />
            </label>

            {draft.kind === "price_override" && (
              <label className="text-[13px] font-medium">
                Fast nattpris (kr)
                <input inputMode="numeric" value={draft.fixed_price}
                  onChange={(e) => setDraft({ ...draft, fixed_price: e.target.value.replace(/[^\d]/g, "") })}
                  className="inp mt-1" />
              </label>
            )}
            {draft.kind === "price_multiplier" && (
              <label className="text-[13px] font-medium">
                Procentjustering
                <input inputMode="numeric" value={draft.pct_delta}
                  onChange={(e) => setDraft({ ...draft, pct_delta: e.target.value.replace(/[^\d-]/g, "") })}
                  placeholder="25 eller -10" className="inp mt-1" />
              </label>
            )}
            {draft.kind === "min_stay" && (
              <label className="text-[13px] font-medium">
                Minsta vistelse (nätter)
                <input inputMode="numeric" value={draft.min_stay}
                  onChange={(e) => setDraft({ ...draft, min_stay: e.target.value.replace(/[^\d]/g, "") })}
                  className="inp mt-1" />
              </label>
            )}

            <label className="text-[13px] font-medium">
              Prioritet
              <input inputMode="numeric" value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value.replace(/[^\d-]/g, "") })}
                className="inp mt-1" />
              <span className="mt-1 block text-[11.5px] text-[color:var(--ink)]/50">
                Högre siffra vinner vid överlapp. Standard: 0.
              </span>
            </label>

            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Aktiv
            </label>

            <label className="col-span-full text-[13px] font-medium">
              Intern notering (valfritt)
              <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                rows={2} className="inp mt-1 resize-none" />
            </label>

            <p className="col-span-full rounded-lg bg-[color:var(--bg)] px-3 py-2 text-[12.5px] text-[color:var(--ink)]/70">
              {kindHelp[draft.kind]}
            </p>

            <div className="col-span-full flex gap-2 pt-1">
              <button onClick={save} disabled={saving} className="btn-primary flex-1 justify-center !rounded-xl !py-2.5 disabled:opacity-40">
                {saving ? "Sparar…" : editingId ? "Spara ändringar" : "Skapa regel"}
              </button>
              <button onClick={reset} className="rounded-xl px-4 text-[14px] font-medium text-[color:var(--ink)]/60 ring-1 ring-[color:var(--line)]">
                Avbryt
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="mt-6 divide-y divide-[color:var(--line)] overflow-hidden rounded-2xl border border-[color:var(--line)] bg-white">
        {loading && (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-[color:var(--ink)]/50">
            <Loader2 size={14} className="animate-spin" /> Laddar regler…
          </div>
        )}
        {!loading && rules.length === 0 && (
          <div className="px-4 py-12 text-center text-[15px] font-medium text-[color:var(--ink)]/50">
            Inga prisregler ännu.
          </div>
        )}
        {rules.map((r) => (
          <article key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-4 sm:flex-nowrap ${r.active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--forest)]">
                  {RATE_RULE_LABELS[r.kind]}
                </span>
                <span className="text-[14px] font-semibold">
                  {r.name || `Prio ${r.priority}`}
                </span>
                {r.priority !== 0 && !r.name && (
                  <span className="text-[11.5px] text-[color:var(--ink)]/40">prio {r.priority}</span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-[color:var(--ink)]/70">
                {fmtDate(r.date_from)}–{fmtDate(r.date_to)} · {unitName(r.unit_id)} · <span className="font-medium text-[color:var(--brass)]">{summary(r)}</span>
              </p>
              {r.note && <p className="mt-0.5 text-[12px] text-[color:var(--ink)]/50">{r.note}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => toggleActive(r)} role="switch" aria-checked={r.active}
                title={r.active ? "Aktiv" : "Pausad"}
                className={`relative h-6 w-11 rounded-full transition ${r.active ? "bg-[color:var(--forest)]" : "bg-[color:var(--ink)]/20"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${r.active ? "left-[22px]" : "left-0.5"}`} />
              </button>
              <button onClick={() => startEdit(r)} title="Redigera"
                className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink)]/50 hover:bg-[color:var(--bg)]">
                <Pencil size={15} />
              </button>
              {confirmDelete === r.id ? (
                <button onClick={() => remove(r)} className="rounded-full bg-red-600 px-3 py-1.5 text-[12px] font-bold text-white">
                  Bekräfta
                </button>
              ) : (
                <button onClick={() => {
                  setConfirmDelete(r.id);
                  setTimeout(() => setConfirmDelete((cur) => cur === r.id ? null : cur), 3000);
                }} title="Ta bort"
                  className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink)]/50 hover:bg-red-50 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
