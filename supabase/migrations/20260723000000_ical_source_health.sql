-- StayBoost: hälsofält och kanaltyp för iCal-källor.
-- Möjliggör Sirvoy-parallelläge där varje källa kan pausas utan att
-- importerade bokningar raderas, och ger tydlig hälsostatus per källa.

alter table public.ical_sources
  add column if not exists channel_type text not null default 'other'
    check (channel_type in ('sirvoy','booking','airbnb','other')),
  add column if not exists paused boolean not null default false,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists consecutive_failures int not null default 0;

create index if not exists ical_sources_property_channel
  on public.ical_sources (property_id, channel_type);
