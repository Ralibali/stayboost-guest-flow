-- ============================================================
-- StayBoost · Tillval (add-ons) med bilder
-- Anläggningen säljer tillval i bokningsmotorn: badtunna, ved,
-- frukostkorg, sen utcheckning… Priser kan vara per bokning
-- eller per natt. Gästens val sparas med priset vid köptillfället
-- så att historik aldrig ändras i efterhand.
-- ============================================================

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text,
  price int not null default 0 check (price >= 0), -- kr
  price_type text not null default 'per_booking'
    check (price_type in ('per_booking', 'per_night')),
  image_url text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index addons_property_idx on public.addons (property_id, sort_order);

-- Gästens valda tillval på en bokning. unit_price fryser priset
-- vid bokningstillfället; quantity multiplicerar (och per_night
-- multipliceras dessutom med antal nätter i bokningsmotorn).
create table public.booking_addons (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  addon_id uuid not null references public.addons(id) on delete cascade,
  quantity int not null default 1 check (quantity > 0),
  unit_price int not null check (unit_price >= 0),
  primary key (booking_id, addon_id)
);

-- Totalsumman för tillvalen (räknas ut av motorn, speglas här) samt
-- antal gäster om gästen angett det.
alter table public.bookings
  add column addons_total int not null default 0,
  add column guests int check (guests is null or guests > 0);

-- ---------- RLS ----------
alter table public.addons enable row level security;
alter table public.booking_addons enable row level security;

create policy "owner manages addons" on public.addons
  for all using (public.owns_property(property_id))
  with check (public.owns_property(property_id));

create policy "owner reads booking_addons" on public.booking_addons
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id and public.owns_property(b.property_id)
    )
  );

-- ---------- Bildlagring (Supabase Storage) ----------
-- Publik bucket för tillvalsbilder. Hopps över tyst i testmiljöer
-- (PGlite) som saknar storage-schemat.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('addon-images', 'addon-images', true)
  on conflict (id) do nothing;

  create policy "owner uploads addon images" on storage.objects
    for insert with check (
      bucket_id = 'addon-images' and auth.role() = 'authenticated'
    );
  create policy "owner updates addon images" on storage.objects
    for update using (
      bucket_id = 'addon-images' and auth.role() = 'authenticated'
    );
  create policy "owner deletes addon images" on storage.objects
    for delete using (
      bucket_id = 'addon-images' and auth.role() = 'authenticated'
    );
  create policy "public reads addon images" on storage.objects
    for select using (bucket_id = 'addon-images');
exception
  when undefined_table then null; -- ingen storage i testmiljön
end $$;
