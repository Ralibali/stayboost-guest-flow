import { BookOpenText, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type KnowledgeItem = {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
};

export function GuestAiSettings({
  propertyId,
  enabled,
  instructions,
  onUpdated,
}: {
  propertyId: string;
  enabled: boolean;
  instructions: string | null;
  onUpdated?: () => void;
}) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [localInstructions, setLocalInstructions] = useState(instructions ?? "");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setLocalEnabled(enabled), [enabled]);
  useEffect(() => setLocalInstructions(instructions ?? ""), [instructions]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: loadError } = await supabase
      .from("guest_ai_knowledge")
      .select("id,question,answer,enabled")
      .eq("property_id", propertyId)
      .order("created_at");
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setItems((data as KnowledgeItem[]) ?? []);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePropertySettings = async () => {
    if (!supabase) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("properties")
      .update({
        guest_ai_enabled: localEnabled,
        guest_ai_instructions: localInstructions.trim() || null,
      })
      .eq("id", propertyId);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onUpdated?.();
  };

  const addKnowledge = async () => {
    if (!supabase || !question.trim() || !answer.trim()) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from("guest_ai_knowledge").insert({
      property_id: propertyId,
      question: question.trim(),
      answer: answer.trim(),
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setQuestion("");
    setAnswer("");
    await load();
  };

  const toggleItem = async (item: KnowledgeItem) => {
    if (!supabase) return;
    const { error: updateError } = await supabase
      .from("guest_ai_knowledge")
      .update({ enabled: !item.enabled })
      .eq("id", item.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setItems((current) =>
      current.map((row) => (row.id === item.id ? { ...row, enabled: !row.enabled } : row)),
    );
  };

  const removeItem = async (id: string) => {
    if (!supabase) return;
    const { error: deleteError } = await supabase.from("guest_ai_knowledge").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setItems((current) => current.filter((row) => row.id !== id));
  };

  return (
    <section className="rounded-[24px] border border-[#2d684c]/15 bg-[#f2f8f4] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#2d684c]">
            <Sparkles size={13} /> Guest AI · testläge
          </div>
          <h2 className="mt-2 font-[Fraunces] text-2xl font-semibold">\n            Svarsförslag för gästfrågor\n          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[color:var(--ink)]/55">
            AI:n skapar bara interna utkast. Inget skickas till gästen utan att personalen granskar,
            kopierar och skickar svaret.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold shadow-sm">
          <input
            type="checkbox"
            checked={localEnabled}
            onChange={(event) => setLocalEnabled(event.target.checked)}
            className="h-4 w-4 accent-[#2d684c]"
          />
          AI-svar aktiverat
        </label>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink)]/45">
            Ton & instruktioner
          </p>
          <textarea
            value={localInstructions}
            onChange={(event) => setLocalInstructions(event.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="Exempel: Svara varmt och personligt. Nämn gärna att parkering finns nära boendet. Lova aldrig tidig incheckning utan be gästen invänta bekräftelse."
            className="mt-3 w-full resize-y rounded-xl border border-black/[0.08] bg-[#fbfcfa] px-3 py-3 text-sm leading-relaxed outline-none focus:border-[#2d684c]/40"
          />
          <button
            type="button"
            onClick={() => void savePropertySettings()}
            disabled={saving}
            className="mt-3 rounded-xl bg-[#173c2b] px-4 py-2.5 text-[11px] font-bold text-white disabled:opacity-50"
          >
            {saving ? "Sparar…" : "Spara AI-inställningar"}
          </button>
        </div>

        <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <div className="flex items-center gap-2">
            <BookOpenText size={16} className="text-[#2d684c]" />
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink)]/45">
              Kunskapsbas
            </p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[color:var(--ink)]/45">
            Lägg bara in fakta ni vill att AI:n ska använda. Bokningsstatus, priser och koder hämtas
            inte automatiskt i testläget.
          </p>

          <div className="mt-4 space-y-2">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Vanlig fråga, t.ex. Finns parkering?"
              className="w-full rounded-xl border border-black/[0.08] px-3 py-2.5 text-sm outline-none focus:border-[#2d684c]/40"
            />
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={3}
              placeholder="Korrekt fakta/svar"
              className="w-full resize-y rounded-xl border border-black/[0.08] px-3 py-2.5 text-sm outline-none focus:border-[#2d684c]/40"
            />
            <button
              type="button"
              onClick={() => void addKnowledge()}
              disabled={saving || !question.trim() || !answer.trim()}
              className="inline-flex items-center gap-2 rounded-xl border border-[#2d684c]/20 bg-[#edf6f1] px-3 py-2 text-[11px] font-bold text-[#2d684c] disabled:opacity-40"
            >
              <Plus size={14} /> Lägg till fakta
            </button>
          </div>

          {items.length ? (
            <div className="mt-4 space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border border-black/[0.06] p-3 ${item.enabled ? "bg-white" : "bg-black/[0.025] opacity-55"}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void toggleItem(item)}
                      className={`mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition ${item.enabled ? "bg-[#2d684c]" : "bg-black/15"}`}
                      aria-label={item.enabled ? "Inaktivera fakta" : "Aktivera fakta"}
                    >
                      <span\n                        className={`block h-3 w-3 rounded-full bg-white transition ${item.enabled ? "translate-x-3" : ""}`}\n                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold">{item.question}</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[color:var(--ink)]/55">
                        {item.answer}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeItem(item.id)}
                      className="shrink-0 p-1 text-[color:var(--ink)]/30 hover:text-red-600"
                      aria-label="Ta bort fakta"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
