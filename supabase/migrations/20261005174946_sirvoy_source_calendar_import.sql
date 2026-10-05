-- Future calendar inventory from verified, immutable source rows. Documentary
-- prices never enter the legacy whole-krona payment contract.
alter table public.sirvoy_source_records add constraint sirvoy_source_record_property_identity unique(id,property_id);
alter table public.bookings
  add column source_accommodation_record_id uuid,
  add column source_booking_record_id uuid,
  add constraint bookings_source_pair check((source_accommodation_record_id is null)=(source_booking_record_id is null)),
  add constraint bookings_source_accommodation_fk foreign key(source_accommodation_record_id,property_id)
    references public.sirvoy_source_records(id,property_id) deferrable initially deferred,
  add constraint bookings_source_booking_fk foreign key(source_booking_record_id,property_id)
    references public.sirvoy_source_records(id,property_id) deferrable initially deferred,
  add constraint bookings_source_accommodation_unique unique(property_id,source_accommodation_record_id);
create index bookings_source_booking_index on public.bookings(source_booking_record_id) where source_booking_record_id is not null;

create function public.sirvoy_source_field(p_fields jsonb,p_headers jsonb,p_name text)
returns text language sql immutable strict security invoker set search_path='' as $$
  select p_fields->>(select ord::integer-1 from jsonb_array_elements_text(p_headers) with ordinality h(name,ord) where name=p_name limit 1)
$$;
revoke all on function public.sirvoy_source_field(jsonb,jsonb,text) from public,anon;
grant execute on function public.sirvoy_source_field(jsonb,jsonb,text) to authenticated,service_role;

create function public.protect_source_calendar_booking()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and old.source_accommodation_record_id is not null and
    row(new.source_accommodation_record_id,new.source_booking_record_id,new.property_id,new.external_id,new.source)
    is distinct from row(old.source_accommodation_record_id,old.source_booking_record_id,old.property_id,old.external_id,old.source)
    then raise exception 'source_calendar_origin_immutable' using errcode='42501'; end if;
  if new.source_accommodation_record_id is null then return new; end if;
  if (current_user='authenticated' or coalesce(current_setting('request.jwt.claim.role',true),'')='authenticated')
    and (tg_op='INSERT' or old.source_accommodation_record_id is null) then
    raise exception 'source_calendar_server_only' using errcode='42501';
  end if;
  if new.source<>'manual' or new.external_id is null or new.external_id not like 'sirvoy-csv:%'
    or new.payment_method<>'none' or new.payment_status<>'none' or new.payment_amount is not null
    or new.payment_ref is not null or new.payment_expires_at is not null or new.payment_paid_at is not null
    or new.payment_refund_requested_at is not null or new.payment_refunded_at is not null or new.payment_expired_at is not null
    or new.stripe_session_id is not null or new.stripe_payment_intent_id is not null or new.stripe_refund_id is not null
    or new.communications_enabled then
    raise exception 'source_calendar_payment_unverified' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_source_calendar_booking() from public,anon,authenticated;
create trigger bookings_source_calendar_guard before insert or update on public.bookings
for each row execute function public.protect_source_calendar_booking();

create view public.sirvoy_calendar_documentary_values with(security_invoker=true) as
select b.id as booking_id,b.property_id,b.source_accommodation_record_id,b.source_booking_record_id,
  a.amount_decimal as accommodation_amount,c.amount_decimal as booking_total,
  public.sirvoy_source_field(c.fields,ci.headers,'Paid') as booking_paid_raw,
  a.booking_ref as source_booking_ref,a.room_ref as source_room_ref,
  ai.archive_id as accommodation_archive_id,ci.archive_id as booking_archive_id,
  aa.filename as accommodation_filename,ca.filename as booking_filename,
  a.source_row as accommodation_row,c.source_row as booking_row,null::text as currency
from public.bookings b join public.sirvoy_source_records a on a.id=b.source_accommodation_record_id and a.property_id=b.property_id
  join public.sirvoy_source_records c on c.id=b.source_booking_record_id and c.property_id=b.property_id
  join public.sirvoy_source_imports ai on ai.id=a.import_id join public.sirvoy_source_imports ci on ci.id=c.import_id
  join public.sirvoy_export_archives aa on aa.id=ai.archive_id join public.sirvoy_export_archives ca on ca.id=ci.archive_id;
revoke all on public.sirvoy_calendar_documentary_values from public,anon,authenticated,service_role;
grant select on public.sirvoy_calendar_documentary_values to authenticated,service_role;

