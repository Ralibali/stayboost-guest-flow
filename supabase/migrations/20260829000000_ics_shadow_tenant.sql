-- StayBoost ICS V1 (SHADOW): tenant-native calendar_events + hashed export tokens.
-- Extends ical_sources / ical-sync / ical-export. Does not replace bookings.
-- Does not weaken prevent_managed_booking_overlap (manual/direct race lock stays).
--
-- Isolation: tenant_id = properties.id (founder property maps to itself; never a
-- global singleton). Existing owner_id RLS on properties still gates access.
--
-- LIMITATION (vault gap): no secret vault is available in this environment.
-- Feed URLs stay in ical_sources.url, treated as a secrets-style column.
-- Edge functions and sync logs must never print the URL. Encrypt-at-rest
-- via Vault is a follow-up; do not log or commit raw export tokens.

-- ============================================================
-- ical_sources: tenant + HTTP cache + HEALTHY/FAILED
-- ============================================================
alter table public.ical_sources
  add column if not exists tenant_id uuid references public.properties(id) on delete cascade,
  add column if not exists http_etag text,
  add column if not exists http_last_modified text,
  add column if not exists last_fetch timestamptz,
  add column if not exists last_success timestamptz,
  add column if not exists last_error text,
  add column if not exists health text not null default 'FAILED'
    check (health in ('HEALTHY', 'FAILED'));

update public.ical_sources
  set tenant_id = property_id
  where tenant_id is null;

alter table public.ical_sources
  alter column tenant_id set not null;

create or replace function public.ical_sources_set_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := new.property_id;
  end if;
  return new;
end;
$$;

drop trigger if exists ical_sources_set_tenant_id on public.ical_sources;
create trigger ical_sources_set_tenant_id
  before insert or update of property_id, tenant_id
  on public.ical_sources
  for each row execute function public.ical_sources_set_tenant_id();

comment on column public.ical_sources.url is
  'Secrets-style feed URL. No vault in V1 — never log, never dump in UI logs.';
comment on column public.ical_sources.tenant_id is
  'Tenant isolation key; equals properties.id for the founder property.';

create index if not exists ical_sources_tenant_unit
  on public.ical_sources (tenant_id, unit_id);

-- ============================================================
-- calendar_events (shadow occupancy — not bookings)
-- ============================================================
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  ical_source_id uuid references public.ical_sources(id) on delete set null,
  channel text not null
    check (channel in ('sirvoy', 'booking', 'airbnb', 'other', 'stayboost', 'direct')),
  origin_channel text not null
    check (origin_channel in ('sirvoy', 'booking', 'airbnb', 'other', 'stayboost', 'direct')),
  ical_uid text not null,
  checkin_date date not null,
  checkout_date date not null,
  status text not null
    check (status in ('NEW', 'UPDATED', 'CANCELLED', 'REMOVED', 'UNCHANGED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (checkout_date > checkin_date),
  unique (tenant_id, channel, unit_id, ical_uid)
);

create index calendar_events_tenant_unit_dates
  on public.calendar_events (tenant_id, unit_id, checkin_date);

create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

comment on table public.calendar_events is
  'Shadow ICS occupancy. origin_channel is required so export can suppress echo-back to the same OTA.';
comment on column public.calendar_events.origin_channel is
  'Channel that created this busy block. Export must omit events where origin_channel = destination.';

-- ============================================================
-- Inventory occupancy: one night per tenant+unit
-- Nights are [checkin, checkout) so back-to-back stays do not collide.
-- ============================================================
create table public.calendar_occupancy (
  tenant_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  night date not null,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  primary key (tenant_id, unit_id, night)
);

-- ============================================================
-- Export tokens: high-entropy, hashed, rotatable, revocable, tenant-bound
-- Raw token is never stored. SHA-256 hex via pgcrypto digest().
-- ============================================================
create table public.calendar_export_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  destination_channel text not null
    check (destination_channel in ('sirvoy', 'booking', 'airbnb', 'other', 'stayboost')),
  token_hash text not null unique,
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now()
);

create index calendar_export_tokens_tenant_unit
  on public.calendar_export_tokens (tenant_id, unit_id)
  where revoked_at is null;

comment on table public.calendar_export_tokens is
  'Hashed ICS export tokens for GET /calendar/export/{token}.ics. Raw token never persisted.';
comment on column public.calendar_export_tokens.token_hash is
  'SHA-256 hex of the raw token. Lookup only; never log the raw token.';

-- ============================================================
-- RLS: same owner isolation as ical_sources (via properties.owner_id)
-- ============================================================
alter table public.calendar_events enable row level security;
alter table public.calendar_occupancy enable row level security;
alter table public.calendar_export_tokens enable row level security;

create policy "Owners manage own calendar events" on public.calendar_events
  for all using (public.owns_property(tenant_id)) with check (public.owns_property(tenant_id));

create policy "Owners manage own calendar occupancy" on public.calendar_occupancy
  for all using (public.owns_property(tenant_id)) with check (public.owns_property(tenant_id));

create policy "Owners manage own calendar export tokens" on public.calendar_export_tokens
  for all using (public.owns_property(tenant_id)) with check (public.owns_property(tenant_id));
