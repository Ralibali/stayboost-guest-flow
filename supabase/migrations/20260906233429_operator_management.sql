-- StayBoost: audit-logg för administrativa ändringar.
-- Skriver en rad per manuell ändring i /app (bokningar, källor, tillval, inställningar).
-- Ägaren ser endast sin egen anläggnings händelser. RLS enligt properties.owner_id.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity text not null,
  entity_id uuid,
  action text not null,
  summary text,
  changes jsonb,
  created_at timestamptz not null default now()
);

grant select, insert on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;

alter table public.admin_audit_log enable row level security;

create policy "owners read audit log"
  on public.admin_audit_log for select to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = admin_audit_log.property_id and p.owner_id = auth.uid()
  ));

create policy "owners write audit log"
  on public.admin_audit_log for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.properties p
      where p.id = admin_audit_log.property_id and p.owner_id = auth.uid()
    )
  );

create index if not exists admin_audit_log_property_created
  on public.admin_audit_log (property_id, created_at desc);

-- StayBoost: datumstyrda pris- och tillgänglighetsregler per boende.
-- En regel gäller för en enhet (eller hela anläggningen om unit_id är null)
-- under [date_from, date_to] och kan sätta fast nattpris, procentjustering,
-- minsta vistelse eller blockera ankomst/avresa/hela datum.
-- Server-side prissättning i booking-engine är enda sanningskälla och läser
-- dessa regler före monthly_mult / weekend_pct.
--
-- Reglerna tillämpas per natt. Vid överlapp vinner högre `priority`
-- (fallback: senast skapad). `active = false` inaktiverar regeln utan att
-- radera den — bra för säsonger och kampanjer.

create type public.rate_rule_kind as enum (
  'price_override',   -- sätt exakt nattpris (fixed_price krävs)
  'price_multiplier', -- justera nattpriset med pct_delta (%)
  'min_stay',         -- kräv minst N nätter om vistelsen berör datumet
  'closed',           -- blockera datumet helt för direktbokning
  'no_arrival',       -- gäster får inte checka in detta datum
  'no_departure'      -- gäster får inte checka ut detta datum
);

create table if not exists public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  name text,
  kind public.rate_rule_kind not null,
  date_from date not null,
  date_to date not null,
  fixed_price int check (fixed_price is null or (fixed_price between 0 and 1000000)),
  pct_delta int check (pct_delta is null or (pct_delta between -90 and 500)),
  min_stay int check (min_stay is null or (min_stay between 1 and 30)),
  priority int not null default 0,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_to >= date_from),
  check (
    (kind = 'price_override'   and fixed_price is not null) or
    (kind = 'price_multiplier' and pct_delta   is not null) or
    (kind = 'min_stay'         and min_stay    is not null) or
    (kind in ('closed','no_arrival','no_departure'))
  )
);

grant select, insert, update, delete on public.rate_rules to authenticated;
grant all on public.rate_rules to service_role;

alter table public.rate_rules enable row level security;

create policy "owners manage rate rules"
  on public.rate_rules for all to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = rate_rules.property_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.properties p
    where p.id = rate_rules.property_id and p.owner_id = auth.uid()
  ));

-- Publika bokningsmotorn (service-role) läser aktiva, framtidsrelevanta regler.
create index if not exists rate_rules_lookup_idx
  on public.rate_rules (property_id, unit_id, date_from, date_to)
  where active;

create index if not exists rate_rules_active_idx
  on public.rate_rules (property_id, active);

create or replace function public.rate_rules_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger rate_rules_updated_at
  before update on public.rate_rules
  for each row execute function public.rate_rules_touch_updated_at();

-- Owner-managed booking operations. Never writes payment amounts or payment status.
alter table public.properties
  add column booking_enabled boolean not null default true,
  add column max_stay integer not null default 30 check (max_stay between 1 and 30),
  add column contact_email text;
alter table public.bookings
  add column internal_notes text check (length(internal_notes) <= 10000),
  add column stay_status text not null default 'expected' check (stay_status in ('expected','checked_in','checked_out','no_show'));
alter table public.addons
  add column internal_only boolean not null default false,
  add column available_from date,
  add column available_to date,
  add column max_quantity integer not null default 20 check (max_quantity between 1 and 20),
  add constraint addons_availability_dates check ((available_from is null and available_to is null) or (available_from is not null and available_to is not null and available_to >= available_from));

-- Prevent cross-property references in rate rules, even for owners of two properties.
drop policy "owners manage rate rules" on public.rate_rules;
create policy "owners manage rate rules" on public.rate_rules for all to authenticated
using (exists (select 1 from public.properties p where p.id = rate_rules.property_id and p.owner_id = (select auth.uid())))
with check (exists (select 1 from public.properties p where p.id = rate_rules.property_id and p.owner_id = (select auth.uid()))
  and (unit_id is null or exists (select 1 from public.units u where u.id = rate_rules.unit_id and u.property_id = rate_rules.property_id)));
create index if not exists rate_rules_unit_fk on public.rate_rules(unit_id);

