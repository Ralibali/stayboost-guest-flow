-- Catalogue metadata only: the existing prices remain gross SEK amounts.
-- NULL VAT means unknown; neither zero VAT nor historical tax is inferred.
alter table public.addons
  add column content_translations jsonb not null default '{}'::jsonb
    check(public.valid_unit_translations(content_translations)),
  add column vat_rate integer check(vat_rate is null or vat_rate in (0,12,25)),
  add column catalog_revision integer not null default 1 check(catalog_revision>0);
comment on column public.addons.vat_rate is 'Included VAT metadata, 0/12/25 percent; NULL is unknown. Does not change the gross price.';

-- Even older clients and direct owner edits advance the revision. Restriction
-- links participate too, so a stale form cannot restore a removed/added unit.
create function public.advance_addon_catalog_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.catalog_revision:=case when tg_op='INSERT' then 1 else old.catalog_revision+1 end;
  return new;
end $$;
revoke all on function public.advance_addon_catalog_revision() from public,anon,authenticated;
create trigger addons_catalog_revision before insert or update on public.addons
  for each row execute function public.advance_addon_catalog_revision();

create function public.touch_addon_catalog_for_unit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  -- The row lock serializes relation changes with both catalog save RPCs.
  -- Service-role relation updates touch both affected catalogs in stable order.
  for target in select id from public.addons
    where id=any(case tg_op when 'INSERT' then array[new.addon_id]
      when 'DELETE' then array[old.addon_id] else array[old.addon_id,new.addon_id] end)
    order by id for update loop
    update public.addons set catalog_revision=catalog_revision where id=target;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.touch_addon_catalog_for_unit() from public,anon,authenticated;
create trigger addon_units_catalog_revision before insert or update or delete on public.addon_units
  for each row execute function public.touch_addon_catalog_for_unit();

-- Align the primary name limit with translated names; all legacy save behavior
-- is otherwise unchanged and new content/VAT fields are preserved.
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
     'available_from','available_to','max_quantity','active','sort_order')
  ) or length(trim(coalesce(p_data->>'name',''))) not between 1 and 2000
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

