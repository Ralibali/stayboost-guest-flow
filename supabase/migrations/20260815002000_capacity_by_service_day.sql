-- Kapacitet ska räknas på dagen tjänsten faktiskt utförs.
-- arrival: endast ankomstdagen
-- each_stay_day: varje dag [checkin, checkout)
-- each_morning: varje morgon (checkin, checkout]

create or replace function public.addon_service_applies(
  timing text,
  checkin_date date,
  checkout_date date,
  service_date date
)
returns boolean
language sql
immutable
as $$
  select case timing
    when 'arrival' then service_date = checkin_date
    when 'each_morning' then service_date > checkin_date and service_date <= checkout_date
    else service_date >= checkin_date and service_date < checkout_date
  end;
$$;

create or replace function public.enforce_booking_addon_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_timing text;
  v_checkin date;
  v_checkout date;
  v_status text;
  v_day date;
  v_start date;
  v_end date;
  v_committed int;
  v_pending int;
begin
  select capacity_per_day, service_timing
    into v_capacity, v_timing
  from public.addons
  where id = new.addon_id;

  if v_capacity is null then return new; end if;

  select checkin_date, checkout_date, status
    into v_checkin, v_checkout, v_status
  from public.bookings
  where id = new.booking_id;

  if v_checkin is null or v_status <> 'confirmed' then return new; end if;

  v_start := case v_timing
    when 'each_morning' then v_checkin + 1
    else v_checkin
  end;
  v_end := case v_timing
    when 'arrival' then v_checkin
    when 'each_morning' then v_checkout
    else v_checkout - 1
  end;

  for v_day in select generate_series(v_start, v_end, interval '1 day')::date loop
    perform pg_advisory_xact_lock(
      hashtextextended('addon-capacity:' || new.addon_id::text || ':' || v_day::text, 0)
    );

    select coalesce(sum(ba.quantity), 0)::int
      into v_committed
    from public.booking_addons ba
    join public.bookings b on b.id = ba.booking_id
    where ba.addon_id = new.addon_id
      and b.status = 'confirmed'
      and public.addon_service_applies(v_timing, b.checkin_date, b.checkout_date, v_day)
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
      and public.addon_service_applies(v_timing, b.checkin_date, b.checkout_date, v_day);

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
  v_timing text;
  v_booking_id uuid;
  v_checkin date;
  v_checkout date;
  v_booking_status text;
  v_order_status text;
  v_expires_at timestamptz;
  v_day date;
  v_start date;
  v_end date;
  v_committed int;
  v_pending int;
begin
  select capacity_per_day, service_timing
    into v_capacity, v_timing
  from public.addons
  where id = new.addon_id;

  if v_capacity is null then return new; end if;

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

  v_start := case v_timing
    when 'each_morning' then v_checkin + 1
    else v_checkin
  end;
  v_end := case v_timing
    when 'arrival' then v_checkin
    when 'each_morning' then v_checkout
    else v_checkout - 1
  end;

  for v_day in select generate_series(v_start, v_end, interval '1 day')::date loop
    perform pg_advisory_xact_lock(
      hashtextextended('addon-capacity:' || new.addon_id::text || ':' || v_day::text, 0)
    );

    select coalesce(sum(ba.quantity), 0)::int
      into v_committed
    from public.booking_addons ba
    join public.bookings b on b.id = ba.booking_id
    where ba.addon_id = new.addon_id
      and b.status = 'confirmed'
      and public.addon_service_applies(v_timing, b.checkin_date, b.checkout_date, v_day);

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
      and public.addon_service_applies(v_timing, b.checkin_date, b.checkout_date, v_day);

    if v_committed + v_pending + new.quantity > v_capacity then
      raise exception 'addon_capacity_exceeded'
        using errcode = 'P0001',
              detail = format('addon=%s day=%s capacity=%s', new.addon_id, v_day, v_capacity);
    end if;
  end loop;

  return new;
end;
$$;