-- Integrity applies to all managed writers, not only the admin form.
create or replace function public.validate_managed_booking()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  u public.units%rowtype;
  max_nights integer;
  inventory_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    inventory_changed := row(new.unit_id,new.checkin_date,new.checkout_date,new.guests)
      is distinct from row(old.unit_id,old.checkin_date,old.checkout_date,old.guests);
    if auth.uid() is not null then
      if new.property_id is distinct from old.property_id or new.source is distinct from old.source then
        raise exception 'booking_source_server_only' using errcode = '42501';
      end if;
      if inventory_changed and old.source in ('ical','sirvoy') then raise exception 'external_booking_dates'; end if;
      if inventory_changed and old.payment_status in ('pending','refund_pending') then raise exception 'pending_payment_edit'; end if;
      if old.status = 'cancelled' and (inventory_changed or new.stay_status is distinct from old.stay_status) then raise exception 'cancelled_booking_edit'; end if;
    end if;
  elsif auth.uid() is not null and new.source <> 'manual' then
    raise exception 'booking_source_server_only' using errcode = '42501';
  end if;
  if new.unit_id is null and new.source in ('manual','direct') and new.status='confirmed' then raise exception 'invalid_unit'; end if;
  if new.unit_id is null or new.status <> 'confirmed' then return new; end if;
  select * into u from public.units where id = new.unit_id;
  if not found or u.property_id <> new.property_id then raise exception 'invalid_unit'; end if;
  if new.source in ('manual','direct') and inventory_changed then
    if new.guests is not null and (new.guests < 1 or new.guests > u.max_guests) then raise exception 'capacity_exceeded'; end if;
    if tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id then
      if not u.active then raise exception 'inactive_unit'; end if;
    end if;
    select max_stay into max_nights from public.properties where id = new.property_id;
    if new.checkout_date - new.checkin_date > max_nights then raise exception 'max_stay_exceeded'; end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_managed_booking() from public, anon, authenticated;
create trigger bookings_validate_admin before insert or update on public.bookings
for each row execute function public.validate_managed_booking();

-- Invoker rights preserve owner RLS. Row locking plus expected timestamp prevents lost updates.
create or replace function public.admin_update_booking(
  p_booking_id uuid, p_expected_updated_at timestamptz,
  p_unit_id uuid, p_checkin date, p_checkout date,
  p_guest_name text, p_guest_email text, p_guest_phone text, p_guests integer,
  p_internal_notes text, p_stay_status text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found' using errcode = '42501'; end if;
  if p_expected_updated_at is null or b.updated_at is distinct from p_expected_updated_at then raise exception 'stale_booking'; end if;
  if p_guest_name is null or length(trim(p_guest_name)) not between 2 and 120
     or p_checkin is null or p_checkout is null or p_checkout <= p_checkin
     or (p_guests is null and b.guests is not null) or p_guests < 1 or p_guests > 20
     or p_stay_status is null or p_stay_status not in ('expected','checked_in','checked_out','no_show')
     or length(p_internal_notes) > 10000 or length(p_guest_email) > 254 or length(p_guest_phone) > 40
     or (p_guest_email is not null and p_guest_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  then raise exception 'invalid_booking_details'; end if;
  update public.bookings set unit_id=p_unit_id, checkin_date=p_checkin, checkout_date=p_checkout,
    guest_name=trim(p_guest_name), guest_email=nullif(trim(p_guest_email),''), guest_phone=nullif(trim(p_guest_phone),''),
    guests=p_guests, internal_notes=nullif(trim(p_internal_notes),''), stay_status=p_stay_status
  where id = b.id;
  return b.id;
end $$;
revoke all on function public.admin_update_booking(uuid,timestamptz,uuid,date,date,text,text,text,integer,text,text) from public, anon;
grant execute on function public.admin_update_booking(uuid,timestamptz,uuid,date,date,text,text,text,integer,text,text) to authenticated;

-- Keep historical bookings attached to their actual accommodation.
create or replace function public.protect_booked_unit_delete()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.bookings where unit_id = old.id) then
    raise exception 'unit_has_bookings_archive_instead';
  end if;
  return old;
end $$;
revoke all on function public.protect_booked_unit_delete() from public, anon, authenticated;
create trigger units_preserve_booking_history before delete on public.units
for each row execute function public.protect_booked_unit_delete();

-- Trigger-generated history is append-only for operators. Store field names, never values/credentials.
drop policy "owners write audit log" on public.admin_audit_log;
revoke insert, update, delete on public.admin_audit_log from authenticated, anon;
create index if not exists admin_audit_log_entity_lookup on public.admin_audit_log(property_id,entity,entity_id,created_at desc);
create index if not exists admin_audit_log_actor_fk on public.admin_audit_log(actor_id);
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.record_admin_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare before_row jsonb; after_row jsonb; current_row jsonb; pid uuid; actor uuid := auth.uid(); changed text[];
begin
  if actor is null then return null; end if;
  before_row := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  after_row := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  current_row := case when tg_op = 'DELETE' then before_row else after_row end;
  pid := case when tg_table_name = 'properties' then (current_row->>'id')::uuid else (current_row->>'property_id')::uuid end;
  if not exists(select 1 from public.properties where id=pid and owner_id=actor) then return null; end if;
  select array_agg(key order by key) into changed from jsonb_object_keys(before_row || after_row) as key
    where key not in ('updated_at','created_at','id','property_id','owner_id','guest_token','ical_feed_token','sirvoy_webhook_token')
      and before_row->key is distinct from after_row->key;
  if changed is null then return null; end if;
  insert into public.admin_audit_log(property_id,actor_id,entity,entity_id,action,changes)
    values(pid,actor,tg_table_name,(current_row->>'id')::uuid,tg_op,jsonb_build_object('fields',changed));
  return null;
end $$;
revoke all on function private.record_admin_change() from public, anon, authenticated;
do $$ declare entity text; begin
  foreach entity in array array['properties','units','bookings','addons','rate_rules','message_templates','ical_sources'] loop
    execute format('create trigger record_admin_change after insert or update or delete on public.%I for each row execute function private.record_admin_change()',entity);
  end loop;
end $$;
