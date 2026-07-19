-- StayBoost: Sirvoy-integration + manuell Swish-betalning.
-- Sirvoy har inget öppet REST-API (deras egna docs) men erbjuder
-- "Booking event webhook" (pushar JSON) och iCal båda håll — vi tar emot
-- webhooken per anläggning och mappar Sirvoy-rum via units.external_ref.

alter table public.properties
  add column swish_number text,
  add column sirvoy_webhook_token text not null default encode(gen_random_bytes(12), 'hex');

-- Sirvoy rums-id/rumsnamn — kopplar webhook-payloads till rätt enhet
alter table public.units
  add column external_ref text;

-- Bokningar från Sirvoy (webhook) med dedup på externt id
alter table public.bookings
  add column external_id text;

alter table public.bookings drop constraint bookings_source_check;
alter table public.bookings
  add constraint bookings_source_check check (source in ('manual', 'ical', 'direct', 'sirvoy'));

create unique index bookings_external_dedup
  on public.bookings (property_id, external_id)
  where external_id is not null;

-- Manuell Swish-betalning av direktbokningar
alter table public.bookings
  add column payment_status text not null default 'none'
    check (payment_status in ('none', 'pending', 'paid', 'refunded')),
  add column payment_amount int,
  add column payment_ref text;
