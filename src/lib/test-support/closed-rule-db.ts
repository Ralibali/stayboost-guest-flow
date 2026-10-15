import { readFileSync } from "node:fs";

export const OWNER = "00000000-0000-4000-8000-000000000001";
export const PROPERTY = "00000000-0000-4000-8000-000000000011";
export const OTHER_PROPERTY = "00000000-0000-4000-8000-000000000012";
export const UNIT = "00000000-0000-4000-8000-000000000021";
export const OTHER_UNIT = "00000000-0000-4000-8000-000000000022";
export const FOREIGN_UNIT = "00000000-0000-4000-8000-000000000023";
export const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
export const guardMigration = () => migration("20261015163226_closed_rule_booking_guard.sql");
export const fixtureSql = () =>
  [
    `create role anon; create role authenticated; create role service_role bypassrls;
     create schema auth; create table auth.users(id uuid primary key);
     insert into auth.users values('${OWNER}');
     create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
     grant usage on schema public,auth to authenticated,anon,service_role;`,
    ...[
      "20260719000000_fas1.sql",
      "20260719120000_ical_export.sql",
      "20260719200000_direct_booking.sql",
      "20260720000000_sirvoy_swish.sql",
      "20260720120000_stripe.sql",
      "20260721000000_addons.sql",
      "20260721120000_chat.sql",
      "20260722100000_production_hardening.sql",
      "20260723000000_ical_source_health.sql",
      "20260830210000_canonical_booking_write_lock.sql",
      "20260830220000_ical_reconciliation_guard.sql",
      "20260830230000_payment_lifecycle.sql",
      "20260906233429_operator_management.sql",
      "20260929190353_party_pricing.sql",
      "20260929190700_channex_channel_manager.sql",
      "20261014134140_ical_booking_freshness.sql",
    ].map(migration),
    `grant all on all tables in schema public to service_role;
     grant select,insert,update,delete on properties,units,bookings,ical_sources to authenticated;
     insert into properties(id,owner_id,name) values
       ('${PROPERTY}','${OWNER}','Synthetic'),('${OTHER_PROPERTY}','${OWNER}','Other');
     insert into units(id,property_id,name,max_guests) values
       ('${UNIT}','${PROPERTY}','A',4),('${OTHER_UNIT}','${PROPERTY}','B',4),
       ('${FOREIGN_UNIT}','${OTHER_PROPERTY}','C',4);`,
  ].join("\n");
export const bookingSql = (unit = UNIT, source = "direct", dates = "'2099-06-01','2099-06-03'") =>
  `insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date,payment_status,payment_method)
   values('${PROPERTY}','${unit}','${source}','Synthetic',2,${dates},'pending','stripe') returning id;`;
export const closureSql = (unit: string | null = UNIT, property = PROPERTY) =>
  `insert into rate_rules(property_id,unit_id,kind,date_from,date_to)
   values('${property}',${unit ? `'${unit}'` : "null"},'closed','2099-06-01','2099-06-02') returning id;`;