-- Legacy save_addon_with_units is retained and continues to preserve these new
-- fields. The new editor uses a revision guarded save for all catalog fields.
create function public.save_addon_catalog(
  p_property uuid,p_addon uuid,p_original jsonb,p_data jsonb,p_unit_ids uuid[]
) returns uuid language plpgsql security invoker set search_path='' as $$
declare current_revision integer; saved uuid;
begin
  if auth.uid() is null or not public.owns_property(p_property) then
    raise exception 'addon_property_forbidden' using errcode='42501';
  end if;
  if p_addon is null then
    if p_original is not null then raise exception 'invalid_addon_original'; end if;
  else
    if jsonb_typeof(p_original) is distinct from 'object'
      or not (p_original ? 'revision')
      or exists(select 1 from jsonb_object_keys(p_original) k where k<>'revision')
      or jsonb_typeof(p_original->'revision')<>'number'
      or (p_original->>'revision') !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'invalid_addon_original';
    end if;
    select catalog_revision into current_revision from public.addons
      where id=p_addon and property_id=p_property for update;
    if not found then raise exception 'addon_property_forbidden' using errcode='42501'; end if;
    if current_revision::numeric is distinct from (p_original->>'revision')::numeric then
      raise exception 'addon_catalog_conflict';
    end if;
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
    or not (p_data ?& array['name','description','content_translations','vat_rate'])
    or jsonb_typeof(p_data->'name')<>'string'
    or (p_data->>'name') !~ '[^[:space:]]' or length(p_data->>'name')>2000
    or jsonb_typeof(p_data->'description') not in ('string','null')
    or length(p_data->>'description')>100000
    or not public.valid_unit_translations(p_data->'content_translations')
    or (p_data->'vat_rate'<>'null'::jsonb and
      (jsonb_typeof(p_data->'vat_rate')<>'number' or (p_data->>'vat_rate')::numeric not in (0,12,25))) then
    raise exception 'invalid_addon_content';
  end if;
  if p_data->'content_translations' ? 'sv' and
    (p_data->>'name' is distinct from p_data#>>'{content_translations,sv,name}' or
     p_data->>'description' is distinct from p_data#>>'{content_translations,sv,description}') then
    raise exception 'addon_swedish_mirror_mismatch';
  end if;
  -- Reuse the existing atomic catalog/unit ownership validation. The exact text
  -- is restored below in the same transaction, including intentional whitespace.
  saved:=public.save_addon_with_units(p_property,p_addon,p_data-array['content_translations','vat_rate'],p_unit_ids);
  update public.addons set name=p_data->>'name',description=p_data->>'description',
    content_translations=p_data->'content_translations',vat_rate=(p_data->>'vat_rate')::numeric::integer
    where id=saved and property_id=p_property;
  return saved;
end $$;
revoke all on function public.save_addon_catalog(uuid,uuid,jsonb,jsonb,uuid[]) from public,anon;
grant execute on function public.save_addon_catalog(uuid,uuid,jsonb,jsonb,uuid[]) to authenticated;

-- Freeze the information the guest actually bought. A direct-booking quote is
-- authoritative even when the catalog changes before booking_addons is inserted.
-- Existing operations are never rewritten or assigned inferred historical VAT.
create or replace function public.snapshot_stay_addon() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  b public.bookings; a public.addons; line jsonb; line_count integer;
  frozen_name text; frozen_description text; translations jsonb; vat integer; tax_inclusive boolean;
  price_kind text; fulfillment text; d date; day_index integer; v_key text;
begin
  if tg_op='UPDATE' then
    if row(old.quantity,old.unit_price,old.addon_id,old.booking_id) is distinct from
      row(new.quantity,new.unit_price,new.addon_id,new.booking_id) then
      raise exception 'Ett registrerat tillval kan inte skrivas över. Hantera ändringen separat med gästen.';
    end if;
    return new;
  end if;
  select * into b from public.bookings where id=new.booking_id;
  select * into a from public.addons where id=new.addon_id and property_id=b.property_id;
  if not found then raise exception 'Tillvalet tillhör inte bokningens anläggning'; end if;
  if b.quote_snapshot ? 'addons' then
    if jsonb_typeof(b.quote_snapshot->'addons')<>'array' then raise exception 'invalid_addon_quote'; end if;
    select count(*),jsonb_agg(value)->0 into line_count,line
      from jsonb_array_elements(b.quote_snapshot->'addons') where value->>'id'=new.addon_id::text;
    if line_count<>1 or not (line ?& array['id','name','quantity','unitPrice'])
      or jsonb_typeof(line->'name') is distinct from 'string' or (line->>'name') !~ '[^[:space:]]'
      or length(line->>'name')>2000
      or jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric is distinct from new.quantity::numeric
      or jsonb_typeof(line->'unitPrice') is distinct from 'number' or (line->>'unitPrice')::numeric is distinct from new.unit_price::numeric then
      raise exception 'invalid_addon_quote';
    end if;
    frozen_name:=line->>'name';
    fulfillment:=coalesce(line->>'fulfillmentType','arrival');
    price_kind:=line->>'priceType';
    translations:='{}'; vat:=null; tax_inclusive:=null; frozen_description:=null;
    if line ?| array['contentTranslations','vatRate','taxInclusive','description'] then
      if not (line ?& array['contentTranslations','vatRate','taxInclusive','description','priceType','fulfillmentType'])
        or jsonb_typeof(line->'priceType') is distinct from 'string'
        or jsonb_typeof(line->'fulfillmentType') is distinct from 'string'
        or not public.valid_unit_translations(line->'contentTranslations')
        or jsonb_typeof(line->'description') not in ('string','null')
        or length(line->>'description')>100000
        or (line->'vatRate'<>'null'::jsonb and
          (jsonb_typeof(line->'vatRate')<>'number' or (line->>'vatRate')::numeric not in (0,12,25))) then
        raise exception 'invalid_addon_quote';
      end if;
      translations:=line->'contentTranslations'; vat:=(line->>'vatRate')::numeric::integer;
      tax_inclusive:=case when vat is null then null else true end;
      if line->'taxInclusive' is distinct from coalesce(to_jsonb(tax_inclusive),'null'::jsonb) then
        raise exception 'invalid_addon_quote';
      end if;
      frozen_description:=line->>'description';
    end if;
    if fulfillment not in ('arrival','each_morning','departure') or
      (price_kind is not null and price_kind not in ('per_booking','per_night')) or
      (fulfillment='each_morning' and price_kind is not null and price_kind<>'per_night') then
      raise exception 'invalid_addon_quote';
    end if;
  else
    -- Service-created purchases without a prior quote freeze the catalog at the
    -- time the purchase is recorded; future catalog edits cannot change it.
    frozen_name:=a.name; frozen_description:=a.description; translations:=a.content_translations;
    vat:=a.vat_rate; tax_inclusive:=case when vat is null then null else true end;
    price_kind:=a.price_type; fulfillment:=a.fulfillment_type;
  end if;
  for day_index in select generate_series(case when fulfillment='each_morning' then 1 else 0 end,
    case when fulfillment='each_morning' then b.checkout_date-b.checkin_date else 0 end) loop
    d:=case fulfillment when 'departure' then b.checkout_date when 'each_morning' then b.checkin_date+day_index else b.checkin_date end;
    v_key:=new.addon_id::text||case when fulfillment='each_morning' then ':'||d::text else '' end;
    insert into public.stay_operations(property_id,booking_id,kind,item_key,title,details,due_date)
    values(b.property_id,b.id,'addon',v_key,frozen_name,jsonb_build_object(
      'addon_id',a.id,'quantity',new.quantity,'unit_price',new.unit_price,'price_type',price_kind,
      'description',frozen_description,'content_translations',translations,'vat_rate',vat,'tax_inclusive',tax_inclusive,
      'fulfillment_type',fulfillment,'delivery_day_index',day_index,'name_source','purchase',
      'purchase_checkin_date',b.checkin_date,'purchase_checkout_date',b.checkout_date,'purchase_unit_id',b.unit_id,
      'nights',b.checkout_date-b.checkin_date,'checkin_date',b.checkin_date,'checkout_date',b.checkout_date,'unit_id',b.unit_id),d)
    on conflict(booking_id,kind,item_key) do nothing;
  end loop;
  return new;
end $$;
revoke all on function public.snapshot_stay_addon() from public,anon,authenticated;
