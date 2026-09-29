import type { Lang } from "@/lib/boka-i18n";
import type { BookingParty } from "../../supabase/functions/_shared/pricing";

import { partyLabels } from "@/lib/party-i18n";

export function PartySelector({
  party,
  maxGuests,
  maxChildAge,
  lang,
  onChange,
}: {
  party: BookingParty;
  maxGuests: number;
  maxChildAge: number;
  lang: Lang;
  onChange: (party: BookingParty) => void;
}) {
  const t = partyLabels[lang];
  const field = "mt-1 block min-h-11 w-full rounded-xl border bg-white p-2 text-sm";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">
        {t.adults}
        <select
          className={field}
          value={party.adults}
          onChange={(event) => onChange({ ...party, adults: Number(event.target.value) })}
        >
          {Array.from({ length: maxGuests }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold">
        {t.children} (0–{maxChildAge} {t.years})
        <select
          className={field}
          value={party.childrenAges.length}
          onChange={(event) => {
            const count = Number(event.target.value);
            onChange({
              ...party,
              childrenAges: Array.from(
                { length: count },
                (_, index) => party.childrenAges[index] ?? -1,
              ),
            });
          }}
        >
          {Array.from({ length: maxGuests }, (_, count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>
      {party.childrenAges.map((age, index) => (
        <label className="text-sm font-semibold" key={index}>
          {t.children} {index + 1} · {t.age}
          <select
            required
            className={field}
            value={age}
            onChange={(event) =>
              onChange({
                ...party,
                childrenAges: party.childrenAges.map((current, child) =>
                  child === index ? Number(event.target.value) : current,
                ),
              })
            }
          >
            <option value={-1} disabled>
              {t.chooseAge}
            </option>
            {Array.from({ length: maxChildAge + 1 }, (_, value) => (
              <option key={value} value={value}>
                {value} {t.years}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
