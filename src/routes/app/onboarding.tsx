import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trackProductEvent } from "@/lib/product-analytics";
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
  const trackedStart = useRef(false);
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

  useEffect(() => {
    if (trackedStart.current) return;
    trackedStart.current = true;
    trackProductEvent("Onboarding Started");
    if (typeof window !== "undefined" && !window.sessionStorage.getItem("stayboost_activation_started_at")) {
      window.sessionStorage.setItem("stayboost_activation_started_at", String(Date.now()));
    }
  }, []);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid = form.name.trim().length > 1 && units.some((unit) => unit.name.trim().length > 0);

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
        wifi_name: form.wifi_name.trim() || null,
        wifi_password: form.wifi_password.trim() || null,
        directions: form.directions.trim() || null,
        house_rules: form.house_rules.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        review_url: form.review_url.trim() || null,
      })
      .select("id")
      .single();

    if (propertyError || !prop) {
      setError(propertyError?.message ?? "Kunde inte skapa anläggningen");
      trackProductEvent("Onboarding Failed", { stage: "property" });
      setBusy(false);
      return;
    }

    const rows = units
      .filter((unit) => unit.name.trim())
      .map((unit, index) => ({
        property_id: prop.id,
        name: unit.name.trim(),
        door_code: unit.door_code.trim() || null,
        max_guests: Math.min(20, Math.max(1, unit.max_guests)),
        description: unit.description.trim() || null,
        sort_order: index,
      }));
    const { error: unitError } = await supabase.from("units").insert(rows);

    if (unitError) {
      await supabase.from("properties").delete().eq("id", prop.id);
      setError(unitError.message);
      trackProductEvent("Onboarding Failed", { stage: "unit" });
      setBusy(false);
      return;
    }

    const startedAt =
      typeof window !== "undefined"
        ? Number(window.sessionStorage.getItem("stayboost_activation_started_at"))
        : NaN;
    const secondsFromSignup = Number.isFinite(startedAt)
      ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      : null;
    const optionalDetailsAdded = Boolean(
      form.wifi_name.trim() ||
        form.wifi_password.trim() ||
        form.directions.trim() ||
        form.house_rules.trim() ||
        form.contact_phone.trim() ||
        form.review_url.trim() ||
        rows.some((row) => row.door_code || row.description),
    );

    trackProductEvent("Property Setup Completed", {
      unit_count: rows.length,
      optional_details: optionalDetailsAdded,
      seconds_from_signup: secondsFromSignup,
    });
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("stayboost_property_setup_complete", "1");
    }

    reload();
    if (typeof window !== "undefined") {
      // Full reload avoids a race between the optimistic route change and the owner-property refetch.
      window.location.assign("/app/kallor");
    } else {
      navigate({ to: "/app" });
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#2d684c]">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#173c2b] text-white">1</span>
        Steg 1 av 2 · Grunden
      </div>
      <h1 className="mt-3 font-[Fraunces] text-3xl font-semibold">Skapa din anläggning på en minut</h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[color:var(--ink)]/60">
        Vi behöver bara namn och ditt första boende för att börja. Därefter kopplar du Sirvoy,
        Booking.com eller en annan kalender så StayBoost får riktiga bokningar att arbeta med.
      </p>

      <section className="card-surface mt-7 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[color:var(--ink)]/35">
              Måste fyllas i
            </p>
            <h2 className="mt-1 font-[Fraunces] text-[20px] font-semibold">Anläggning & boende</h2>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700">
            ≈ 60 sek
          </span>
        </div>

        <div className="mt-5 space-y-4">
          <Field label="Anläggningens namn *">
            <input
              value={form.name}
              onChange={set("name")}
              placeholder="Bergs Slussar Glamping"
              autoFocus
              className="inp"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
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

          <div className="space-y-3">
            {units.map((unit, index) => (
              <div key={index} className="rounded-2xl border border-[color:var(--line)] bg-[#fafbf8] p-4">
                <div className="flex items-start gap-2.5">
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_130px]">
                    <Field label={index === 0 ? "Första boendet *" : `Boende ${index + 1}`}>
                      <input
                        value={unit.name}
                        onChange={(e) =>
                          setUnits((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, name: e.target.value } : item,
                            ),
                          )
                        }
                        placeholder={index === 0 ? "Sjöbrisretreatet" : "Tält, rum eller stuga"}
                        className="inp"
                      />
                    </Field>
                    <Field label="Max gäster">
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={unit.max_guests}
                        onChange={(e) =>
                          setUnits((current) =>
                            current.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    max_guests: Math.min(
                                      20,
                                      Math.max(1, Number(e.target.value) || 1),
                                    ),
                                  }
                                : item,
                            ),
                          )
                        }
                        className="inp"
                      />
                    </Field>
                  </div>
                  {units.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setUnits((current) => current.filter((_, i) => i !== index))}
                      className="mt-5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--ink)]/35 transition hover:bg-red-50 hover:text-red-600"
                      aria-label="Ta bort boende"
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setUnits((current) => [...current, emptyUnit()])}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#2d684c]"
          >
            <Plus size={14} /> Lägg till fler boenden
          </button>
        </div>
      </section>

      <details className="card-surface group mt-4 p-5 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center gap-3">
          <ChevronDown
            size={16}
            className="shrink-0 text-[#2d684c] transition group-open:rotate-180"
          />
          <div>
            <p className="text-[13px] font-bold">Lägg till gästinformation nu</p>
            <p className="mt-0.5 text-[11px] text-[color:var(--ink)]/45">
              Valfritt — wifi, portkod, vägbeskrivning och husregler kan lika gärna fyllas i senare.
            </p>
          </div>
        </summary>

        <div className="mt-5 space-y-4 border-t border-[color:var(--line)] pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kontakttelefon">
              <input value={form.contact_phone} onChange={set("contact_phone")} className="inp" />
            </Field>
            <Field label="Recensionslänk">
              <input value={form.review_url} onChange={set("review_url")} className="inp" />
            </Field>
          </div>
          {units.map((unit, index) => (
            <div key={index} className="grid gap-4 sm:grid-cols-2">
              <Field label={`${unit.name.trim() || `Boende ${index + 1}`} · portkod`}>
                <input
                  value={unit.door_code}
                  onChange={(e) =>
                    setUnits((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, door_code: e.target.value } : item,
                      ),
                    )
                  }
                  className="inp"
                />
              </Field>
              <Field label={`${unit.name.trim() || `Boende ${index + 1}`} · beskrivning`}>
                <input
                  value={unit.description}
                  onChange={(e) =>
                    setUnits((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, description: e.target.value } : item,
                      ),
                    )
                  }
                  className="inp"
                />
              </Field>
            </div>
          ))}
        </div>
      </details>

      {error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!valid || busy}
        className="btn-primary mt-5 w-full justify-center !rounded-xl !py-3.5 text-[15px] disabled:opacity-40"
      >
        {busy ? "Skapar…" : "Fortsätt till kalenderkoppling →"}
      </button>
      <p className="mt-2 text-center text-[10px] text-[color:var(--ink)]/38">
        Nästa steg är att koppla dina befintliga bokningar. Inget raderas eller flyttas från
        Sirvoy.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">
        {label}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
