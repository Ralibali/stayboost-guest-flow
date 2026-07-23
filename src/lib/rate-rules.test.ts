import { describe, expect, it } from "vitest";
import {
  applyPriceRules,
  checkAvailabilityRules,
  minStayFromRules,
  rulesForUnit,
  type RateRule,
} from "../../supabase/functions/_shared/rate-rules";
import {
  nightsBetween,
  quoteStay,
  type UnitPricing,
} from "../../supabase/functions/_shared/pricing";

const UNIT = "unit-1";
const OTHER = "unit-2";

const baseRule = (over: Partial<RateRule>): RateRule => ({
  id: crypto.randomUUID(),
  unit_id: UNIT,
  kind: "price_override",
  date_from: "2026-08-01",
  date_to: "2026-08-31",
  fixed_price: null,
  pct_delta: null,
  min_stay: null,
  priority: 0,
  active: true,
  name: null,
  ...over,
});

describe("rate-rules: prislogik", () => {
  it("fast pris (price_override) vinner över baspris", () => {
    const rules = [baseRule({ kind: "price_override", fixed_price: 2500 })];
    const r = applyPriceRules(1500, rules, UNIT, "2026-08-10");
    expect(r).toMatchObject({ price: 2500, source: "override" });
  });

  it("procentjustering avrundas till 5 kr och kan inte bli negativ", () => {
    const rules = [baseRule({ kind: "price_multiplier", pct_delta: 25 })];
    const r = applyPriceRules(1500, rules, UNIT, "2026-08-10");
    expect(r.price).toBe(1875); // 1500 * 1.25 = 1875 (redan jämnt 5)
    expect(r.source).toBe("multiplier");

    const drop = [baseRule({ kind: "price_multiplier", pct_delta: -90 })];
    const r2 = applyPriceRules(1000, drop, UNIT, "2026-08-10");
    expect(r2.price).toBe(100);
  });

  it("regelprioritet: högre priority vinner vid överlapp", () => {
    const rules = [
      baseRule({ id: "low", kind: "price_override", fixed_price: 900, priority: 0 }),
      baseRule({ id: "hi", kind: "price_override", fixed_price: 3200, priority: 10 }),
    ];
    const r = applyPriceRules(1500, rules, UNIT, "2026-08-10");
    expect(r.price).toBe(3200);
    expect(r.ruleId).toBe("hi");
  });

  it("override vinner över multiplier även vid samma priority", () => {
    const rules = [
      baseRule({ kind: "price_multiplier", pct_delta: 100 }),
      baseRule({ kind: "price_override", fixed_price: 2000 }),
    ];
    const r = applyPriceRules(1500, rules, UNIT, "2026-08-10");
    expect(r.source).toBe("override");
    expect(r.price).toBe(2000);
  });

  it("inaktiv regel eller regel för annan enhet ignoreras", () => {
    const rules: RateRule[] = [
      baseRule({ kind: "price_override", fixed_price: 9999, active: false }),
      baseRule({ kind: "price_override", fixed_price: 8888, unit_id: OTHER }),
    ];
    const r = applyPriceRules(1500, rules, UNIT, "2026-08-10");
    expect(r.source).toBe("base");
    expect(r.price).toBe(1500);
  });

  it("property-scope (unit_id=null) gäller alla enheter", () => {
    const rules = [baseRule({ unit_id: null, kind: "price_override", fixed_price: 1234 })];
    expect(applyPriceRules(1000, rules, UNIT, "2026-08-10").price).toBe(1234);
    expect(applyPriceRules(1000, rules, OTHER, "2026-08-10").price).toBe(1234);
  });

  it("regel utanför datumintervallet påverkar inte", () => {
    const rules = [baseRule({ kind: "price_override", fixed_price: 5000 })];
    const r = applyPriceRules(1500, rules, UNIT, "2026-09-01");
    expect(r.source).toBe("base");
  });

  it("quoteStay tillämpar rate-rules per natt", () => {
    const u: UnitPricing = {
      base_price: 1500,
      weekend_pct: 0,
      cleaning_fee: 500,
      monthly_mult: Array(12).fill(100),
    };
    const rules = [
      baseRule({
        kind: "price_override",
        fixed_price: 3000,
        date_from: "2026-08-10",
        date_to: "2026-08-10",
      }),
    ];
    const q = quoteStay(u, "2026-08-10", "2026-08-13", { rules, unitId: UNIT });
    expect(q.nights).toBe(3);
    expect(q.nightly.map((n) => n.price)).toEqual([3000, 1500, 1500]);
    expect(q.subtotal).toBe(6000);
    expect(q.total).toBe(6500);
    expect(q.nightly[0].source).toBe("override");
  });
});

describe("rate-rules: tillgänglighet", () => {
  const nights = (a: string, b: string) => nightsBetween(a, b);

  it("stängt datum blockerar bokningen med det exakta datumet", () => {
    const rules = [baseRule({ kind: "closed", date_from: "2026-08-12", date_to: "2026-08-12" })];
    const issue = checkAvailabilityRules(
      rules,
      UNIT,
      nights("2026-08-10", "2026-08-14"),
      "2026-08-14",
    );
    expect(issue).toEqual({ kind: "closed", date: "2026-08-12" });
  });

  it("stängd ankomst gäller bara första natten", () => {
    const rules = [
      baseRule({ kind: "no_arrival", date_from: "2026-08-10", date_to: "2026-08-10" }),
    ];
    expect(
      checkAvailabilityRules(rules, UNIT, nights("2026-08-10", "2026-08-12"), "2026-08-12"),
    ).toEqual({ kind: "no_arrival", date: "2026-08-10" });
    // Om ankomsten är 8:e (utanför regeln) ska den inte trigga även om vi passerar 10:e som natt.
    expect(
      checkAvailabilityRules(rules, UNIT, nights("2026-08-08", "2026-08-12"), "2026-08-12"),
    ).toBeNull();
  });

  it("stängd avresa gäller utcheckningsdatumet, inte nätterna", () => {
    const rules = [
      baseRule({ kind: "no_departure", date_from: "2026-08-14", date_to: "2026-08-14" }),
    ];
    expect(
      checkAvailabilityRules(rules, UNIT, nights("2026-08-12", "2026-08-14"), "2026-08-14"),
    ).toEqual({ kind: "no_departure", date: "2026-08-14" });
    expect(
      checkAvailabilityRules(rules, UNIT, nights("2026-08-12", "2026-08-13"), "2026-08-13"),
    ).toBeNull();
  });

  it("min_stay: högsta värdet över berörda nätter används", () => {
    const rules: RateRule[] = [
      baseRule({ kind: "min_stay", min_stay: 2, date_from: "2026-08-10", date_to: "2026-08-11" }),
      baseRule({ kind: "min_stay", min_stay: 4, date_from: "2026-08-12", date_to: "2026-08-15" }),
    ];
    const ms = minStayFromRules(rules, UNIT, nights("2026-08-10", "2026-08-14"));
    expect(ms).toBe(4);
  });

  it("rulesForUnit filtrerar bort inaktiva och andra enheter", () => {
    const rules: RateRule[] = [
      baseRule({ kind: "closed" }),
      baseRule({ kind: "closed", active: false }),
      baseRule({ kind: "closed", unit_id: OTHER }),
      baseRule({ kind: "closed", unit_id: null }),
    ];
    expect(rulesForUnit(rules, UNIT)).toHaveLength(2);
  });
});
