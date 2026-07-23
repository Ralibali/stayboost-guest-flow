import { createFileRoute } from "@tanstack/react-router";
import { CalendarRange, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RATE_RULE_LABELS,
  supabase,
  useProperty,
  useSession,
  type RateRule,
  type RateRuleKind,
} from "@/lib/supabase";

export const Route = createFileRoute("/app/priser")({ component: RateRulesPage });

type Draft = {
  id?: string;
  unit_id: string;
  name: string;
  kind: RateRuleKind;
  date_from: string;
  date_to: string;
  value: string;
  priority: string;
  active: boolean;
  note: string;
};

const emptyDraft = (): Draft => ({
  unit_id: "all",
  name: "",
  kind: "price_override",
  date_from: new Date().toISOString().slice(0, 10),
  date_to: new Date().toISOString().slice(0, 10),
  value: "",
  priority: "0",
  active: true,
  note: "",
});

function valueLabel(kind: RateRuleKind) {
  if (kind === "price_override") return "Nattpris (kr)";
  if (kind === "price_multiplier") return "Justering (%)";
  if (kind === "min_stay") return "Minsta antal nätter";
  return null;
}

function RateRulesPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [rules, setRules] = useState<RateRule[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    const { data, error } = await supabase
      .from("rate_rules")
      .select("*")
      .eq("property_id", property.id)
      .order("priority", { ascending: false })
      .order("date_from", { ascending: true });
    if (error) setError(error.message);
    else setRules((data as RateRule[]) ?? []);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const active = rules.filter((r) => r.active);
    const inactive = rules.filter((r) => !r.active);
    return { active, inactive };
  }, [rules]);

  const reset = () => {
    setDraft(emptyDraft());
    setEditing(false);
    setError(null);
  };

  const edit = (rule: RateRule) => {
    const value =
      rule.kind === "price_override"
        ? rule.fixed_price
        : rule.kind === "price_multiplier"
          ? rule.pct_delta
          : rule.kind === "min_stay"
            ? rule.min_stay
            : "";
    setDraft({
      id: rule.id,
      unit_id: rule.unit_id ?? "all",
      name: rule.name ?? "",
      kind: rule.kind,
      date_from: rule.date_from,
      date_to: rule.date_to,
      value: String(value ?? ""),
      priority: String(rule.priority ?? 0),
      active: rule.active,
      note: rule.note ?? "",
    });
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!supabase || !property) return;
    setError(null);
    if (!draft.name.trim()) return setError("Ange ett namn på regeln.");
    if (!draft.date_from || !draft.date_to || draft.date_to < draft.date_from) {
      return setError("Kontrollera datumintervallet.");
    }
    const numericValue = draft.value === "" ? null : Number(draft.value);
    if (valueLabel(draft.kind) && (!Number.isFinite(numericValue) || numericValue === null)) {
      return setError("Ange ett giltigt värde.");
    }

    const payload = {
      property_id: property.id,
      unit_id: draft.unit_id === "all" ? null : draft.unit_id,
      name: draft.name.trim(),
      kind: draft.kind,
      date_from: draft.date_from,
      date_to: draft.date_to,
      fixed_price: draft.kind === "price_override" ? numericValue : null,
      pct_delta: draft.kind === "price_multiplier" ? numericValue : null,
      min_stay: draft.kind === "min_stay" ? numericValue : null,
      priority: Number(draft.priority) || 0,
      active: draft.active,
      note: draft.note.trim() || null,
    };

    setSaving(true);
    const result = draft.id
      ? await supabase.from("rate_rules").update(payload).eq("id", draft.id)
      : await supabase.from("rate_rules").insert(payload);
    setSaving(false);
    if (result.error) setError(result.error.message);
    else {
      reset();
      load();
    }
  };

  const toggle = async (rule: RateRule) => {
    if (!supabase) return;
    const { error } = await supabase.from("rate_rules").update({ active: !rule.active }).eq("id", rule.id);
    if (error) setError(error.message);
    else load();
  };

  const remove = async (rule: RateRule) => {
    if (!supabase || !window.confirm(`Ta bort regeln ”${rule.name ?? RATE_RULE_LABELS[rule.kind]}”?`)) return;
    const { error } = await supabase.from("rate_rules").delete().eq("id", rule.id);
    if (error) setError(error.message);
    else load();
  };

  if (!property) return null;

  const renderRule = (rule: RateRule) => {
    const unitName = rule.unit_id ? units.find((u) => u.id === rule.unit_id)?.name ?? "Okänt boende" : "Alla boenden";
    const value =
      rule.kind === "price_override"
        ? `${rule.fixed_price} kr/natt`
        : rule.kind === "price_multiplier"
          ? `${rule.pct_delta! > 0 ? "+" : ""}${rule.pct_delta}%`
          : rule.kind === "min_stay"
            ? `${rule.min_stay} nätter`
            : "Spärr";
    return (
      <article key={rule.id} className={`card-surface p-4 ${rule.active ? "" : "opacity-60"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{rule.name || RATE_RULE_LABELS[rule.kind]}</h3>
              <span className="rounded-full bg-[color:var(--forest)]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--forest)]">
                {RATE_RULE_LABELS[rule.kind]}
              </span>
              <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-semibold">Prioritet {rule.priority}</span>
            </div>
            <p className="mt-1 text-[13px] text-[color:var(--ink)]/65">
              {unitName} · {rule.date_from}–{rule.date_to} · <strong>{value}</strong>
            </p>
            {rule.note && <p className="mt-1 text-[12px] text-[color:var(--ink)]/55">{rule.note}</p>}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => toggle(rule)} className="btn-ghost !rounded-xl !px-3 !py-2 text-[12px]" aria-label={rule.active ? "Inaktivera regel" : "Aktivera regel"}>
              <Power size={14} /> {rule.active ? "Aktiv" : "Inaktiv"}
            </button>
            <button onClick={() => edit(rule)} className="btn-ghost !rounded-xl !px-3 !py-2 text-[12px]" aria-label="Redigera regel">
              <Pencil size={14} /> Redigera
            </button>
            <button onClick={() => remove(rule)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-red-50 hover:text-red-600" aria-label="Ta bort regel">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-4xl">
      <p className="eyebrow">Prissättning</p>
      <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Pris- och tillgänglighetsregler</h1>
      <p className="mt-1 text-[14px] text-[color:var(--ink)]/65">Styr priser, minsta vistelse och datumspärrar. Högre prioritet vinner vid överlapp.</p>

      <section className="card-surface mt-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold"><CalendarRange size={18} /> {editing ? "Redigera regel" : "Ny regel"}</h2>
          {editing && <button onClick={reset} className="btn-ghost !rounded-xl !px-3 !py-2 text-[12px]"><X size={14} /> Avbryt</button>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-semibold">Namn<input className="inp mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Exempel: Högsäsong juli" /></label>
          <label className="text-[12px] font-semibold">Boende<select className="inp mt-1" value={draft.unit_id} onChange={(e) => setDraft({ ...draft, unit_id: e.target.value })}><option value="all">Alla boenden</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="text-[12px] font-semibold">Regeltyp<select className="inp mt-1" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RateRuleKind, value: "" })}>{Object.entries(RATE_RULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {valueLabel(draft.kind) ? <label className="text-[12px] font-semibold">{valueLabel(draft.kind)}<input className="inp mt-1" type="number" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></label> : <div />}
          <label className="text-[12px] font-semibold">Från<input className="inp mt-1" type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} /></label>
          <label className="text-[12px] font-semibold">Till<input className="inp mt-1" type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} /></label>
          <label className="text-[12px] font-semibold">Prioritet<input className="inp mt-1" type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} /></label>
          <label className="flex items-center gap-2 self-end pb-3 text-[13px] font-semibold"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Aktiv direkt</label>
          <label className="text-[12px] font-semibold sm:col-span-2">Intern anteckning<textarea className="inp mt-1 min-h-20" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
        </div>
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
        <button onClick={save} disabled={saving} className="btn-primary mt-4 !rounded-xl !px-5 !py-3 text-[13px] disabled:opacity-50"><Plus size={15} /> {saving ? "Sparar…" : draft.id ? "Spara ändringar" : "Lägg till regel"}</button>
      </section>

      <section className="mt-6">
        <h2 className="font-[Fraunces] text-2xl font-semibold">Aktiva regler ({grouped.active.length})</h2>
        <div className="mt-3 space-y-3">{grouped.active.length ? grouped.active.map(renderRule) : <p className="card-surface p-5 text-[14px] text-[color:var(--ink)]/55">Inga aktiva regler.</p>}</div>
      </section>
      {grouped.inactive.length > 0 && <section className="mt-6"><h2 className="font-[Fraunces] text-xl font-semibold">Inaktiva regler ({grouped.inactive.length})</h2><div className="mt-3 space-y-3">{grouped.inactive.map(renderRule)}</div></section>}
    </div>
  );
}
