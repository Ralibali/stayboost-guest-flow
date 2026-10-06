-- Preserve existing nightly child prices and opt-in state. No source ages or prices are inferred.
alter table public.units
  add column child_price_basis text not null default 'per_night' check(child_price_basis in ('per_night','per_booking')),
  add column child_price_per_booking integer not null default 0 check(child_price_per_booking between 0 and 1000000);
comment on column public.units.child_price_per_night is 'Gross SEK per chargeable child per night, used only when child_price_basis=per_night.';
comment on column public.units.child_price_per_booking is 'Gross SEK per chargeable child once per booking, used only when child_price_basis=per_booking. Existing nightly amount is not reinterpreted.';

-- Explicit classification only; existing catalog rows remain ordinary extras.
alter table public.addons add column pricing_role text not null default 'extra'
  check(pricing_role in ('extra','manual_child_price'));
comment on column public.addons.pricing_role is 'Manual child-price items cannot be bought on a party-priced reservation. No classification is inferred from catalog text.';

-- The catalog CAS RPC delegates basic fields here. Old callers that omit the new
-- role retain its current value; the existing revision trigger covers changes.
create or replace function public.save_addon_with_units(p_property uuid,p_addon uuid,p_data jsonb,p_unit_ids uuid[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare saved uuid; selected_count integer;
begin
  if auth.uid() is null or not public.owns_property(p_property) then
    raise exception 'addon_property_forbidden' using errcode='42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_data) k where k not in
    ('name','description','price','price_type','fulfillment_type','image_url','internal_only',
     'available_from','available_to','max_quantity','active','sort_order','pricing_role')
  ) or length(trim(coalesce(p_data->>'name',''))) not between 1 and 2000
    or coalesce(p_data->>'price','') !~ '^[0-9]{1,7}$'
    or (p_data->>'price')::integer > 1000000 then
    raise exception 'invalid_addon_data';
  end if;
  if p_data ? 'pricing_role' and (jsonb_typeof(p_data->'pricing_role') is distinct from 'string' or
      p_data->>'pricing_role' not in ('extra','manual_child_price')) then raise exception 'invalid_addon_pricing_role'; end if;
  if p_unit_ids is not null then
    if coalesce(array_ndims(p_unit_ids),1)<>1 or cardinality(p_unit_ids) not between 1 and 1000
      or array_position(p_unit_ids,null) is not null
      or (select count(distinct id) from unnest(p_unit_ids) id)<>cardinality(p_unit_ids) then
      raise exception 'invalid_addon_units';
    end if;
    perform id from public.units where property_id=p_property and id=any(p_unit_ids) order by id for key share;
    get diagnostics selected_count=row_count;
    if selected_count<>cardinality(p_unit_ids) then raise exception 'invalid_addon_units'; end if;
  end if;
  if p_addon is null then
    insert into public.addons(property_id,name,description,price,price_type,fulfillment_type,image_url,
      internal_only,available_from,available_to,max_quantity,active,sort_order,unit_scope,pricing_role)
    values(p_property,trim(p_data->>'name'),nullif(p_data->>'description',''),(p_data->>'price')::integer,
      coalesce(p_data->>'price_type','per_booking'),coalesce(p_data->>'fulfillment_type','arrival'),
      nullif(p_data->>'image_url',''),coalesce((p_data->>'internal_only')::boolean,false),
      nullif(p_data->>'available_from','')::date,nullif(p_data->>'available_to','')::date,
      coalesce((p_data->>'max_quantity')::integer,20),coalesce((p_data->>'active')::boolean,true),
      coalesce((p_data->>'sort_order')::integer,0),case when p_unit_ids is null then 'all' else 'selected' end,
      coalesce(p_data->>'pricing_role','extra'))
    returning id into saved;
  else
    update public.addons a set name=trim(p_data->>'name'),description=nullif(p_data->>'description',''),
      price=(p_data->>'price')::integer,price_type=coalesce(p_data->>'price_type','per_booking'),
      fulfillment_type=coalesce(p_data->>'fulfillment_type','arrival'),image_url=nullif(p_data->>'image_url',''),
      internal_only=coalesce((p_data->>'internal_only')::boolean,false),
      available_from=nullif(p_data->>'available_from','')::date,available_to=nullif(p_data->>'available_to','')::date,
      max_quantity=coalesce((p_data->>'max_quantity')::integer,20),
      active=coalesce((p_data->>'active')::boolean,a.active),sort_order=coalesce((p_data->>'sort_order')::integer,a.sort_order),
      unit_scope=case when p_unit_ids is null then 'all' else 'selected' end,
      pricing_role=coalesce(p_data->>'pricing_role',a.pricing_role)
    where a.id=p_addon and a.property_id=p_property returning a.id into saved;
    if saved is null then raise exception 'addon_property_forbidden' using errcode='42501'; end if;
  end if;
  delete from public.addon_units where addon_id=saved;
  if p_unit_ids is not null then
    insert into public.addon_units(property_id,addon_id,unit_id)
      select p_property,saved,id from unnest(p_unit_ids) id;
  end if;
  return saved;
end $$;
revoke all on function public.save_addon_with_units(uuid,uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.save_addon_with_units(uuid,uuid,jsonb,uuid[]) to authenticated;

-- Final purchase defense, including a stale API catalog or direct service write.
-- The immutable quote records which pricing model the guest actually bought.
create function public.validate_booking_addon_party_price() returns trigger
language plpgsql security invoker set search_path='' as $$
declare b public.bookings; role_value text; current_party boolean; quoted_party boolean;
begin
  if tg_op='UPDATE' and row(new.booking_id,new.addon_id) is not distinct from row(old.booking_id,old.addon_id) then return new; end if;
  select * into b from public.bookings where id=new.booking_id for share;
  if not found then raise exception 'addon_booking_not_found'; end if;
  select pricing_role into role_value from public.addons where id=new.addon_id and property_id=b.property_id for share;
  if not found then raise exception 'addon_unit_not_allowed'; end if;
  select party_pricing_enabled into current_party from public.units where id=b.unit_id and property_id=b.property_id;
  quoted_party:=case when jsonb_typeof(b.quote_snapshot->'partyPricingEnabled')='boolean'
    then (b.quote_snapshot->>'partyPricingEnabled')::boolean else coalesce(current_party,false) end;
  if role_value='manual_child_price' and quoted_party then raise exception 'manual_child_price_already_included'; end if;
  return new;
end $$;
revoke all on function public.validate_booking_addon_party_price() from public,anon,authenticated;
create trigger booking_addons_party_price before insert or update on public.booking_addons
  for each row execute function public.validate_booking_addon_party_price();
