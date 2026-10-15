-- Explicit operator-reviewed Sirvoy export UID binding, independent of an OTA feed.
-- Only source identity is attached; documentary, payment and communication data stay intact.
create function public.adopt_sirvoy_export_booking(p_actor uuid,p_booking_id uuid,p_source_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  feed public.ical_sources%rowtype; b public.bookings%rowtype;
  a public.sirvoy_source_records%rowtype; s public.sirvoy_source_records%rowtype;
  si public.sirvoy_source_imports%rowtype; previous public.ical_source_adoptions%rowtype;
  observed timestamptz; sales_enabled boolean; prior_context text; uid text; scoped_property uuid;
begin
  select * into feed from public.ical_sources where id=p_source_id;
  if not found or not exists(select 1 from public.properties where id=feed.property_id and owner_id=p_actor)
    then raise exception 'not_authorized' using errcode='42501'; end if;
  scoped_property:=feed.property_id;
  select booking_enabled into sales_enabled from public.properties where id=feed.property_id and owner_id=p_actor for no key update;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if sales_enabled then raise exception 'source_adoption_sales_must_be_closed'; end if;
  select * into feed from public.ical_sources where id=p_source_id for update;
  if not found or feed.property_id is distinct from scoped_property then raise exception 'not_authorized' using errcode='42501'; end if;
  if not feed.paused or feed.channel_type<>'sirvoy' then raise exception 'source_adoption_paused_sirvoy_source_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('property-inventory:'||feed.property_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(feed.unit_id::text,0));
  select * into b from public.bookings where id=p_booking_id and property_id=feed.property_id for update;
  if not found then raise exception 'source_adoption_booking_mismatch'; end if;
  select * into previous from public.ical_source_adoptions where booking_id=b.id;
  if found then
    if previous.source_id=feed.id and previous.evidence=p_evidence then
      return jsonb_build_object('adopted',true,'duplicate',true,'booking_id',b.id);
    end if;
    raise exception 'source_adoption_already_bound';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or octet_length(p_evidence::text)>8192
    or (select count(*) from jsonb_object_keys(p_evidence))<>11
    or exists(select 1 from jsonb_each(p_evidence) e where e.key not in
      ('provider_reference','native_event_uid','checkin_date','checkout_date','observed_at','feed_sha256','feed_url_sha256','reference_evidence_sha256','reference_evidence_kind','sirvoy_booking_reference','native_event_summary')
      or jsonb_typeof(e.value)<>'string')
    or coalesce(p_evidence->>'feed_sha256','')!~'^[a-f0-9]{64}$'
    or p_evidence->>'feed_url_sha256' is distinct from encode(sha256(convert_to(feed.url,'UTF8')),'hex')
    or coalesce(p_evidence->>'reference_evidence_sha256','')!~'^[a-f0-9]{64}$'
    or p_evidence->>'reference_evidence_kind' is distinct from 'sirvoy_native_feed'
    or length(coalesce(p_evidence->>'native_event_uid','')) not between 1 and 1024
    or btrim(p_evidence->>'native_event_uid') is distinct from p_evidence->>'native_event_uid'
    or coalesce(p_evidence->>'native_event_uid','')~'[[:cntrl:]]'
    or length(coalesce(p_evidence->>'provider_reference','')) not between 1 and 128
    or coalesce(p_evidence->>'observed_at','')=''
    then raise exception 'source_adoption_evidence_invalid'; end if;
  observed:=(p_evidence->>'observed_at')::timestamptz;
  if observed<now()-interval '24 hours' or observed>now()+interval '5 minutes' then raise exception 'source_adoption_evidence_not_fresh'; end if;
  uid:=p_evidence->>'native_event_uid';
  if b.source<>'manual' or b.status<>'confirmed' or b.source_accommodation_record_id is null
    or b.unit_id is distinct from feed.unit_id or b.ical_source_id is not null or b.ical_uid is not null
    or b.channel_connection_id is not null or b.channel_booking_id is not null
    then raise exception 'source_adoption_booking_mismatch'; end if;
  select * into a from public.sirvoy_source_records where id=b.source_accommodation_record_id and property_id=b.property_id;
  select * into s from public.sirvoy_source_records where id=b.source_booking_record_id and property_id=b.property_id;
  select * into si from public.sirvoy_source_imports where id=s.import_id and property_id=b.property_id;
  if a.id is null or s.id is null or si.id is null or si.source_format<>'bookings_condensed'
    or si.cancellation_scope<>'excluding_cancelled' or a.record_kind<>'ACCOMM' or s.record_kind<>'BOOKING'
    or a.booking_ref is distinct from s.booking_ref or s.booking_ref is distinct from p_evidence->>'sirvoy_booking_reference'
    or s.booking_ref is distinct from p_evidence->>'provider_reference'
    or p_evidence->>'native_event_summary' is distinct from 'Booking '||s.booking_ref
    or public.sirvoy_source_field(s.fields,si.headers,'Number of rooms') is distinct from '1'
    or (select count(*) from public.bookings where property_id=b.property_id and source_booking_record_id=s.id)<>1
    then raise exception 'source_adoption_identity_mismatch'; end if;
  if b.checkin_date is distinct from a.checkin_date or b.checkout_date is distinct from a.checkout_date
    or b.checkin_date::text is distinct from p_evidence->>'checkin_date'
    or b.checkout_date::text is distinct from p_evidence->>'checkout_date'
    or not exists(select 1 from public.units where id=b.unit_id and property_id=b.property_id and external_ref=a.room_ref)
    then raise exception 'source_adoption_inventory_mismatch'; end if;
  if exists(select 1 from public.bookings where ical_source_id=feed.id and ical_uid=uid)
    then raise exception 'source_adoption_uid_already_used'; end if;
  prior_context:=current_setting('stayboost.ical_adoption_booking_id',true);
  perform set_config('stayboost.ical_adoption_booking_id',b.id::text,true);
  update public.bookings set ical_source_id=feed.id,ical_uid=uid where id=b.id;
  perform set_config('stayboost.ical_adoption_booking_id',coalesce(prior_context,''),true);
  insert into public.ical_source_adoptions(booking_id,property_id,source_id,ical_uid,evidence,source_url_sha256,booking_before_sha256,adopted_by)
    values(b.id,b.property_id,feed.id,uid,p_evidence,encode(sha256(convert_to(feed.url,'UTF8')),'hex'),encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex'),p_actor);
  return jsonb_build_object('adopted',true,'duplicate',false,'booking_id',b.id);
end $$;
revoke all on function public.adopt_sirvoy_export_booking(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.adopt_sirvoy_export_booking(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.protect_adopted_ical_source()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and row(new.property_id,new.unit_id,new.url,new.channel_type)
    is distinct from row(old.property_id,old.unit_id,old.url,old.channel_type)
    and exists(select 1 from public.ical_source_adoptions where source_id=old.id) then
    raise exception 'adopted_ical_source_identity_immutable' using errcode='42501';
  end if;
  if new.channel_type in ('booking','sirvoy') and not new.paused and exists(
    select 1 from public.bookings b
      join public.sirvoy_source_records r on r.id=b.source_booking_record_id and r.property_id=b.property_id
      join public.sirvoy_source_imports i on i.id=r.import_id and i.property_id=b.property_id
    where b.property_id=new.property_id and b.unit_id=new.unit_id and b.status='confirmed'
      and b.checkout_date>(now() at time zone 'Europe/Stockholm')::date
      and b.source_accommodation_record_id is not null and b.ical_source_id is null
      and r.record_kind='BOOKING' and i.source_format='bookings_condensed'
      and (new.channel_type='sirvoy' or public.sirvoy_source_field(r.fields,i.headers,'Booking source')='Booking.com')
  ) then raise exception 'ical_source_adoption_required'; end if;
  return new;
end $$;

-- Calendar closures are availability rules, not customer bookings. Their source
-- and UID are server-owned; public rule projections already omit these fields.
alter table public.rate_rules
  add column ical_source_id uuid references public.ical_sources(id) on delete restrict,
  add column ical_uid text,
  add constraint rate_rules_ical_identity check (
    (ical_source_id is null and ical_uid is null) or
    (ical_source_id is not null and ical_uid is not null and length(ical_uid) between 1 and 1024 and ical_uid !~ '[[:cntrl:]]')
  ),
  add constraint rate_rules_ical_uid_unique unique(ical_source_id,ical_uid);

create function public.guard_ical_rate_rule()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_source uuid;
begin
  if tg_op='INSERT' then v_source:=new.ical_source_id;
  else v_source:=old.ical_source_id; end if;
  if tg_op='UPDATE' then v_source:=coalesce(v_source,new.ical_source_id); end if;
  if v_source is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' or current_user<>'service_role'
    or current_setting('stayboost.ical_sync_token',true) is null
    then raise exception 'ical_rule_requires_sync' using errcode='42501'; end if;
  if tg_op='UPDATE' and (
    old.ical_source_id is null or
    (to_jsonb(new)-array['date_from','date_to','active','updated_at']) is distinct from
    (to_jsonb(old)-array['date_from','date_to','active','updated_at'])
  ) then raise exception 'ical_rule_identity_immutable' using errcode='42501'; end if;
  if new.kind<>'closed' or new.fixed_price is not null or new.pct_delta is not null
    or new.min_stay is not null or new.adult_prices is not null
    or new.priority<>0 or new.note is not null
    or new.name is distinct from 'Stängt via kalender'
    then raise exception 'ical_rule_patch_invalid'; end if;
  -- The RPC already owns source -> claim -> inventory -> unit. Do not acquire
  -- source locks here after a rule row lock (avoids inversion with owner edits).
  if not exists(select 1 from public.ical_sync_claims c
    where c.source_id=v_source and c.token::text=current_setting('stayboost.ical_sync_token',true)
      and c.expires_at>clock_timestamp() and c.property_id=new.property_id
      and c.unit_id=new.unit_id and c.channel_type='sirvoy')
    then raise exception 'ical_claim_required' using errcode='42501'; end if;
  return new;
end $$;
create trigger rate_rules_ical_fence before insert or update or delete on public.rate_rules
for each row execute function public.guard_ical_rate_rule();

create function public.write_ical_sync_block(p_source_id uuid,p_token uuid,p_uid text,p_start date,p_end date,p_cancelled boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.ical_sources%rowtype; r public.rate_rules%rowtype; result_id uuid;
begin
  s:=public.require_ical_sync_claim(p_source_id,p_token);
  if s.channel_type<>'sirvoy' then raise exception 'ical_block_source_invalid'; end if;
  if p_uid is null or length(p_uid) not between 1 and 1024 or p_uid~'[[:cntrl:]]'
    or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_cancelled is null then raise exception 'ical_block_invalid'; end if;
  select * into r from public.rate_rules where ical_source_id=s.id and ical_uid=p_uid for update;
  if found then
    if r.property_id<>s.property_id or r.unit_id is distinct from s.unit_id then raise exception 'ical_block_scope_mismatch'; end if;
    update public.rate_rules set date_from=p_start,date_to=p_end-1,active=not p_cancelled
      where id=r.id returning id into result_id;
  elsif not p_cancelled then
    insert into public.rate_rules(property_id,unit_id,name,kind,date_from,date_to,ical_source_id,ical_uid)
      values(s.property_id,s.unit_id,'Stängt via kalender','closed',p_start,p_end-1,s.id,p_uid)
      returning id into result_id;
  end if;
  -- Missing Sirvoy events never release inventory; only an explicit source
  -- cancellation disables this calendar's own rule. Other rules are untouched.
  update public.ical_sync_claims set expires_at=clock_timestamp()+interval '5 minutes'
    where source_id=s.id and token=p_token;
  perform set_config('stayboost.ical_sync_token','',true);
  return result_id;
end $$;
revoke all on function public.guard_ical_rate_rule(), public.write_ical_sync_block(uuid,uuid,text,date,date,boolean)
  from public,anon,authenticated;
grant execute on function public.write_ical_sync_block(uuid,uuid,text,date,date,boolean) to service_role;

-- Missing Sirvoy closures stay closed, but must be visible as needing review.
-- Count inside the fenced source snapshot; no client reads of private rule UIDs.
create function public.count_missing_ical_sync_blocks(p_source_id uuid,p_token uuid,p_seen_uids text[])
returns integer language plpgsql security invoker set search_path='' as $$
declare s public.ical_sources%rowtype; missing integer;
begin
  s:=public.require_ical_sync_claim(p_source_id,p_token);
  if s.channel_type<>'sirvoy' or p_seen_uids is null or coalesce(array_ndims(p_seen_uids),1)<>1
    or cardinality(p_seen_uids)>10000 or exists(select 1 from unnest(p_seen_uids) u where u is null
      or length(u) not between 1 and 1024 or u~'[[:cntrl:]]')
    then raise exception 'ical_block_snapshot_invalid'; end if;
  select count(*)::integer into missing from public.rate_rules
    where ical_source_id=s.id and property_id=s.property_id and unit_id=s.unit_id
      and active and date_to>=(now() at time zone 'Europe/Stockholm')::date
      and not (ical_uid=any(p_seen_uids));
  perform set_config('stayboost.ical_sync_token','',true);
  return missing;
end $$;
revoke all on function public.count_missing_ical_sync_blocks(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.count_missing_ical_sync_blocks(uuid,uuid,text[]) to service_role;
