-- ============================================================
-- StayBoost · Guest Experience 2027
-- Efterköp av tillval, per-person-priser, daglig kapacitet och
-- tidsstyrd access för självgående premiumboenden.
-- ============================================================

-- Fler prismodeller: cykel/frukost kan säljas per person och natt/dag.
alter table public.addons
  drop constraint if exists addons_price_type_check;

alter table public.addons
  add constraint addons_price_type_check
  check (price_type in ('per_booking', 'per_night', 'per_person', 'per_person_per_night'));

alter table public.addons
  add column if not exists capacity_per_day int
    check (capacity_per_day is null or capacity_per_day > 0),
  add column if not exists fulfillment_note text;

-- Standard för svensk anläggning, men fälten gör lösningen multi-tenant.
alter table public.properties
  add column if not exists timezone text not null default 'Europe/Stockholm',
  add column if not exists access_code_lead_minutes int not null default 15
    check (access_code_lead_minutes between 0 and 1440);

-- Separata Stripe-köp efter att boendet redan är bokat. De påverkar inte
-- den ursprungliga bokningsbetalningen/refund-flödet.
create table if not exists public.addon_orders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'cancelled', 'failed')),
  amount int not null check (amount >= 0),
  payment_ref text not null unique,
  stripe_session_id text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addon_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.addon_orders(id) on delete cascade,
  addon_id uuid not null references public.addons(id) on delete restrict,
  quantity int not null check (quantity > 0),
  unit_price int not null check (unit_price >= 0),
  line_total int not null check (line_total >= 0),
  unique (order_id, addon_id)
);

create index if not exists addon_orders_booking_idx
  on public.addon_orders (booking_id, created_at desc);
create index if not exists addon_orders_pending_idx
  on public.addon_orders (status, expires_at)
  where status = 'pending';
create index if not exists addon_order_items_addon_idx
  on public.addon_order_items (addon_id, order_id);

alter table public.addon_orders enable row level security;
alter table public.addon_order_items enable row level security;

create policy "owner reads addon orders" on public.addon_orders
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id and public.owns_property(b.property_id)
    )
  );

create policy "owner reads addon order items" on public.addon_order_items
  for select using (
    exists (
      select 1
      from public.addon_orders o
      join public.bookings b on b.id = o.booking_id
      where o.id = order_id and public.owns_property(b.property_id)
    )
  );

-- ------------------------------------------------------------------
-- Race-säker daglig kapacitet.
-- Ex: capacity_per_day=6 på "Canal Picnic Ride" innebär att två
-- samtidiga checkout-flöden aldrig kan reservera fler än sex cyklar.
-- ------------------------------------------------------------------

create or replace function public.enforce_booking_addon_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_checkin date;
  v_checkout date;
  v_status text;
  v_day date;
  v_committed int;
  v_pending int;
begin
  select capacity_per_day into v_capacity
  from public.addons
  where id = new.addon_id;

  if v_capacity is null then
    return new;
  end if;

  select checkin_date, checkout_date, status
    into v_checkin, v_checkout, v_status
  from public.bookings
  where id = new.booking_id;

  if v_checkin is null or v_status <> 'confirmed' then
    return new;
  end if;

  for v_day in
    select generate_series(v_checkin, v_checkout - 1, interval '1 day')::date
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('addon-capacity:' || new.addon_id::text || ':' || v_day::text, 0)
    );

    select coalesce(sum(ba.quantity), 0)::int
      into v_committed
    from public.booking_addons ba
    join public.bookings b on b.id = ba.booking_id
    where ba.addon_id = new.addon_id
      and b.status = 'confirmed'
      and b.checkin_date <= v_day
      and b.checkout_date > v_day
      and not (ba.booking_id = new.booking_id and ba.addon_id = new.addon_id);

    select coalesce(sum(oi.quantity), 0)::int
      into v_pending
    from public.addon_order_items oi
    join public.addon_orders o on o.id = oi.order_id
    join public.bookings b on b.id = o.booking_id
    where oi.addon_id = new.addon_id
      and o.status = 'pending'
      and o.expires_at > now()
      and b.status = 'confirmed'
      and b.checkin_date <= v_day
      and b.checkout_date > v_day;

    if v_committed + v_pending + new.quantity > v_capacity then
      raise exception 'addon_capacity_exceeded'
        using errcode = 'P0001',
              detail = format('addon=%s day=%s capacity=%s', new.addon_id, v_day, v_capacity);
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.enforce_pending_addon_order_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_booking_id uuid;
  v_checkin date;
  v_checkout date;
  v_booking_status text;
  v_order_status text;
  v_expires_at timestamptz;
  v_day date;
  v_committed int;
  v_pending int;
begin
  select capacity_per_day into v_capacity
  from public.addons
  where id = new.addon_id;

  if v_capacity is null then
    return new;
  end if;

  select o.booking_id, o.status, o.expires_at,
         b.checkin_date, b.checkout_date, b.status
    into v_booking_id, v_order_status, v_expires_at,
         v_checkin, v_checkout, v_booking_status
  from public.addon_orders o
  join public.bookings b on b.id = o.booking_id
  where o.id = new.order_id;

  if v_booking_id is null
     or v_order_status <> 'pending'
     or v_expires_at <= now()
     or v_booking_status <> 'confirmed' then
    return new;
  end if;

  for v_day in
    select generate_series(v_checkin, v_checkout - 1, interval '1 day')::date
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('addon-capacity:' || new.addon_id::text || ':' || v_day::text, 0)
    );

    select coalesce(sum(ba.quantity), 0)::int
      into v_committed
    from public.booking_addons ba
    join public.bookings b on b.id = ba.booking_id
    where ba.addon_id = new.addon_id
      and b.status = 'confirmed'
      and b.checkin_date <= v_day
      and b.checkout_date > v_day;

    select coalesce(sum(oi.quantity), 0)::int
      into v_pending
    from public.addon_order_items oi
    join public.addon_orders o on o.id = oi.order_id
    join public.bookings b on b.id = o.booking_id
    where oi.addon_id = new.addon_id
      and o.id <> new.order_id
      and o.status = 'pending'
      and o.expires_at > now()
      and b.status = 'confirmed'
      and b.checkin_date <= v_day
      and b.checkout_date > v_day;

    if v_committed + v_pending + new.quantity > v_capacity then
      raise exception 'addon_capacity_exceeded'
        using errcode = 'P0001',
              detail = format('addon=%s day=%s capacity=%s', new.addon_id, v_day, v_capacity);
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists booking_addon_capacity_guard on public.booking_addons;
create trigger booking_addon_capacity_guard
before insert or update of quantity, addon_id on public.booking_addons
for each row execute function public.enforce_booking_addon_capacity();

drop trigger if exists pending_addon_order_capacity_guard on public.addon_order_items;
create trigger pending_addon_order_capacity_guard
before insert or update of quantity, addon_id on public.addon_order_items
for each row execute function public.enforce_pending_addon_order_capacity();

-- En enkel updated_at-trigger utan beroende på annan migration.
create or replace function public.touch_addon_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists addon_orders_touch_updated_at on public.addon_orders;
create trigger addon_orders_touch_updated_at
before update on public.addon_orders
for each row execute function public.touch_addon_order_updated_at();
