-- An explicit, reviewed link to a native calendar event; never date-based dedup.
-- The immutable Sirvoy rows remain the documentary source. This migration does
-- not activate a source, fetch a calendar, infer payment or enable messaging.
create table public.ical_source_adoptions (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  source_id uuid not null references public.ical_sources(id) on delete restrict,
  ical_uid text not null check(length(ical_uid) between 1 and 1024),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  source_url_sha256 text not null check(source_url_sha256~'^[a-f0-9]{64}$'),
  booking_before_sha256 text not null check(booking_before_sha256~'^[a-f0-9]{64}$'),
  adopted_by uuid not null references auth.users(id) on delete restrict,
  adopted_at timestamptz not null default now(),
  unique(source_id,ical_uid)
);
create index ical_source_adoptions_property on public.ical_source_adoptions(property_id);
create index ical_source_adoptions_actor on public.ical_source_adoptions(adopted_by);
alter table public.ical_source_adoptions enable row level security;
revoke all on public.ical_source_adoptions from public,anon,authenticated,service_role;
grant select on public.ical_source_adoptions to authenticated;
grant select,insert on public.ical_source_adoptions to service_role;
create policy "owners read iCal source adoptions" on public.ical_source_adoptions for select to authenticated
using(exists(select 1 from public.properties p where p.id=ical_source_adoptions.property_id and p.owner_id=(select auth.uid())));

create function public.protect_source_ical_binding()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.source_accommodation_record_id is null then return new; end if;
  if tg_op='INSERT' then
    if new.ical_source_id is not null or new.ical_uid is not null then
      raise exception 'source_ical_binding_requires_adoption' using errcode='42501';
    end if;
    return new;
  end if;
  if row(new.ical_source_id,new.ical_uid) is distinct from row(old.ical_source_id,old.ical_uid) then
    if old.ical_source_id is not null or old.ical_uid is not null then
      raise exception 'source_ical_binding_immutable' using errcode='42501';
    end if;
    if current_user='authenticated' or coalesce(current_setting('request.jwt.claim.role',true),'')='authenticated'
      or current_setting('stayboost.ical_adoption_booking_id',true) is distinct from new.id::text then
      raise exception 'source_ical_binding_requires_adoption' using errcode='42501';
    end if;
  end if;
  if old.ical_source_id is not null
    and new.status='cancelled' and old.status<>'cancelled' and new.ical_cancel_reason='disappearance' then
    raise exception 'source_ical_disappearance_protected';
  end if;
  if old.ical_source_id is not null
    and (current_user='authenticated' or coalesce(current_setting('request.jwt.claim.role',true),'')='authenticated')
    and row(new.unit_id,new.checkin_date,new.checkout_date,new.guests,new.status)
      is distinct from row(old.unit_id,old.checkin_date,old.checkout_date,old.guests,old.status) then
    raise exception 'external_booking_dates' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_source_ical_binding() from public,anon,authenticated;
create trigger bookings_source_ical_binding_guard before insert or update on public.bookings
for each row execute function public.protect_source_ical_binding();

create function public.protect_adopted_ical_source()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and row(new.property_id,new.unit_id,new.url,new.channel_type)
    is distinct from row(old.property_id,old.unit_id,old.url,old.channel_type)
    and exists(select 1 from public.ical_source_adoptions where source_id=old.id) then
    raise exception 'adopted_ical_source_identity_immutable' using errcode='42501';
  end if;
  if new.channel_type='booking' and not new.paused and exists(
    select 1 from public.bookings b
      join public.sirvoy_source_records r on r.id=b.source_booking_record_id and r.property_id=b.property_id
      join public.sirvoy_source_imports i on i.id=r.import_id and i.property_id=b.property_id
    where b.property_id=new.property_id and b.unit_id=new.unit_id and b.status='confirmed'
      and b.checkout_date>(now() at time zone 'Europe/Stockholm')::date
      and b.source_accommodation_record_id is not null and b.ical_source_id is null
      and r.record_kind='BOOKING' and i.source_format='bookings_condensed'
      and public.sirvoy_source_field(r.fields,i.headers,'Booking source')='Booking.com'
  ) then raise exception 'ical_source_adoption_required'; end if;
  return new;
end $$;
revoke all on function public.protect_adopted_ical_source() from public,anon,authenticated;
create trigger ical_sources_adoption_guard before insert or update on public.ical_sources
for each row execute function public.protect_adopted_ical_source();

-- The trusted cutover operator must retain both the native feed and explicit
-- reference evidence. Hashes identify those reviewed files; they do not claim
-- that this RPC fetched a provider or proved a UID's undocumented format.
create function public.adopt_sirvoy_ical_booking(p_actor uuid,p_booking_id uuid,p_source_id uuid,p_evidence jsonb)
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
  if not feed.paused or feed.channel_type<>'booking' then raise exception 'source_adoption_paused_booking_source_required'; end if;
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
    or (select count(*) from jsonb_object_keys(p_evidence))<>10
    or exists(select 1 from jsonb_each(p_evidence) e where e.key not in
      ('provider_reference','native_event_uid','checkin_date','checkout_date','observed_at','feed_sha256','feed_url_sha256','reference_evidence_sha256','reference_evidence_kind','sirvoy_booking_reference')
      or jsonb_typeof(e.value)<>'string')
    or coalesce(p_evidence->>'feed_sha256','')!~'^[a-f0-9]{64}$'
    or p_evidence->>'feed_url_sha256' is distinct from encode(sha256(convert_to(feed.url,'UTF8')),'hex')
    or coalesce(p_evidence->>'reference_evidence_sha256','')!~'^[a-f0-9]{64}$'
    or p_evidence->>'reference_evidence_kind' not in ('native_feed','booking_extranet')
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
    or public.sirvoy_source_field(s.fields,si.headers,'Booking source') is distinct from 'Booking.com'
    or public.sirvoy_source_field(s.fields,si.headers,'Channel booking ID') is distinct from p_evidence->>'provider_reference'
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
revoke all on function public.adopt_sirvoy_ical_booking(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.adopt_sirvoy_ical_booking(uuid,uuid,uuid,jsonb) to service_role;
