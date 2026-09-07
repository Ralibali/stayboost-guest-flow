import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProperty, useSession } from "@/lib/supabase";
import { localDay, operationsBoard, shiftDay, type StayOperation } from "@/lib/stayOperations";
import { OperationCard } from "@/components/operations/OperationCard";
export const Route = createFileRoute("/app/arbete")({ component: OperationsPage });
function OperationsPage() {
  const session = useSession(),
    { property } = useProperty(session);
  const [from, setFrom] = useState(() => localDay()),
    [to, setTo] = useState(() => shiftDay(localDay(), 14)),
    [rows, setRows] = useState<StayOperation[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all");
  const generation = useRef(0);
  const propertyId = property?.id;
  const load = useCallback(async () => {
    if (!propertyId) return;
    const ticket = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await operationsBoard(propertyId, from, to);
      if (ticket === generation.current) setRows(data);
    } catch (err) {
      if (ticket === generation.current)
        setError(err instanceof Error ? err.message : "Listan kunde inte hämtas");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [propertyId, from, to]);
  useEffect(() => {
    const currentGeneration = generation;
    setRows([]);
    void load();
    return () => {
      currentGeneration.current++;
    };
  }, [load]);
  if (!property) return null;
  const filtered = rows.filter(
    (row) =>
      filter === "all" ||
      filter === row.kind ||
      (filter === "open" &&
        (row.status !== "done" || row.context_changed) &&
        row.booking?.status === "confirmed"),
  );
  return (
    <div className="space-y-6" data-private="true">
      <header>
        <p className="text-xs uppercase tracking-wider text-[#2d684c]">Drift</p>
        <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Städning & leveranser</h1>
        <p className="mt-2 text-sm text-black/60">
          Planera ansvariga och följ arbetet per bokning. Utförda uppgifter har en arbetslogg.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Från
          <input
            type="date"
            className="block rounded-lg border bg-white px-3 py-2"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Till
          <input
            type="date"
            className="block rounded-lg border bg-white px-3 py-2"
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Visa
          <select
            className="block rounded-lg border bg-white px-3 py-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Alla uppgifter</option>
            <option value="open">Kvar att göra</option>
            <option value="cleaning">Städning</option>
            <option value="addon">Tillvalsleveranser</option>
          </select>
        </label>
        <button
          className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Hämtar…" : "Uppdatera"}
        </button>
      </div>
      <p className="text-xs text-black/55">
        Städuppgifter följer bokningens utcheckning. Tillval bygger på registrerade köp. Inga
        meddelanden skickas från arbetslistan.
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && !filtered.length && (
        <p className="rounded-xl border bg-white p-5 text-sm">
          Inga uppgifter för perioden och filtret.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {filtered.map((task) => (
          <OperationCard
            key={task.id}
            task={task}
            onChange={(updated) =>
              setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)))
            }
          />
        ))}
      </div>
    </div>
  );
}
