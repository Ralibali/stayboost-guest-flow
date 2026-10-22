-- A short, fenced source attempt. No remote request holds a DB transaction open.
-- Every mutation rechecks the claim while holding the source row lock. A worker
-- that resumes after expiry/takeover cannot write bookings or publish freshness.
create table public.ical_sync_claims (
  source_id uuid primary key references public.ical_sources(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null,
  property_id uuid not null,
  unit_id uuid not null,
  source_url text not null,
  channel_type text not null
);
alter table public.ical_sync_claims enable row level security;
revoke all on public.ical_sync_claims from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.ical_sync_claims to service_role;

-- All RPCs lock source -> claim -> property inventory -> unit -> booking.
-- Source configuration updates already hold that same source row before their
-- inventory trigger; direct booking checks never acquire a source row lock.
create function public.require_ical_sync_claim(p_source_id uuid,p_token uuid)
returns public.ical_sources language plpgsql security invoker set search_path='' as $$
declare s public.ical_sources%rowtype; c public.ical_sync_claims%rowtype;
begin
  select * into s from public.ical_sources where id=p_source_id for update;
  if not found or s.paused then raise exception 'ical_claim_lost'; end if;
  select * into c from public.ical_sync_claims where source_id=s.id for update;
  if not found or p_token is null or c.token<>p_token or c.expires_at<=clock_timestamp()
    or row(c.property_id,c.unit_id,c.source_url,c.channel_type) is distinct from
       row(s.property_id,s.unit_id,s.url,s.channel_type)
  then raise exception 'ical_claim_lost'; end if;
  perform pg_advisory_xact_lock(hashtextextended('property-inventory:'||s.property_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(s.unit_id::text,0));
  perform set_config('stayboost.ical_sync_token',c.token::text,true);
  return s;
end $$;

create function public.claim_ical_sync(p_source_id uuid,p_owner_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.ical_sources%rowtype; c public.ical_sync_claims%rowtype;
  v_token uuid; v_now timestamptz; v_cache boolean;
begin
  select * into s from public.ical_sources where id=p_source_id for update;
  if not found or s.paused or (p_owner_id is not null and not exists(
    select 1 from public.properties where id=s.property_id and owner_id=p_owner_id
  )) then return null; end if;
  select * into c from public.ical_sync_claims where source_id=s.id for update;
  v_now:=clock_timestamp();
  if found and c.expires_at>v_now then return null; end if;
  -- A crashed/partial attempt must be replayed from a full body, never a 304.
  v_cache:=c.source_id is null and s.last_success_at is not null and s.consecutive_failures=0;
  v_token:=gen_random_uuid();
  insert into public.ical_sync_claims(source_id,token,expires_at,property_id,unit_id,source_url,channel_type)
    values(s.id,v_token,v_now+interval '5 minutes',s.property_id,s.unit_id,s.url,s.channel_type)
    on conflict(source_id) do update set token=excluded.token,expires_at=excluded.expires_at,
      property_id=excluded.property_id,unit_id=excluded.unit_id,source_url=excluded.source_url,channel_type=excluded.channel_type;
  perform set_config('stayboost.ical_sync_token',v_token::text,true);
  update public.ical_sources set last_success_at=null,last_attempt_at=v_now,last_status='synk pågår',
    http_etag=case when v_cache then s.http_etag end,
    http_last_modified=case when v_cache then s.http_last_modified end where id=s.id;
  perform set_config('stayboost.ical_sync_token','',true);
  return jsonb_build_object('token',v_token,'source',jsonb_build_object(
    'id',s.id,'property_id',s.property_id,'unit_id',s.unit_id,'url',s.url,'channel_type',s.channel_type,
    'http_etag',case when v_cache then s.http_etag end,
    'http_last_modified',case when v_cache then s.http_last_modified end));
end $$;

create function public.write_ical_sync_booking(p_source_id uuid,p_token uuid,p_booking_id uuid,p_uid text,p_patch jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.ical_sources%rowtype; b public.bookings%rowtype; result_id uuid;
begin
  s:=public.require_ical_sync_claim(p_source_id,p_token);
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>16384
    or exists(select 1 from jsonb_object_keys(p_patch) k where k not in
      ('guest_name','checkin_date','checkout_date','status','ical_missing_since','ical_missing_count','ical_cancelled_at','ical_cancel_reason'))
  then raise exception 'ical_patch_invalid'; end if;
  if p_booking_id is null then
    if p_uid is null or length(p_uid) not between 1 and 1024 or p_uid~'[[:cntrl:]]'
      or not (p_patch ? 'checkin_date' and p_patch ? 'checkout_date')
      or (p_patch ? 'status' and p_patch->>'status' is distinct from 'confirmed')
    then raise exception 'ical_patch_invalid'; end if;
    if exists(select 1 from public.bookings where ical_source_id=s.id and ical_uid=p_uid)
      then raise exception 'ical_uid_already_exists'; end if;
    insert into public.bookings(property_id,unit_id,source,ical_source_id,ical_uid,guest_name,checkin_date,checkout_date,
      ical_missing_since,ical_missing_count,ical_cancelled_at,ical_cancel_reason)
    values(s.property_id,s.unit_id,'ical',s.id,p_uid,p_patch->>'guest_name',(p_patch->>'checkin_date')::date,
      (p_patch->>'checkout_date')::date,(p_patch->>'ical_missing_since')::timestamptz,
      coalesce((p_patch->>'ical_missing_count')::integer,0),(p_patch->>'ical_cancelled_at')::timestamptz,p_patch->>'ical_cancel_reason')
    returning id into result_id;
  else
    select * into b from public.bookings where id=p_booking_id and ical_source_id=s.id
      and property_id=s.property_id and unit_id=s.unit_id and ical_uid=p_uid for update;
    if not found then raise exception 'ical_booking_scope_mismatch'; end if;
    -- Only existing importer fields. No source FK, money, guests or messaging write.
    update public.bookings set
      guest_name=case when p_patch ? 'guest_name' then p_patch->>'guest_name' else b.guest_name end,
      checkin_date=case when p_patch ? 'checkin_date' then (p_patch->>'checkin_date')::date else b.checkin_date end,
      checkout_date=case when p_patch ? 'checkout_date' then (p_patch->>'checkout_date')::date else b.checkout_date end,
      status=case when p_patch ? 'status' then p_patch->>'status' else b.status end,
      ical_missing_since=case when p_patch ? 'ical_missing_since' then (p_patch->>'ical_missing_since')::timestamptz else b.ical_missing_since end,
      ical_missing_count=case when p_patch ? 'ical_missing_count' then (p_patch->>'ical_missing_count')::integer else b.ical_missing_count end,
      ical_cancelled_at=case when p_patch ? 'ical_cancelled_at' then (p_patch->>'ical_cancelled_at')::timestamptz else b.ical_cancelled_at end,
      ical_cancel_reason=case when p_patch ? 'ical_cancel_reason' then p_patch->>'ical_cancel_reason' else b.ical_cancel_reason end
    where id=b.id returning id into result_id;
  end if;
  update public.ical_sync_claims set expires_at=clock_timestamp()+interval '5 minutes' where source_id=s.id and token=p_token;
  perform set_config('stayboost.ical_sync_token','',true);
  return result_id;
end $$;

create function public.finish_ical_sync(p_source_id uuid,p_token uuid,p_success boolean,p_status text,p_etag text default null,p_last_modified text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare s public.ical_sources%rowtype; v_now timestamptz;
begin
  s:=public.require_ical_sync_claim(p_source_id,p_token);
  if p_success is null or length(coalesce(p_status,''))>2048 or length(coalesce(p_etag,''))>2048
    or length(coalesce(p_last_modified,''))>2048 then raise exception 'ical_result_invalid'; end if;
  v_now:=clock_timestamp();
  update public.ical_sources set last_synced_at=v_now,
    last_success_at=case when p_success then v_now end,
    consecutive_failures=case when p_success then 0 else least(s.consecutive_failures,2147483646)+1 end,
    last_status=p_status,http_etag=case when p_success then p_etag end,
    http_last_modified=case when p_success then p_last_modified end where id=s.id;
  delete from public.ical_sync_claims where source_id=s.id and token=p_token;
  perform set_config('stayboost.ical_sync_token','',true);
  return true;
end $$;

-- Reject old/unfenced Edge writes before they can acquire inventory locks.
-- Non-iCal payment updates do not enter this path. The separately audited
-- source adoption RPC may only add its original UID binding, as before.
create function public.guard_ical_sync_booking_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_source uuid;
begin
  if tg_op='UPDATE' and row(new.property_id,new.unit_id,new.source,new.ical_source_id,new.ical_uid,new.guest_name,
      new.checkin_date,new.checkout_date,new.status,new.ical_missing_since,new.ical_missing_count,new.ical_cancelled_at,new.ical_cancel_reason)
    is not distinct from row(old.property_id,old.unit_id,old.source,old.ical_source_id,old.ical_uid,old.guest_name,
      old.checkin_date,old.checkout_date,old.status,old.ical_missing_since,old.ical_missing_count,old.ical_cancelled_at,old.ical_cancel_reason)
    then return new; end if;
  -- Preserve the existing FK ON DELETE SET NULL behavior for an ordinary
  -- removed source. The inventory row and every other calendar field survive.
  -- A direct detach while the source still exists remains fenced; adopted
  -- sources additionally retain their immutable audit FK / binding guard.
  if tg_op='UPDATE' and old.ical_source_id is not null and new.ical_source_id is null
    and row(new.property_id,new.unit_id,new.source,new.ical_uid,new.guest_name,new.checkin_date,new.checkout_date,
      new.status,new.ical_missing_since,new.ical_missing_count,new.ical_cancelled_at,new.ical_cancel_reason)
    is not distinct from row(old.property_id,old.unit_id,old.source,old.ical_uid,old.guest_name,old.checkin_date,old.checkout_date,
      old.status,old.ical_missing_since,old.ical_missing_count,old.ical_cancelled_at,old.ical_cancel_reason)
    and not exists(select 1 from public.ical_sources where id=old.ical_source_id)
    then return new; end if;
  if tg_op='UPDATE' and old.ical_source_id is null and new.source_accommodation_record_id is not null
    and current_user<>'authenticated'
    and coalesce(current_setting('request.jwt.claim.role',true),'')<>'authenticated'
    and current_setting('stayboost.ical_adoption_booking_id',true)=new.id::text
    then return new; end if;
  v_source:=new.ical_source_id;
  if tg_op='UPDATE' then v_source:=coalesce(old.ical_source_id,v_source); end if;
  if v_source is null then return new; end if;
  if current_user<>'service_role' then raise exception 'ical_claim_required' using errcode='42501'; end if;
  if not exists(select 1 from public.ical_sync_claims c where c.source_id=v_source
      and c.token::text=current_setting('stayboost.ical_sync_token',true) and c.expires_at>clock_timestamp()
      and c.property_id=new.property_id and c.unit_id=new.unit_id)
    then raise exception 'ical_claim_required' using errcode='42501'; end if;
  return new;
end $$;
create trigger bookings_ical_sync_fence before insert or update on public.bookings
for each row execute function public.guard_ical_sync_booking_write();

create function public.guard_ical_sync_health_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  -- Configuration-trigger resets are always conservative. Every attempt to
  -- publish success, change a failure counter or set cached validators is fenced.
  if row(new.last_success_at,new.last_attempt_at,new.last_synced_at,new.last_status,new.consecutive_failures,new.http_etag,new.http_last_modified)
    is not distinct from row(old.last_success_at,old.last_attempt_at,old.last_synced_at,old.last_status,old.consecutive_failures,old.http_etag,old.http_last_modified)
    then return new; end if;
  if new.last_success_at is null and new.last_attempt_at is null and new.last_synced_at is null
    and new.last_status is null and new.consecutive_failures=0 and new.http_etag is null and new.http_last_modified is null
    then return new; end if;
  if current_user<>'service_role' then raise exception 'ical_claim_required' using errcode='42501'; end if;
  if not exists(select 1 from public.ical_sync_claims c where c.source_id=new.id
      and c.token::text=current_setting('stayboost.ical_sync_token',true) and c.expires_at>clock_timestamp())
    then raise exception 'ical_claim_required' using errcode='42501'; end if;
  return new;
end $$;
create trigger ical_sources_sync_health_fence before update on public.ical_sources
for each row execute function public.guard_ical_sync_health_write();

-- Owner source edits cannot read/modify the private token table directly.
-- This fixed trigger can only invalidate the row for its own changed source.
create function private.invalidate_ical_sync_claim()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(new.property_id,new.unit_id,new.url,new.channel_type,new.paused) is distinct from
    row(old.property_id,old.unit_id,old.url,old.channel_type,old.paused)
  then delete from public.ical_sync_claims where source_id=new.id; end if;
  return new;
end $$;
create trigger ical_sources_sync_invalidate after update on public.ical_sources
for each row execute function private.invalidate_ical_sync_claim();

revoke all on function public.require_ical_sync_claim(uuid,uuid),public.claim_ical_sync(uuid,uuid),
  public.write_ical_sync_booking(uuid,uuid,uuid,text,jsonb),public.finish_ical_sync(uuid,uuid,boolean,text,text,text),
  public.guard_ical_sync_booking_write(),public.guard_ical_sync_health_write(),private.invalidate_ical_sync_claim()
  from public,anon,authenticated;
grant execute on function public.require_ical_sync_claim(uuid,uuid),public.claim_ical_sync(uuid,uuid),
  public.write_ical_sync_booking(uuid,uuid,uuid,text,jsonb),public.finish_ical_sync(uuid,uuid,boolean,text,text,text) to service_role;
