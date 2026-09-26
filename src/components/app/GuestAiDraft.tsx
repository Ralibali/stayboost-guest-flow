import { Check, Copy, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function GuestAiDraft({
  messageId,
  existingDraft,
  createdAt,
  enabled,
}: {
  messageId: string;
  existingDraft: string | null;
  createdAt: string | null;
  enabled: boolean;
}) {
  const [draft, setDraft] = useState(existingDraft ?? "");
  const [draftCreatedAt, setDraftCreatedAt] = useState(createdAt);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(existingDraft ?? ""), [existingDraft]);
  useEffect(() => setDraftCreatedAt(createdAt), [createdAt]);

  const generate = async () => {
    if (!supabase || !enabled) return;
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("guest-ai-draft", {
      body: { messageId },
    });
    setLoading(false);

    if (invokeError) {
      setError("Kunde inte skapa svarsförslag. Kontrollera AI-konfigurationen och försök igen.");
      return;
    }
    if (!data?.draft) {
      setError("AI:n returnerade inget användbart utkast.");
      return;
    }
    setDraft(String(data.draft));
    setDraftCreatedAt(data.createdAt ?? new Date().toISOString());
  };

  const copy = async () => {
    if (!draft.trim()) return;
    await navigator.clipboard.writeText(draft.trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mt-5 rounded-2xl border border-[#2d684c]/15 bg-[#f4f8f5] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#2d684c]">
            <Sparkles size={12} /> AI-svarsförslag
          </div>
          <p className="mt-1 text-[11px] text-[color:var(--ink)]/45">
            Internt utkast · granskas av personal innan svar skickas
            {draftCreatedAt
              ? ` · ${new Date(draftCreatedAt).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!enabled || loading}
          className="inline-flex items-center gap-2 rounded-xl border border-[#2d684c]/20 bg-white px-3 py-2 text-[11px] font-bold text-[#2d684c] disabled:cursor-not-allowed disabled:opacity-40"
          title={!enabled ? "Aktivera Guest AI ovan först" : undefined}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {draft ? "Nytt förslag" : "Skapa svarsförslag"}
        </button>
      </div>

      {draft ? (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={5}
            className="mt-3 w-full resize-y rounded-xl border border-black/[0.07] bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-[#2d684c]/35"
            aria-label="AI-svarsförslag"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#173c2b] px-3.5 py-2 text-[11px] font-bold text-white"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Kopierat" : "Kopiera svar"}
          </button>
        </>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-[color:var(--ink)]/45">
          {enabled
            ? "Skapa ett utkast baserat på anläggningens uppgifter och kunskapsbas."
            : "Aktivera Guest AI i testläget ovan för att skapa svarsförslag."}
        </p>
      )}

      {error ? <p className="mt-3 text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
