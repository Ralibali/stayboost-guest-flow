-- StayBoost Fas 1: bokningar in → schemalagda gästmeddelanden ut → gästsida.
-- Allt ägarskap går via properties.owner_id. Gäster har ALDRIG inloggning:
-- gästsidan läses via guest_token genom edge-funktionen guest-page (service role),
-- därför finns inga anon-policies alls.
-- Bokningar och iCal-källor hör till en ENHET (stuga/tält/rum), eftersom
-- kanalernas iCal-länkar är per listing.

create extension if not exists pgcrypto;

-- ============================================================
-- Anläggningar
-- ============================================================
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  checkin_time text not null default '15:00',
  checkout_time text not null default '11:00',
  directions text,
  wifi_name text,
  wifi_password text,
  house_rules text,
  contact_phone text,
  review_url text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Enheter (stugor, tält, rum — det kanalerna listar separat)
-- ============================================================
create table public.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  door_code text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- iCal-källor (Airbnb, Booking.com m.fl.) — en källa per enhet och kanal
-- ============================================================
create table public.ical_sources (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null,
  url text not null,
  last_synced_at timestamptz,
  last_status text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Bokningar
-- ============================================================
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','ical')),
  ical_source_id uuid references public.ical_sources(id) on delete set null,
  ical_uid text,
  guest_name text,
  guest_email text,
  guest_phone text,
  checkin_date date not null,
  checkout_date date not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  guest_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (checkout_date > checkin_date)
);

-- Äkta constraint (inte partiellt index) så att supabase-js upsert kan
-- använda on_conflict. NULL-par (manuella bokningar) krockar aldrig.
alter table public.bookings
  add constraint bookings_ical_dedup unique (ical_source_id, ical_uid);

create index bookings_unit_dates on public.bookings (unit_id, checkin_date);

-- Medvetet INGEN hård överlappsspärr (exclusion constraint) här: samma enhet
-- listad på flera kanaler ger överlappande iCal-event tills kalendrarna hunnit
-- synka, och importen får aldrig krascha. Överlapp flaggas i operatörs-UI:t
-- som varning i stället (Fas 2).

-- ============================================================
-- Meddelandemallar
-- offset_days är relativt incheckning (pre_arrival, checkin_day)
-- eller utcheckning (post_stay). booking_created skickas direkt.
-- ============================================================
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('booking_created','pre_arrival','checkin_day','post_stay')),
  offset_days int not null default 0,
  send_time time not null default '09:00',
  channel text not null default 'email' check (channel in ('email','sms','both')),
  subject text,
  body text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Schemalagda meddelanden (genereras av trigger nedan)
-- ============================================================
create table public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  template_id uuid references public.message_templates(id) on delete cascade,
  channel text not null check (channel in ('email','sms')),
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (booking_id, template_id, channel)
);

create index scheduled_messages_due
  on public.scheduled_messages (send_at)
  where status = 'pending';

-- ============================================================
-- updated_at på bookings
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ============================================================
-- Svenska standardmallar när en anläggning skapas
-- ============================================================
create or replace function public.seed_default_templates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into message_templates (property_id, trigger_type, offset_days, send_time, channel, subject, body) values
  (new.id, 'booking_created', 0, '09:00', 'email',
   'Tack för din bokning – {{anläggning}}',
   'Hej {{gäst_namn}}!' || E'\n\n' ||
   'Vi ser fram emot ditt besök {{incheckning}}–{{utcheckning}}.' || E'\n\n' ||
   'All praktisk information inför vistelsen hittar du på din gästsida:' || E'\n' ||
   '{{gästsida_länk}}' || E'\n\n' ||
   'Varmt välkommen!' || E'\n' || '{{anläggning}}'),
  (new.id, 'pre_arrival', -2, '09:00', 'email',
   'Snart dags – bra att veta inför din vistelse',
   'Hej {{gäst_namn}}!' || E'\n\n' ||
   'Om två dagar checkar du in hos {{anläggning}}. Incheckning från {{incheckningstid}}.' || E'\n\n' ||
   'Hitta hit, wifi och allt annat praktiskt finns samlat på din gästsida:' || E'\n' ||
   '{{gästsida_länk}}' || E'\n\n' ||
   'Hör av dig om du har frågor. Vi ses snart!'),
  (new.id, 'checkin_day', 0, '08:00', 'sms',
   null,
   'Välkommen till {{anläggning}} idag! Incheckning från {{incheckningstid}}. Allt du behöver: {{gästsida_länk}}'),
  (new.id, 'post_stay', 1, '10:00', 'email',
   'Tack för ditt besök hos {{anläggning}}',
   'Hej {{gäst_namn}}!' || E'\n\n' ||
   'Tack för att du bodde hos oss – vi hoppas att du trivdes!' || E'\n\n' ||
   'Om du har en minut betyder ett omdöme mycket för oss: {{recensionslänk}}' || E'\n\n' ||
   'Varmt välkommen åter!' || E'\n' || '{{anläggning}}');
  return new;
