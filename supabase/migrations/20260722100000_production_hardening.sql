-- StayBoost: produktionshärdning av boenden, kapacitet, betalningshållning och bokningsskydd.

-- ============================================================
-- Kompletta boendeprofiler
-- ============================================================
alter table public.units
  add column description text,
  add column image_url text,
  add column max_guests int not null default 2 check (max_guests between 1 and 20),
  add column bed_description text,
  add column size_sqm numeric(6,1) check (size_sqm is null or size_sqm > 0),
  add column amenities text[] not null default '{}',
  add column checkin_instructions text,
  add column active boolean not null default true;

-- Rimliga startvärden för den befintliga pilotanläggningen. Allt kan ändras i admin.
update public.units
set max_guests = case
  when lower(name) like '%naturkärnan%' then 4
  when lower(name) like '%sjöbrisretreatet%' then 3
  when lower(name) like '%lugnets yta%' then 3
  else max_guests
end;

create index units_property_active_idx on public.units (property_id, active, sort_order);

-- ============================================================
-- Betalningshållning + enkel, integritetsvänlig rate limiting
-- ============================================================
alter table public.properties
  add column swish_hold_minutes int not null default 60
    check (swish_hold_minutes between 15 and 1440);

alter table public.bookings
  add column payment_expires_at timestamptz;

create index bookings_pending_expiry_idx
  on public.bookings (payment_expires_at)
  where status = 'confirmed' and payment_status = 'pending';

create table public.booking_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index booking_attempts_recent_idx on public.booking_attempts (ip_hash, created_at desc);
alter table public.booking_attempts enable row level security;
-- Inga klientpolicies: tabellen används endast av service-role i booking-engine.

-- ============================================================
-- Race-säkert skydd för direkt- och manuella bokningar
-- ============================================================
create or replace function public.prevent_managed_booking_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unit_id is null or new.status <> 'confirmed' or new.source not in ('manual', 'direct') then
    return new;
  end if;

  -- Serialisera bokningar per enhet så två samtidiga anrop aldrig kan passera kontrollen.
  perform pg_advisory_xact_lock(hashtextextended(new.unit_id::text, 0));

  if exists (
    select 1
    from public.bookings b
    where b.unit_id = new.unit_id
      and b.status = 'confirmed'
      and b.id <> new.id
      and b.checkin_date < new.checkout_date
      and b.checkout_date > new.checkin_date
  ) then
    raise exception 'booking_overlap' using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_prevent_managed_overlap on public.bookings;
create trigger bookings_prevent_managed_overlap
  before insert or update of unit_id, checkin_date, checkout_date, status, source
  on public.bookings
  for each row execute function public.prevent_managed_booking_overlap();

-- ============================================================
-- Bildlagring för boenden + ägarsäkrade policies för alla produktbilder
-- Filvägen måste börja med anläggningens UUID: <property-id>/<filnamn>.
-- ============================================================
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('unit-images', 'unit-images', true)
  on conflict (id) do nothing;

  drop policy if exists "owner uploads unit images" on storage.objects;
  drop policy if exists "owner updates unit images" on storage.objects;
  drop policy if exists "owner deletes unit images" on storage.objects;
  drop policy if exists "public reads unit images" on storage.objects;

  create policy "owner uploads unit images" on storage.objects
    for insert with check (
      bucket_id = 'unit-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    );

  create policy "owner updates unit images" on storage.objects
    for update using (
      bucket_id = 'unit-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    ) with check (
      bucket_id = 'unit-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    );

  create policy "owner deletes unit images" on storage.objects
    for delete using (
      bucket_id = 'unit-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    );

  create policy "public reads unit images" on storage.objects
    for select using (bucket_id = 'unit-images');

  -- Tidigare tillvalspolicies tillät alla inloggade att ändra alla bilder.
  drop policy if exists "owner uploads addon images" on storage.objects;
  drop policy if exists "owner updates addon images" on storage.objects;
  drop policy if exists "owner deletes addon images" on storage.objects;

  create policy "owner uploads addon images" on storage.objects
    for insert with check (
      bucket_id = 'addon-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    );

  create policy "owner updates addon images" on storage.objects
    for update using (
      bucket_id = 'addon-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    ) with check (
      bucket_id = 'addon-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    );

  create policy "owner deletes addon images" on storage.objects
    for delete using (
      bucket_id = 'addon-images'
      and exists (
        select 1 from public.properties p
        where p.owner_id = auth.uid()
          and p.id::text = (storage.foldername(name))[1]
      )
    );
exception
  when undefined_table then null;
end $$;
