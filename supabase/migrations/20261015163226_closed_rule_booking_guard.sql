-- Serialize closure changes with the same inventory lock as booking admission.
-- This is additive: payment, iCal freshness, source truth and overlap guards stay intact.
create function public.lock_closed_rule_inventory()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_property uuid;
begin
  for v_property in
    select distinct id from unnest(case
      when tg_op = 'INSERT' then case when new.kind = 'closed' then array[new.property_id] else array[]::uuid[] end
      when tg_op = 'DELETE' then case when old.kind = 'closed' then array[old.property_id] else array[]::uuid[] end
      else array[case when old.kind = 'closed' then old.property_id end,
                 case when new.kind = 'closed' then new.property_id end]
    end) id where id is not null order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended('property-inventory:' || v_property::text, 0));
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
-- Alphabetically after rate_rules_ical_fence: an unauthorized calendar-rule edit
-- must fail before waiting for the inventory lock owned by its source sync.
create trigger rate_rules_inventory_lock before insert or update or delete
  on public.rate_rules for each row execute function public.lock_closed_rule_inventory();

create function public.require_open_dates_for_direct_booking()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.source <> 'direct' or new.status <> 'confirmed' or new.unit_id is null then return new; end if;
  -- A held stay can still be paid or cancelled after a closure is added.
  -- Only newly admitted inventory (including moves/reopening) is rechecked.
  if tg_op = 'UPDATE' and row(new.property_id,new.unit_id,new.checkin_date,new.checkout_date,new.status,new.source)
    is not distinct from row(old.property_id,old.unit_id,old.checkin_date,old.checkout_date,old.status,old.source)
  then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('property-inventory:' || new.property_id::text, 0));
  -- A separate read after the lock sees a closure committed while this write
  -- was waiting. No rule row locks: the inventory lock is the shared boundary.
  if exists (
    select 1 from public.rate_rules r
    where r.property_id = new.property_id and (r.unit_id is null or r.unit_id = new.unit_id)
      and r.active and r.kind = 'closed'
      and r.date_from < new.checkout_date and r.date_to >= new.checkin_date
  ) then raise exception 'booking_closed' using errcode = 'P0001'; end if;
  return new;
end;
$$;
create trigger bookings_closed_rule_guard
  before insert or update of property_id,unit_id,checkin_date,checkout_date,status,source
  on public.bookings for each row execute function public.require_open_dates_for_direct_booking();

revoke all on function public.lock_closed_rule_inventory() from public,anon,authenticated;
revoke all on function public.require_open_dates_for_direct_booking() from public,anon,authenticated;
