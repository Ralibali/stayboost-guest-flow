import { useId } from "react";
import type { Unit } from "@/lib/supabase";
import type { AddonUnitScope } from "@/lib/addon-unit-scope";

export function AddonUnitScopeSelector({
  scope,
  selected,
  units,
  disabled,
  onChange,
}: {
  scope: AddonUnitScope;
  selected: string[];
  units: Pick<Unit, "id" | "name" | "active">[];
  disabled?: boolean;
  onChange: (scope: AddonUnitScope, unitIds: string[]) => void;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-xl border p-4">
      <legend className="px-1 text-sm font-semibold">Vilka enheter gäller tillvalet för?</legend>
      <label className="flex gap-2 text-sm">
        <input
          type="radio"
          name={name}
          checked={scope === "all"}
          onChange={() => onChange("all", selected)}
        />
        Alla enheter
      </label>
      <label className="flex gap-2 text-sm">
        <input
          type="radio"
          name={name}
          checked={scope === "selected"}
          onChange={() => onChange("selected", selected)}
        />
        Utvalda enheter
      </label>
      {scope === "selected" && (
        <div className="space-y-2 pl-5">
          {units.map((unit) => (
            <label key={unit.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                value={unit.id}
                checked={selected.includes(unit.id)}
                onChange={(event) =>
                  onChange(
                    "selected",
                    event.target.checked
                      ? [...selected, unit.id]
                      : selected.filter((id) => id !== unit.id),
                  )
                }
              />
              <span>
                {unit.name}
                {unit.active ? "" : " (dold)"}
              </span>
            </label>
          ))}
          {!units.length && <p className="text-xs">Lägg till en enhet i inställningarna först.</p>}
          {!selected.length && (
            <p className="text-xs text-amber-800">Välj minst en enhet innan du sparar.</p>
          )}
        </div>
      )}
    </fieldset>
  );
}
