-- Explicit opt-in occupancy pricing; existing flat-rate units remain unchanged.
create or replace function public.valid_price_array(prices integer[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select prices is not null and coalesce(array_ndims(prices),1)=1
    and (coalesce(cardinality(prices),0)=0 or array_lower(prices,1)=1)
    and coalesce(cardinality(prices),0) between 0 and 20
    and not exists(select 1 from unnest(prices) p where p is null or p<0 or p>1000000)
$$;
revoke all on function public.valid_price_array(integer[]) from public,anon;
grant execute on function public.valid_price_array(integer[]) to authenticated,service_role;
alter table public.units
  add column party_pricing_enabled boolean not null default false,
  add column adult_prices integer[] not null default '{}',
  add column child_price_per_night integer not null default 0 check(child_price_per_night between 0 and 1000000),
  add column child_free_through_age integer not null default 3 check(child_free_through_age between 0 and 17),
  add column child_max_age integer not null default 12 check(child_max_age between 0 and 17),
  add constraint units_party_prices check(public.valid_price_array(adult_prices) and
    (not party_pricing_enabled or coalesce(array_length(adult_prices,1),0)>=max_guests) and child_free_through_age<=child_max_age);
alter table public.rate_rules add column adult_prices integer[],
  add constraint rate_rule_adult_prices check(adult_prices is null or
    (kind='price_override' and public.valid_price_array(adult_prices) and cardinality(adult_prices)>0));
-- The original rule constraint required a flat amount even for an adult-only table.
alter table public.rate_rules drop constraint rate_rules_check1;
alter table public.rate_rules add constraint rate_rules_values_required check (
  (kind='price_override' and (fixed_price is not null or coalesce(cardinality(adult_prices),0)>0)) or
  (kind='price_multiplier' and pct_delta is not null) or
  (kind='min_stay' and min_stay is not null) or
  (kind in ('closed','no_arrival','no_departure'))
);
alter table public.bookings add column adults integer check(adults between 1 and 20),
  add column children_ages integer[] not null default '{}', add column quote_snapshot jsonb;
create or replace function public.protect_booking_quote()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')='authenticated' then
    if (tg_op='INSERT' and (new.adults is not null or cardinality(new.children_ages)>0 or new.quote_snapshot is not null))
       or (tg_op='UPDATE' and row(new.adults,new.children_ages,new.quote_snapshot) is distinct from row(old.adults,old.children_ages,old.quote_snapshot)) then
      raise exception 'booking_quote_server_only' using errcode='42501';
    end if;
  end if;
  if coalesce(array_ndims(new.children_ages),1)<>1 or cardinality(new.children_ages)>19 or exists(select 1 from unnest(new.children_ages) age where age is null or age<0 or age>17) then raise exception 'invalid_children_ages'; end if;
  if new.adults is not null and new.guests is distinct from new.adults+cardinality(new.children_ages) then raise exception 'invalid_party_total'; end if;
  return new;
end $$;
revoke all on function public.protect_booking_quote() from public,anon,authenticated;
create trigger bookings_protect_quote before insert or update on public.bookings for each row execute function public.protect_booking_quote();
