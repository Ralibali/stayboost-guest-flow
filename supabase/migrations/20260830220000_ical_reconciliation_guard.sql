-- BP-2: iCal reconciliation guard.
-- A reservation disappearing from one successful iCal fetch is not proof of
-- cancellation. Keep evidence across successful syncs before inventory is
-- released, and preserve explicit cancellation provenance for operations/debug.

alter table public.bookings
  add column if not exists ical_missing_since timestamptz,
  add column if not exists ical_missing_count int not null default 0,
  add column if not exists ical_cancelled_at timestamptz,
  add column if not exists ical_cancel_reason text;

alter table public.bookings
  drop constraint if exists bookings_ical_missing_count_nonnegative;
alter table public.bookings
  add constraint bookings_ical_missing_count_nonnegative
  check (ical_missing_count >= 0);

alter table public.bookings
  drop constraint if exists bookings_ical_cancel_reason_check;
alter table public.bookings
  add constraint bookings_ical_cancel_reason_check
  check (ical_cancel_reason is null or ical_cancel_reason in ('explicit', 'disappearance'));

alter table public.ical_sources
  add column if not exists http_etag text,
  add column if not exists http_last_modified text;

create index if not exists bookings_ical_reconciliation
  on public.bookings (ical_source_id, status, checkin_date)
  where source = 'ical';

comment on column public.bookings.ical_missing_since is
  'First successful iCal sync where this UID was absent; absence alone is not cancellation proof.';
comment on column public.bookings.ical_missing_count is
  'Consecutive successful iCal syncs where this UID was absent.';
comment on column public.bookings.ical_cancel_reason is
  'iCal cancellation evidence: explicit STATUS:CANCELLED or confirmed disappearance after grace.';
