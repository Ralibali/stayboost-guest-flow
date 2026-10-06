-- Existing add-ons remain available on all units. Selected scope with no links
-- is deliberately unavailable, including after the last linked unit is deleted.
alter table public.addons add column unit_scope text not null default 'all'
  check (unit_scope in ('all','selected'));
alter table public.addons add constraint addons_id_property_key unique(id,property_id);
alter table public.units add constraint units_id_property_key unique(id,property_id);

create table public.addon_units (
  property_id uuid not null references public.properties(id) on delete cascade,
  addon_id uuid not null,
  unit_id uuid not null,
  primary key(addon_id,unit_id),
  foreign key(addon_id,property_id) references public.addons(id,property_id) on delete cascade,
  foreign key(unit_id,property_id) references public.units(id,property_id) on delete cascade
);
create index addon_units_unit_property_idx on public.addon_units(unit_id,property_id);
create index addon_units_property_idx on public.addon_units(property_id);
alter table public.addon_units enable row level security;
grant select,insert,delete on public.addon_units to authenticated;
grant all on public.addon_units to service_role;
create policy "owners manage addon units" on public.addon_units for all to authenticated
  using (public.owns_property(property_id)) with check (public.owns_property(property_id));

-- Save the catalog row and its unit selection in one transaction. In particular,
-- a new restricted add-on must never briefly appear as an unrestricted product.
create function public.save_addon_with_units(p_property uuid,p_addon uuid,p_data jsonb,p_unit_ids uuid[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare saved uuid; selected_count integer;
begin
  if auth.uid() is null or not public.owns_property(p_property) then
    raise exception 'addon_property_forbidden' using errcode='42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_data) k where k not in
    ('name','description','price','price_type','fulfillment_type','image_url','internal_only',
     'available_from','available_to','max_quantity','active','sort_order')
  ) or length(trim(coalesce(p_data->>'name',''))) not between 1 and 500
    or coalesce(p_data->>'price','') !~ '^[0-9]{1,7}$'
    or (p_data->>'price')::integer > 1000000 then
    raise exception 'invalid_addon_data';
  end if;
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
      internal_only,available_from,available_to,max_quantity,active,sort_order,unit_scope)
    values(p_property,trim(p_data->>'name'),nullif(p_data->>'description',''),(p_data->>'price')::integer,
      coalesce(p_data->>'price_type','per_booking'),coalesce(p_data->>'fulfillment_type','arrival'),
      nullif(p_data->>'image_url',''),coalesce((p_data->>'internal_only')::boolean,false),
      nullif(p_data->>'available_from','')::date,nullif(p_data->>'available_to','')::date,
      coalesce((p_data->>'max_quantity')::integer,20),coalesce((p_data->>'active')::boolean,true),
      coalesce((p_data->>'sort_order')::integer,0),case when p_unit_ids is null then 'all' else 'selected' end)
    returning id into saved;
  else
    update public.addons a set name=trim(p_data->>'name'),description=nullif(p_data->>'description',''),
      price=(p_data->>'price')::integer,price_type=coalesce(p_data->>'price_type','per_booking'),
      fulfillment_type=coalesce(p_data->>'fulfillment_type','arrival'),image_url=nullif(p_data->>'image_url',''),
      internal_only=coalesce((p_data->>'internal_only')::boolean,false),
      available_from=nullif(p_data->>'available_from','')::date,available_to=nullif(p_data->>'available_to','')::date,
      max_quantity=coalesce((p_data->>'max_quantity')::integer,20),
      active=coalesce((p_data->>'active')::boolean,a.active),sort_order=coalesce((p_data->>'sort_order')::integer,a.sort_order),
      unit_scope=case when p_unit_ids is null then 'all' else 'selected' end
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

-- Defense in depth for service/API writes, including a stale offer whose scope
-- changed between quote creation and recording the purchase.
create function public.validate_booking_addon_unit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare booking_property uuid; booking_unit uuid;
begin
  if tg_op='UPDATE' and row(new.booking_id,new.addon_id) is not distinct from row(old.booking_id,old.addon_id) then
    return new; -- Historical purchases do not change with the current catalog.
  end if;
  select property_id,unit_id into booking_property,booking_unit from public.bookings where id=new.booking_id for share;
  if not found or not exists (
    select 1 from public.addons a where a.id=new.addon_id and a.property_id=booking_property
      and (a.unit_scope='all' or exists(select 1 from public.addon_units au
        where au.addon_id=a.id and au.property_id=booking_property and au.unit_id=booking_unit))
  ) then raise exception 'addon_unit_not_allowed'; end if;
  return new;
end $$;
revoke all on function public.validate_booking_addon_unit() from public,anon,authenticated;
create trigger booking_addons_unit_scope before insert or update on public.booking_addons
  for each row execute function public.validate_booking_addon_unit();

-- Moving an existing reservation must not carry a restricted purchase into a
-- unit where it cannot be fulfilled. Date/status changes are unaffected.
create function public.validate_booking_unit_addons() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if row(new.unit_id,new.property_id) is not distinct from row(old.unit_id,old.property_id) then return new; end if;
  if exists (select 1 from public.booking_addons ba join public.addons a on a.id=ba.addon_id
    where ba.booking_id=new.id and (a.property_id<>new.property_id or
      (a.unit_scope='selected' and not exists(select 1 from public.addon_units au
        where au.addon_id=a.id and au.property_id=new.property_id and au.unit_id=new.unit_id)))) then
    raise exception 'booking_addon_unit_not_allowed';
  end if;
  return new;
end $$;
revoke all on function public.validate_booking_unit_addons() from public,anon,authenticated;
create trigger bookings_addon_unit_scope before update of unit_id,property_id on public.bookings
  for each row execute function public.validate_booking_unit_addons();