create function public.import_sirvoy_source_calendar(p_actor uuid,p_property uuid,p_pairs jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  pair jsonb; a public.sirvoy_source_records%rowtype; c public.sirvoy_source_records%rowtype;
  ai public.sirvoy_source_imports%rowtype; ci public.sirvoy_source_imports%rowtype;
  aa public.sirvoy_export_archives%rowtype; ca public.sirvoy_export_archives%rowtype;
  existing public.bookings%rowtype; unit public.units%rowtype;
  plan jsonb:='[]'; item jsonb; bid uuid; eid text; guest_count integer;
  first_day date; last_day date; room_count integer; total_guests integer; documented_total numeric;
  max_nights integer; imported integer:=0; skipped integer:=0; booking_ids jsonb:='[]'; today date:=(now() at time zone 'Europe/Stockholm')::date;
begin
  if not exists(select 1 from public.properties where id=p_property and owner_id=p_actor) then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_pairs is null or jsonb_typeof(p_pairs)<>'array' or jsonb_array_length(p_pairs) not between 1 and 50 then raise exception 'invalid_source_pairs'; end if;
  if exists(select 1 from jsonb_array_elements(p_pairs) r where jsonb_typeof(r)<>'object'
      or coalesce(r->>'accommodationRecordId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(r->>'bookingRecordId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (select count(distinct r->>'accommodationRecordId') from jsonb_array_elements(p_pairs) r)<>jsonb_array_length(p_pairs)
    then raise exception 'invalid_source_pairs'; end if;
  -- Lock owner/configuration first. NO KEY UPDATE permits the foreign-key
  -- KEY SHARE locks of concurrent checkout while both serialize on unit locks.
  select max_stay into max_nights from public.properties where id=p_property and owner_id=p_actor for no key update;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  for pair in select value from jsonb_array_elements(p_pairs) loop
    select * into a from public.sirvoy_source_records where id=(pair->>'accommodationRecordId')::uuid and property_id=p_property;
    if not found then raise exception 'source_record_mismatch'; end if;
    select * into c from public.sirvoy_source_records where id=(pair->>'bookingRecordId')::uuid and property_id=p_property;
    if not found or a.record_kind<>'ACCOMM' or c.record_kind<>'BOOKING' or a.booking_ref<>c.booking_ref
      or a.booking_ref!~'^[A-Za-z0-9_-]+$' or a.room_ref is null or a.room_ref not in('1','2','3') then raise exception 'source_record_mismatch'; end if;
    eid:='sirvoy-csv:'||a.booking_ref||':'||a.room_ref;
    if length(eid)>180 then raise exception 'invalid_source_booking_ref'; end if;
    select * into existing from public.bookings where property_id=p_property and external_id=eid;
    if found then
      if existing.source_accommodation_record_id is distinct from a.id or existing.source_booking_record_id is distinct from c.id then raise exception 'source_booking_already_exists_differently'; end if;
      skipped:=skipped+1; booking_ids:=booking_ids||jsonb_build_array(existing.id); continue;
    end if;
    select * into ai from public.sirvoy_source_imports where id=a.import_id;
    select * into ci from public.sirvoy_source_imports where id=c.import_id;
    select * into aa from public.sirvoy_export_archives where id=ai.archive_id;
    select * into ca from public.sirvoy_export_archives where id=ci.archive_id;
    if ai.source_format<>'bookings_expanded' or ci.source_format<>'bookings_condensed'
      or ai.cancellation_scope<>'excluding_cancelled' or ci.cancellation_scope<>'excluding_cancelled'
      or ai.parser_version<>ci.parser_version or aa.coverage_from is distinct from ca.coverage_from
      or aa.coverage_to is distinct from ca.coverage_to or aa.coverage_filter is distinct from ca.coverage_filter
      then raise exception 'source_manifests_mismatch'; end if;
    if (select count(*) from public.sirvoy_source_records where import_id=ci.id and booking_ref=c.booking_ref and record_kind='BOOKING')<>1
      or exists(select 1 from public.sirvoy_source_records where import_id=ai.id and booking_ref=a.booking_ref and record_kind not in('ACCOMM','EXTRAS','PAYMENT'))
      or exists(select 1 from public.sirvoy_source_records where import_id=ai.id and booking_ref=a.booking_ref and record_kind in('ACCOMM','EXTRAS') and (amount_decimal is null or amount_decimal::numeric<0))
      then raise exception 'source_booking_requires_review'; end if;
    -- Whole-booking values are reconciled once against the source, never copied
    -- into each tent's payment amount or treated as a completed payment.
    select min(checkin_date),max(checkout_date),count(*),sum(case when public.sirvoy_source_field(fields,ai.headers,'Guests')~'^[1-9][0-9]?$' then public.sirvoy_source_field(fields,ai.headers,'Guests')::integer else 0 end)
      into first_day,last_day,room_count,total_guests
      from public.sirvoy_source_records where import_id=ai.id and booking_ref=a.booking_ref and record_kind='ACCOMM';
    select sum(amount_decimal::numeric) into documented_total from public.sirvoy_source_records
      where import_id=ai.id and booking_ref=a.booking_ref and record_kind in('ACCOMM','EXTRAS');
    if c.checkin_date is distinct from first_day or c.checkout_date is distinct from last_day
      or c.amount_decimal is null or c.amount_decimal::numeric is distinct from documented_total
      or public.sirvoy_source_field(c.fields,ci.headers,'Number of rooms') is distinct from room_count::text
      or public.sirvoy_source_field(c.fields,ci.headers,'Number of guests') is distinct from total_guests::text
      or coalesce(public.sirvoy_source_field(c.fields,ci.headers,'Confirmed'),'') not in('Ja','Yes')
      or exists(select 1 from public.sirvoy_source_records where import_id=ai.id and booking_ref=a.booking_ref and record_kind='ACCOMM' group by room_ref having count(*)>1)
      or room_count<>(select count(*) from jsonb_array_elements(p_pairs) requested join public.sirvoy_source_records sr on sr.id=(requested->>'accommodationRecordId')::uuid where sr.import_id=ai.id and sr.booking_ref=a.booking_ref)
      then raise exception 'source_booking_requires_review'; end if;
    if a.checkin_date is null or a.checkout_date is null or a.checkin_date<=today or a.checkout_date<=a.checkin_date
      or a.checkout_date-a.checkin_date>max_nights then raise exception 'source_stay_not_future_or_invalid'; end if;
    if coalesce(c.guest_name,'')='' or length(c.guest_name) not between 2 and 120
      or length(coalesce(c.guest_email,''))>254 or length(coalesce(c.guest_phone,''))>40
      or (nullif(c.guest_email,'') is not null and c.guest_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
      or coalesce(public.sirvoy_source_field(a.fields,ai.headers,'Guests'),'')!~'^[1-9][0-9]?$' then raise exception 'source_guest_requires_review'; end if;
    guest_count:=public.sirvoy_source_field(a.fields,ai.headers,'Guests')::integer;
    if guest_count>20 then raise exception 'source_guest_requires_review'; end if;
    -- All three tents must have an explicit, unique active mapping, even if this
    -- particular batch only uses two. No name-based or first-row fallback.
    if (select count(*) from public.units where property_id=p_property and external_ref in('1','2','3'))<>3
      or (select count(distinct external_ref) from public.units where property_id=p_property and external_ref in('1','2','3') and active)<>3 then raise exception 'source_tent_map_incomplete'; end if;
    select * into unit from public.units where property_id=p_property and external_ref=a.room_ref for share;
    if not found or not unit.active or guest_count>unit.max_guests then raise exception 'source_tent_capacity_mismatch'; end if;
    plan:=plan||jsonb_build_array(jsonb_build_object('unit_id',unit.id,'accommodation_id',a.id,'booking_id',c.id,
      'external_id',eid,'guest_name',c.guest_name,'guest_email',c.guest_email,'guest_phone',c.guest_phone,
      'checkin',a.checkin_date,'checkout',a.checkout_date,'guests',guest_count));
  end loop;
  -- The same lock namespace as public checkout, manual and external writers.
  for item in select distinct jsonb_build_object('unit_id',value->>'unit_id') from jsonb_array_elements(plan) order by jsonb_build_object('unit_id',value->>'unit_id') loop
    perform pg_advisory_xact_lock(hashtextextended(item->>'unit_id',0));
  end loop;
  for item in select value from jsonb_array_elements(plan) order by value->>'unit_id',value->>'checkin',value->>'external_id' loop
    insert into public.bookings(property_id,unit_id,source,external_id,guest_name,guest_email,guest_phone,
      checkin_date,checkout_date,guests,status,stay_status,payment_amount,payment_status,payment_method,communications_enabled,
      source_accommodation_record_id,source_booking_record_id)
    values(p_property,(item->>'unit_id')::uuid,'manual',item->>'external_id',item->>'guest_name',nullif(item->>'guest_email',''),nullif(item->>'guest_phone',''),
      (item->>'checkin')::date,(item->>'checkout')::date,(item->>'guests')::integer,'confirmed','expected',null,'none','none',false,
      (item->>'accommodation_id')::uuid,(item->>'booking_id')::uuid) returning id into bid;
    imported:=imported+1; booking_ids:=booking_ids||jsonb_build_array(bid);
  end loop;
  return jsonb_build_object('ok',true,'imported',imported,'skipped',skipped,'bookingIds',booking_ids);
end $$;
revoke all on function public.import_sirvoy_source_calendar(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_sirvoy_source_calendar(uuid,uuid,jsonb) to service_role;
comment on function public.import_sirvoy_source_calendar(uuid,uuid,jsonb) is 'Atomic owner-scoped future inventory only, from exact Basic and Expanded source pairs. No payment assertion, messages, rounding, or historical imports.';
