-- StayBoost BP-1: canonical inventory write lock.
--
-- Every inventory-affecting booking write now enters the same transactional
-- unit lock, regardless of whether it came from the public booking engine,
-- the owner UI, iCal or Sirvoy.
--
-- Managed inventory (manual/direct) is never allowed to overlap another
-- confirmed booking. External sources (iCal/Sirvoy) are still allowed to
-- mirror a real conflict from the outside world so StayBoost does not hide
-- source truth; those overlaps remain visible to the operator and keep the
-- affected dates blocked for new managed bookings.
--
-- This intentionally does NOT introduce a blanket exclusion constraint:
-- the existing data model permits duplicate/overlapping external source rows
-- during reconciliation and channel-manager transition.

create or replace function public.prevent_managed_booking_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Rows without a mapped unit cannot participate in a per-unit lock.
  -- Cancelled rows release inventory and therefore do not need serialization.
  if new.unit_id is null or new.status <> 'confirmed' then
    return new;
  end if;

  -- Canonical write lock: every confirmed inventory write for a mapped unit
  -- serializes here before any source-specific conflict decision is made.
  perform pg_advisory_xact_lock(hashtextextended(new.unit_id::text, 0));

  -- StayBoost-controlled writes must never create a second confirmed stay.
  -- External writes deliberately remain representable: if a channel sends a
  -- booking that conflicts with an already-sold stay, hiding that reservation
  -- would be less safe than recording the conflict and blocking inventory.
  if new.source in ('manual', 'direct') and exists (
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

comment on function public.prevent_managed_booking_overlap() is
  'Canonical per-unit booking write lock. Serializes all confirmed mapped inventory writes; rejects overlaps created by manual/direct writes while preserving external-source conflicts for reconciliation.';

-- Recreate defensively so environments that missed the earlier trigger still
-- receive the guard when this migration is applied.
drop trigger if exists bookings_prevent_managed_overlap on public.bookings;
create trigger bookings_prevent_managed_overlap
  before insert or update of unit_id, checkin_date, checkout_date, status, source
  on public.bookings
  for each row execute function public.prevent_managed_booking_overlap();
