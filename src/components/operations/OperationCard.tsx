import { useRef, useState } from "react";
import { changeOperation, operationLabel, type StayOperation } from "@/lib/stayOperations";
const input = "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm";
const button =
  "rounded-xl border border-black/15 px-3 py-2 text-sm font-semibold disabled:opacity-40";
export function OperationCard({
  task,
  onChange,
}: {
  task: StayOperation;
  onChange: (task: StayOperation) => void;
}) {
  const [assigned, setAssigned] = useState(task.assigned_to),
    [due, setDue] = useState(task.due_date),
    [note, setNote] = useState(""),
    [base, setBase] = useState(task.revision),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const stale = base !== task.revision,
    cancelled = task.booking?.status !== "confirmed";
  const act = async (action: string, payload: Record<string, unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await changeOperation(task.id, base, action, payload);
      onChange({
        ...task,
        ...result,
        context_changed: action === "reset" ? false : task.context_changed,
      });
      setBase(result.revision);
      setAssigned(result.assigned_to);
      setDue(result.due_date);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunde inte spara");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <article
      className="rounded-2xl border border-black/10 bg-white p-5 space-y-4"
      data-private="true"
    >
      <header>
        <div className="flex flex-wrap justify-between gap-2">
          <h2 className="font-semibold">
            {task.kind === "cleaning" ? "Städning" : task.title}
            {task.kind === "addon" && typeof task.details.quantity === "number"
              ? ` · ${task.details.quantity} st`
              : ""}
          </h2>
          <span className="text-sm text-[#2d684c]">{operationLabel(task)}</span>
        </div>
        <p className="text-sm mt-1">
          {task.booking?.unit_name || "Boende saknas"} ·{" "}
          {task.booking?.guest_name || "Gästnamn saknas"}
        </p>
        <p className="text-xs text-black/55 mt-1">
          Vistelse {task.booking?.checkin_date}–{task.booking?.checkout_date} · Planerat{" "}
          {task.due_date}
        </p>
        {task.assigned_to && <p className="text-xs mt-1">Ansvarig: {task.assigned_to}</p>}
      </header>
      {task.details.name_source === "current_catalog" && (
        <p className="text-xs text-black/55">
          Äldre köp: benämningen kommer från aktuell katalog. Antal och styckepris kommer från
          bokningen.
        </p>
      )}
      {cancelled && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">
          Bokningen är avbokad. Arbetslogg och tidigare status finns kvar.
        </p>
      )}
      {task.context_changed && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
          Bokningens datum eller boende har ändrats. Anpassa uppgiften och kontrollera arbetet på
          nytt.
        </p>
      )}
      {!cancelled && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Planera och uppdatera uppgiften
          </summary>
          <fieldset disabled={busy} className="space-y-3 mt-4">
            {stale && (
              <div role="alert" className="text-sm">
                Uppgiften har ändrats. Läs senaste uppgifterna och historiken.
                <button
                  className={`${button} mt-2 block`}
                  onClick={() => {
                    setBase(task.revision);
                    setAssigned(task.assigned_to);
                    setDue(task.due_date);
                  }}
                >
                  Jag har granskat ändringen
                </button>
              </div>
            )}
            {task.status !== "done" && !task.context_changed && (
              <>
                <label className="block text-sm">
                  Ansvarig, valfritt
                  <input
                    className={input}
                    maxLength={200}
                    value={assigned}
                    onChange={(e) => setAssigned(e.target.value)}
                  />
                </label>
                {task.kind === "addon" && (
                  <label className="block text-sm">
                    Planerat leveransdatum
                    <input
                      type="date"
                      className={input}
                      value={due}
                      min={task.booking?.checkin_date}
                      max={task.booking?.checkout_date}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </label>
                )}
                <button
                  className={button}
                  disabled={stale}
                  onClick={() => void act("assign", { assigned_to: assigned, due_date: due })}
                >
                  Spara ansvarig och datum
                </button>
              </>
            )}
            <label className="block text-sm">
              Arbetsanteckning
              <textarea
                className={input}
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Beskriv utfört arbete eller varför uppgiften öppnas igen"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {task.context_changed || task.status === "done" ? (
                <button
                  className={button}
                  disabled={stale || !note.trim()}
                  onClick={() => void act("reset", { note })}
                >
                  {task.context_changed ? "Anpassa till aktuell bokning" : "Öppna uppgiften igen"}
                </button>
              ) : (
                <button
                  className={`${button} bg-[#173c2b] text-white`}
                  disabled={stale || !note.trim()}
                  onClick={() =>
                    void act("status", {
                      status: task.status === "pending" ? "in_progress" : "done",
                      note,
                    })
                  }
                >
                  {task.status === "pending"
                    ? "Påbörja"
                    : task.kind === "cleaning"
                      ? "Markera städning klar"
                      : "Markera levererat"}
                </button>
              )}
            </div>
          </fieldset>
        </details>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {task.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">Arbetslogg ({task.history.length})</summary>
          <ol className="mt-3 space-y-3">
            {[...task.history].reverse().map((event, index) => (
              <li key={`${event.at}-${index}`} className="border-l-2 pl-3 text-sm">
                <p className="font-medium">{event.label}</p>
                {event.note && <p className="whitespace-pre-wrap">{event.note}</p>}
                <p className="text-xs text-black/55">
                  {new Date(event.at).toLocaleString("sv-SE")}
                  {event.assigned_to ? ` · ${event.assigned_to}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
