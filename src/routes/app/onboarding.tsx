import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { supabase, useProperty, useSession } from "@/lib/supabase";

export const Route = createFileRoute("/app/onboarding")({
  component: OnboardingPage,
});

type UnitDraft = {
  name: string;
  door_code: string;
  max_guests: number;
  description: string;
};

const emptyUnit = (): UnitDraft => ({ name: "", door_code: "", max_guests: 2, description: "" });

function OnboardingPage() {
  const session = useSession();
  const { reload } = useProperty(session);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    checkin_time: "15:00",
    checkout_time: "11:00",
    wifi_name: "",
    wifi_password: "",
    directions: "",
    house_rules: "",
    contact_phone: "",
    review_url: "",
  });
  const [units, setUnits] = useState<UnitDraft[]>([emptyUnit()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid = form.name.trim().length > 1 && units.some((u) => u.name.trim().length > 0);

  const submit = async () => {
    if (!supabase || !session || !valid) return;
    setBusy(true);
    setError(null);
    const { data: prop, error: propertyError } = await supabase
      .from("properties")
      .insert({
        owner_id: session.user.id,
        name: form.name.trim(),
        checkin_time: form.checkin_time,
        checkout_time: form.checkout_time,
        wifi_name: form.wifi_name || null,
        wifi_password: form.wifi_password || null,
        directions: form.directions || null,
        house_rules: form.house_rules || null,
        contact_phone: form.contact_phone || null,
        review_url: form.review_url || null,
      })
      .select("id")
      .single();

    if (propertyError || !prop) {
      setError(propertyError?.message ?? "Kunde inte skapa anläggningen");
      setBusy(false);
      return;
    }

    const rows = units
      .filter((u) => u.name.trim())
      .map((u, i) => ({
        property_id: prop.id,
        name: u.name.trim(),
        door_code: u.door_code.trim() || null,
        max_guests: Math.min(20, Math.max(1, u.max_guests)),
        description: u.description.trim() || null,
        sort_order: i,
      }));
    const { error: unitError } = await supabase.from("units").insert(rows);
    if (unitError) {
      await supabase.from("properties").delete().eq("id", prop.id);
      setError(unitError.message);
      setBusy(false);
      return;
    }

    reload();
    navigate({ to: "/app" });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">Välkommen till StayBoost</p>
      <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Berätta om din anläggning</h1>
      <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
        Börja med grunderna. Bilder, priser, bäddar och faciliteter kan kompletteras direkt efteråt.
      </p>

      <section className="card-surface mt-8 space-y-5 p-6">
        <Field label="Anläggningens namn *">
          <input
            value={form.name}
            onChange={set("name")}
            placeholder="Bergs Slussar Glamping"
            className="inp"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Incheckning från">
            <input
              type="time"
              value={form.checkin_time}
              onChange={set("checkin_time")}
              className="inp"
            />
          </Field>
          <Field label="Utcheckning senast">
            <input
              type="time"
              value={form.checkout_time}
              onChange={set("checkout_time")}
              className="inp"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nätverksnamn (wifi)">
            <input value={form.wifi_name} onChange={set("wifi_name")} className="inp" />
          </Field>
          <Field label="Lösenord (wifi)">
            <input value={form.wifi_password} onChange={set("wifi_password")} className="inp" />
          </Field>
        </div>
        <Field label="Vägbeskrivning">
          <textarea
            value={form.directions}
            onChange={set("directions")}
            rows={2}
            className="inp resize-none"
          />
        </Field>
        <Field label="Husregler">
          <textarea
            value={form.house_rules}
            onChange={set("house_rules")}
            rows={2}
            className="inp resize-none"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Kontakttelefon">
            <input value={form.contact_phone} onChange={set("contact_phone")} className="inp" />
          </Field>
          <Field label="Recensionslänk">
            <input value={form.review_url} onChange={set("review_url")} className="inp" />
          </Field>
        </div>
      </section>

      <section className="card-surface mt-5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-bold">Boenden</h2>
            <p className="text-[13px] text-[color:var(--ink)]/55">
              Ange rätt maxantal gäster för varje tält, rum eller stuga.
            </p>
          </div>
          <button
            onClick={() => setUnits((current) => [...current, emptyUnit()])}
            className="btn-ghost !rounded-xl !px-3 !py-2 text-[13px]"
          >
            <Plus size={15} /> Lägg till
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {units.map((unit, index) => (
            <div key={index} className="rounded-2xl border border-[color:var(--line)] p-4">
              <div className="flex items-start gap-2.5">
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_130px]">
                  <Field label={`Boende ${index + 1} *`}>
                    <input
                      value={unit.name}
                      onChange={(e) =>
                        setUnits((current) =>
                          current.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)),
                        )
                      }
                      placeholder="Sjöbrisretreatet"
                      className="inp"
                    />
                  </Field>
                  <Field label="Max gäster *">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={unit.max_guests}
                      onChange={(e) =>
                        setUnits((current) =>
                          current.map((x, i) =>
                            i === index
                              ? {
                                  ...x,
                                  max_guests: Math.min(
                                    20,
                                    Math.max(1, Number(e.target.value) || 1),
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      className="inp"
                    />
                  </Field>
                </div>
                {units.length > 1 && (
                  <button
                    onClick={() => setUnits((current) => current.filter((_, i) => i !== index))}
                    className="mt-5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--ink)]/40 hover:bg-red-50 hover:text-red-600"
                    aria-label="Ta bort boende"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Kort beskrivning">
                  <input
                    value={unit.description}
                    onChange={(e) =>
                      setUnits((current) =>
                        current.map((x, i) =>
                          i === index ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Glampingtält med utsikt över kanalen"
                    className="inp"
                  />
                </Field>
                <Field label="Portkod">
                  <input
                    value={unit.door_code}
                    onChange={(e) =>
                      setUnits((current) =>
                        current.map((x, i) =>
                          i === index ? { ...x, door_code: e.target.value } : x,
                        ),
                      )
                    }
                    className="inp"
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</p>
      )}
      <button
        onClick={submit}
        disabled={!valid || busy}
        className="btn-primary mt-6 w-full justify-center !rounded-xl !py-3.5 text-[15px] disabled:opacity-40"
      >
        {busy ? "Sparar…" : "Skapa anläggning →"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
        {label}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