end $$;

create trigger properties_seed_templates
  after insert on public.properties
  for each row execute function public.seed_default_templates();

-- ============================================================
-- Generera/uppdatera meddelandeschemat för en bokning
-- ============================================================
create or replace function public.generate_booking_messages()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_send timestamptz;
  v_channel text;
begin
  -- Avbokning: släck det som inte hunnit skickas
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    update scheduled_messages set status = 'cancelled'
      where booking_id = new.id and status = 'pending';
    return new;
  end if;

  if new.status <> 'confirmed' then
    return new;
  end if;

  -- Datumändring: räkna om det som ännu inte skickats
  if tg_op = 'UPDATE'
     and (new.checkin_date <> old.checkin_date or new.checkout_date <> old.checkout_date) then
    delete from scheduled_messages where booking_id = new.id and status = 'pending';
  end if;

  for t in
    select * from message_templates
    where property_id = new.property_id and enabled
  loop
    v_send := case t.trigger_type
      when 'booking_created' then now()
      when 'pre_arrival' then
        ((new.checkin_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
      when 'checkin_day' then
        ((new.checkin_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
      when 'post_stay' then
        ((new.checkout_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
    end;

    -- Sen import (t.ex. iCal mitt under vistelse): spamma inte gästen
    -- med förfallna meddelanden. booking_created skickas dock alltid.
    if t.trigger_type <> 'booking_created' and v_send < now() - interval '1 hour' then
      continue;
    end if;

    foreach v_channel in array
      (case t.channel when 'both' then array['email','sms'] else array[t.channel] end)
    loop
      insert into scheduled_messages (booking_id, template_id, channel, send_at)
      values (new.id, t.id, v_channel, v_send)
      on conflict (booking_id, template_id, channel) do nothing;
    end loop;
  end loop;

  return new;
end $$;

create trigger bookings_generate_messages
  after insert or update on public.bookings
  for each row execute function public.generate_booking_messages();

-- ============================================================
-- RLS: allt ägarskap via properties.owner_id. Inga anon-policies.
-- ============================================================
create or replace function public.owns_property(pid uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from properties where id = pid and owner_id = auth.uid()) $$;

alter table public.properties enable row level security;
alter table public.units enable row level security;
alter table public.ical_sources enable row level security;
alter table public.bookings enable row level security;
alter table public.message_templates enable row level security;
alter table public.scheduled_messages enable row level security;

create policy "Owners manage own properties" on public.properties
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owners manage own units" on public.units
  for all using (public.owns_property(property_id)) with check (public.owns_property(property_id));

create policy "Owners manage own ical sources" on public.ical_sources
  for all using (public.owns_property(property_id)) with check (public.owns_property(property_id));

create policy "Owners manage own bookings" on public.bookings
  for all using (public.owns_property(property_id)) with check (public.owns_property(property_id));

create policy "Owners manage own templates" on public.message_templates
  for all using (public.owns_property(property_id)) with check (public.owns_property(property_id));

create policy "Owners view own scheduled messages" on public.scheduled_messages
  for select using (exists (
    select 1 from public.bookings b
    where b.id = booking_id and public.owns_property(b.property_id)
  ));

create policy "Owners cancel own scheduled messages" on public.scheduled_messages
  for update using (exists (
    select 1 from public.bookings b
    where b.id = booking_id and public.owns_property(b.property_id)
  ));
