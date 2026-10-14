-- New feeds are deliberately staged before their first import. Existing feeds
-- retain their state; no job, reservation or payment is changed by this migration.
alter table public.ical_sources alter column paused set default true;

create or replace function public.guard_ical_source_inventory()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_property uuid;
begin
  -- Same lock as managed bookings. Do not row-lock sources from the booking
  -- trigger: a sync already holds its source row while publishing its result.
  for v_property in
    select distinct id from unnest(case when tg_op = 'INSERT' then array[new.property_id]
      when tg_op = 'DELETE' then array[old.property_id]
      else array[old.property_id,new.property_id] end) id order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended('property-inventory:' || v_property::text, 0));
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  if not exists (select 1 from public.units u where u.id=new.unit_id and u.property_id=new.property_id) then
    raise exception 'ical_unit_property_mismatch' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' and (
    row(new.property_id,new.unit_id,new.url,new.channel_type) is distinct from
    row(old.property_id,old.unit_id,old.url,old.channel_type)
    or (old.paused and not new.paused)
  ) then
    -- A new feed identity or resumed feed must be fetched successfully again.
    new.last_success_at := null;
    new.last_attempt_at := null;
    new.last_synced_at := null;
    new.last_status := null;
    new.consecutive_failures := 0;
    new.http_etag := null;
    new.http_last_modified := null;
  end if;
  return new;
end;
$$;
create trigger ical_sources_guard_inventory before insert or update or delete
  on public.ical_sources for each row execute function public.guard_ical_source_inventory();

create or replace function public.require_fresh_ical_for_direct_booking()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_now timestamptz;
begin
  -- Payment completion and other changes to an existing hold must remain possible
  -- when a calendar subsequently goes stale. Reopening/moving a hold is new inventory.
  if new.source <> 'direct' or new.status <> 'confirmed' or new.unit_id is null then return new; end if;
  if tg_op = 'UPDATE' and row(new.property_id,new.unit_id,new.checkin_date,new.checkout_date,new.status,new.source)
    is not distinct from row(old.property_id,old.unit_id,old.checkin_date,old.checkout_date,old.status,old.source)
  then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('property-inventory:' || new.property_id::text, 0));
  v_now := clock_timestamp();
  if exists (
    select 1 from public.ical_sources s
    where s.property_id=new.property_id and s.unit_id=new.unit_id
      and (s.paused or s.consecutive_failures <> 0 or s.last_success_at is null
        or not isfinite(s.last_success_at) or s.last_success_at > v_now
        or s.last_success_at < v_now - interval '20 minutes')
  ) then raise exception 'ical_sync_required' using errcode='P0001'; end if;
  return new;
end;
$$;
create trigger bookings_ical_freshness
  before insert or update of property_id,unit_id,checkin_date,checkout_date,status,source
  on public.bookings for each row execute function public.require_fresh_ical_for_direct_booking();

revoke all on function public.guard_ical_source_inventory() from public,anon,authenticated;
revoke all on function public.require_fresh_ical_for_direct_booking() from public,anon,authenticated;
