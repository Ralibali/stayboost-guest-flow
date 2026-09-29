-- Channel manager foundation. Connections start disabled and contain no API secrets.
create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null default 'channex' check(provider='channex'),
  environment text not null default 'staging' check(environment in ('staging','production')),
  external_property_id text not null check(length(trim(external_property_id)) between 1 and 128),
  enabled boolean not null default false,
  fees_configured boolean not null default false,
  verified_at timestamptz,
  webhook_id text,
  last_booking_sync_at timestamptz,
  last_ari_sync_at timestamptz,
  last_error text,
  sync_dirty_at timestamptz default now(),
  next_retry_at timestamptz,
  sync_lease_until timestamptz,
  sync_lease_token uuid,
  sync_failures integer not null default 0 check(sync_failures>=0),
  created_at timestamptz not null default now(),
  unique(property_id,provider,environment),
  unique(provider,environment,external_property_id)
);
create table public.channel_unit_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.channel_connections(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  room_type_id text not null check(length(trim(room_type_id)) between 1 and 128),
  rate_plan_id text not null check(length(trim(rate_plan_id)) between 1 and 128),
  created_at timestamptz not null default now(),
  unique(connection_id,unit_id),
  unique(connection_id,room_type_id)
);
create table public.channel_booking_revisions (
  revision_id text not null check(length(revision_id) between 1 and 128),
  connection_id uuid not null references public.channel_connections(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  external_booking_id text not null check(length(external_booking_id) between 1 and 128),
  inserted_at timestamptz not null,
  status text not null check(status in ('pending_mapping','applied','stale')),
  payload jsonb not null,
  acknowledged_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  primary key(connection_id,revision_id)
);
create index channel_revisions_booking on public.channel_booking_revisions(connection_id,external_booking_id,inserted_at desc);
create index channel_revisions_pending on public.channel_booking_revisions(connection_id,created_at) where status='pending_mapping';
create index channel_revisions_pending_property on public.channel_booking_revisions(property_id) where status='pending_mapping';
create index channel_mappings_unit on public.channel_unit_mappings(unit_id);

alter table public.channel_connections enable row level security;
alter table public.channel_unit_mappings enable row level security;
alter table public.channel_booking_revisions enable row level security;
create policy "owners read channel connections" on public.channel_connections for select to authenticated
using(exists(select 1 from public.properties p where p.id=property_id and p.owner_id=(select auth.uid())));
create policy "owners create channel connections" on public.channel_connections for insert to authenticated
with check(exists(select 1 from public.properties p where p.id=property_id and p.owner_id=(select auth.uid())));
create policy "owners update channel connections" on public.channel_connections for update to authenticated
using(exists(select 1 from public.properties p where p.id=property_id and p.owner_id=(select auth.uid())))
with check(exists(select 1 from public.properties p where p.id=property_id and p.owner_id=(select auth.uid())));
create policy "owners manage channel mappings" on public.channel_unit_mappings for all to authenticated
using(exists(select 1 from public.channel_connections c join public.properties p on p.id=c.property_id where c.id=connection_id and p.owner_id=(select auth.uid())))
with check(exists(select 1 from public.channel_connections c join public.properties p on p.id=c.property_id join public.units u on u.property_id=c.property_id where c.id=connection_id and u.id=unit_id and p.owner_id=(select auth.uid())));
create policy "owners read channel revisions" on public.channel_booking_revisions for select to authenticated
using(exists(select 1 from public.channel_connections c join public.properties p on p.id=c.property_id where c.id=connection_id and p.owner_id=(select auth.uid())));
revoke all on public.channel_connections,public.channel_unit_mappings,public.channel_booking_revisions from anon,authenticated;
grant select on public.channel_connections,public.channel_unit_mappings,public.channel_booking_revisions to authenticated;
grant insert(property_id,provider,environment,external_property_id,fees_configured) on public.channel_connections to authenticated;
grant update(environment,external_property_id,enabled,fees_configured) on public.channel_connections to authenticated;
grant insert(connection_id,unit_id,room_type_id,rate_plan_id),update(room_type_id,rate_plan_id),delete on public.channel_unit_mappings to authenticated;
grant all on public.channel_connections,public.channel_unit_mappings,public.channel_booking_revisions to service_role;

create or replace function public.validate_channel_connection()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and row(new.external_property_id,new.environment) is distinct from row(old.external_property_id,old.environment) then
    if old.enabled then raise exception 'disable_channel_before_edit'; end if;
    if exists(select 1 from public.channel_booking_revisions where connection_id=old.id)
      or exists(select 1 from public.bookings where channel_connection_id=old.id) then raise exception 'channel_history_requires_new_connection'; end if;
    new.verified_at:=null; new.webhook_id:=null; new.enabled:=false;
    new.last_ari_sync_at:=null; new.last_booking_sync_at:=null; new.sync_dirty_at:=clock_timestamp();
  end if;
  if new.enabled and (tg_op='INSERT' or not old.enabled) then
    if new.verified_at is null then raise exception 'channel_not_verified'; end if;
    if new.webhook_id is null then raise exception 'channel_webhook_required'; end if;
    if not exists(select 1 from public.channel_unit_mappings where connection_id=new.id)
      or exists(select 1 from public.units u where u.property_id=new.property_id and u.active
        and not exists(select 1 from public.channel_unit_mappings m where m.connection_id=new.id and m.unit_id=u.id)) then
      raise exception 'channel_mapping_incomplete';
    end if;
    new.sync_dirty_at:=clock_timestamp(); new.next_retry_at:=null;
  end if;
  return new;
end $$;
revoke all on function public.validate_channel_connection() from public,anon,authenticated;
create trigger channel_connection_validation before insert or update on public.channel_connections for each row execute function public.validate_channel_connection();

create or replace function public.validate_channel_mapping()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; pid uuid; live boolean;
begin
  cid:=case when tg_op='DELETE' then old.connection_id else new.connection_id end;
  select property_id,enabled into pid,live from public.channel_connections where id=cid for update;
  if auth.uid() is not null and not exists(select 1 from public.properties where id=pid and owner_id=auth.uid()) then
    raise exception 'channel_not_authorized' using errcode='42501';
  end if;
  if live then raise exception 'disable_channel_before_mapping'; end if;
  if tg_op<>'DELETE' and not exists(select 1 from public.units where id=new.unit_id and property_id=pid) then raise exception 'invalid_channel_unit'; end if;
  update public.channel_connections set sync_dirty_at=clock_timestamp(),verified_at=null,webhook_id=null where id=cid;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.validate_channel_mapping() from public,anon,authenticated;
create trigger channel_mapping_validation before insert or update or delete on public.channel_unit_mappings for each row execute function public.validate_channel_mapping();

-- An authenticated operator cannot forge synchronisation metadata or manipulate channel inventory.
alter table public.bookings drop constraint bookings_source_check;
alter table public.bookings add constraint bookings_source_check check(source in ('manual','ical','direct','sirvoy','channex'));
alter table public.bookings add column channel_connection_id uuid references public.channel_connections(id) on delete restrict,
  add column channel_booking_id text, add column channel_room_key text,
  add column channel_revision_at timestamptz, add column channel_revision_id text;
create unique index bookings_channel_room on public.bookings(channel_connection_id,channel_booking_id,channel_room_key) where channel_connection_id is not null;
create index bookings_channel_connection on public.bookings(channel_connection_id);
create or replace function public.protect_channel_booking()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')='authenticated' then
    if tg_op='INSERT' and (new.channel_connection_id is not null or new.channel_booking_id is not null or new.channel_room_key is not null or new.channel_revision_id is not null or new.channel_revision_at is not null) then
      raise exception 'channel_booking_server_only' using errcode='42501';
    elsif tg_op='UPDATE' then
      if row(new.channel_connection_id,new.channel_booking_id,new.channel_room_key,new.channel_revision_at,new.channel_revision_id)
        is distinct from row(old.channel_connection_id,old.channel_booking_id,old.channel_room_key,old.channel_revision_at,old.channel_revision_id) then
        raise exception 'channel_booking_server_only' using errcode='42501';
      end if;
      if old.source in ('ical','sirvoy','channex') and row(new.unit_id,new.checkin_date,new.checkout_date,new.guests,new.status)
        is distinct from row(old.unit_id,old.checkin_date,old.checkout_date,old.guests,old.status) then
        raise exception 'external_booking_dates';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.protect_channel_booking() from public,anon,authenticated;
create trigger bookings_protect_channel before insert or update on public.bookings for each row execute function public.protect_channel_booking();

-- A dirty marker survives concurrent inventory writes while an outgoing sync holds a lease.
create or replace function private.mark_channel_inventory_dirty()
returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
  if tg_table_name='properties' then
    if new.max_stay is distinct from old.max_stay then
      update public.channel_connections set sync_dirty_at=clock_timestamp() where property_id=new.id;
    end if;
    return null;
  end if;
  if tg_table_name='bookings' then
    if tg_op='UPDATE' then
      if row(new.unit_id,new.checkin_date,new.checkout_date,new.status)
        is not distinct from row(old.unit_id,old.checkin_date,old.checkout_date,old.status) then return null; end if;
    end if;
  end if;
  pid:=case when tg_op='DELETE' then old.property_id else new.property_id end;
  update public.channel_connections set sync_dirty_at=clock_timestamp() where property_id=pid;
  if tg_op='UPDATE' and old.property_id is distinct from new.property_id then
    update public.channel_connections set sync_dirty_at=clock_timestamp() where property_id=old.property_id;
  end if;
  return null;
end $$;
revoke all on function private.mark_channel_inventory_dirty() from public,anon,authenticated;
create trigger bookings_channel_dirty after insert or update or delete on public.bookings for each row execute function private.mark_channel_inventory_dirty();
create trigger units_channel_dirty after insert or update or delete on public.units for each row execute function private.mark_channel_inventory_dirty();
create trigger rates_channel_dirty after insert or update or delete on public.rate_rules for each row execute function private.mark_channel_inventory_dirty();
create trigger properties_channel_dirty after update of max_stay on public.properties for each row execute function private.mark_channel_inventory_dirty();

create or replace function public.claim_channel_sync(p_connection_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare token uuid:=gen_random_uuid();
begin
  update public.channel_connections set sync_lease_token=token,sync_lease_until=clock_timestamp()+interval '5 minutes'
  where id=p_connection_id and enabled and (sync_lease_until is null or sync_lease_until<clock_timestamp())
    and (next_retry_at is null or next_retry_at<=clock_timestamp());
  if not found then return null; end if;
  return token;
end $$;
revoke all on function public.claim_channel_sync(uuid) from public,anon,authenticated;
grant execute on function public.claim_channel_sync(uuid) to service_role;
create or replace function public.complete_channel_sync(p_connection_id uuid,p_lease_token uuid,p_started_at timestamptz,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.channel_connections set
    sync_lease_token=null,sync_lease_until=null,
    last_error=case when nullif(p_error,'') is not null and last_error='channel_inventory_closure_failed'
      then last_error else nullif(left(p_error,2000),'') end,
    last_ari_sync_at=case when nullif(p_error,'') is null then clock_timestamp() else last_ari_sync_at end,
    sync_dirty_at=case when nullif(p_error,'') is null and sync_dirty_at<=p_started_at then null else sync_dirty_at end,
    sync_failures=case when nullif(p_error,'') is null then 0 else sync_failures+1 end,
    next_retry_at=case when nullif(p_error,'') is null then null else clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(sync_failures,6))::int)) end
  where id=p_connection_id and sync_lease_token=p_lease_token
    and (nullif(p_error,'') is not null or (enabled and sync_lease_until>clock_timestamp()));
  return found;
end $$;
revoke all on function public.complete_channel_sync(uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.complete_channel_sync(uuid,uuid,timestamptz,text) to service_role;

-- Applied revisions are acknowledged by the Edge Function only after this transaction succeeds.
create or replace function public.apply_channex_revision(p_connection_id uuid,p_revision jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.channel_connections%rowtype; rid text; bid text; revision_at timestamptz; existing_state text;
  r jsonb; safe_rooms jsonb:='[]'; safe_services jsonb:='[]'; sanitized jsonb; customer jsonb;
  mapping public.channel_unit_mappings%rowtype; room_key text; booking_ids uuid[]:='{}'; row_id uuid; keys text[]:='{}';
  adults_count integer; children_count integer; infants_count integer; guests_count integer; ages integer[];
  latest timestamptz; provider_status text; room_amount integer; foreign_currency boolean;
begin
  select * into c from public.channel_connections where id=p_connection_id;
  if not found or not c.enabled then raise exception 'channel_disabled'; end if;
  rid:=p_revision->>'id'; bid:=p_revision->>'booking_id'; provider_status:=p_revision->>'status';
  if rid is null or length(rid) not between 1 and 128 or bid is null or length(bid) not between 1 and 128
    or p_revision->>'property_id' is distinct from c.external_property_id
    or provider_status is null or provider_status not in ('new','modified','cancelled') or p_revision->>'inserted_at' is null then raise exception 'invalid_channel_revision'; end if;
  revision_at:=(p_revision->>'inserted_at')::timestamptz;
  perform pg_advisory_xact_lock(hashtextextended('property-inventory:'||c.property_id::text,0));
  select * into c from public.channel_connections where id=p_connection_id for update;
  if not c.enabled then raise exception 'channel_disabled'; end if;
  if p_revision->>'property_id' is distinct from c.external_property_id then raise exception 'invalid_channel_revision'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c.id::text||':'||bid,0));
  select status into existing_state from public.channel_booking_revisions where connection_id=c.id and revision_id=rid;
  if existing_state in ('applied','stale') then
    return jsonb_build_object('applied',true,'duplicate',true,'needs_mapping',false,'stale',existing_state='stale','revision_id',rid);
  end if;
  -- Whitelist at the database boundary too: guarantee/card objects are never persisted.
  customer:=jsonb_build_object('name',left(p_revision->'customer'->>'name',120),'surname',left(p_revision->'customer'->>'surname',120),
    'mail',left(p_revision->'customer'->>'mail',254),'phone',left(p_revision->'customer'->>'phone',40));
  if jsonb_typeof(p_revision->'rooms')='array' then
    for r in select value from jsonb_array_elements(p_revision->'rooms') loop
      safe_rooms:=safe_rooms||jsonb_build_array(jsonb_build_object('room_type_id',r->>'room_type_id','rate_plan_id',r->>'rate_plan_id',
        'checkin_date',r->>'checkin_date','checkout_date',r->>'checkout_date','amount',r->>'amount','ota_unique_id',r->>'ota_unique_id',
        'occupancy',jsonb_build_object('adults',r->'occupancy'->'adults','children',r->'occupancy'->'children','infants',r->'occupancy'->'infants','ages',r->'occupancy'->'ages')));
    end loop;
  end if;
  if jsonb_typeof(p_revision->'services')='array' then
    for r in select value from jsonb_array_elements(p_revision->'services') loop
      safe_services:=safe_services||jsonb_build_array(jsonb_build_object('name',left(r->>'name',200),'type',r->>'type','nights',r->'nights','persons',r->'persons',
        'price_mode',r->>'price_mode','price_per_unit',r->>'price_per_unit','total_price',r->>'total_price'));
    end loop;
  end if;
  sanitized:=jsonb_build_object('id',rid,'property_id',c.external_property_id,'booking_id',bid,'inserted_at',revision_at,
    'status',provider_status,'ota_name',left(p_revision->>'ota_name',120),'ota_reservation_code',left(p_revision->>'ota_reservation_code',128),
    'currency',p_revision->>'currency','amount',p_revision->>'amount','customer',customer,'rooms',safe_rooms,'services',safe_services,
    'notes',left(p_revision->>'notes',10000),'payment_collect',p_revision->>'payment_collect','payment_type',p_revision->>'payment_type');
  insert into public.channel_booking_revisions(revision_id,connection_id,property_id,external_booking_id,inserted_at,status,payload)
    values(rid,c.id,c.property_id,bid,revision_at,'pending_mapping',sanitized)
    on conflict(connection_id,revision_id) do nothing;
  select max(inserted_at) into latest from public.channel_booking_revisions
    where connection_id=c.id and external_booking_id=bid and status in ('applied','stale') and revision_id<>rid;
  if latest is not null and revision_at<=latest then
    update public.channel_booking_revisions set status='stale' where connection_id=c.id and revision_id=rid;
    return jsonb_build_object('applied',true,'duplicate',false,'needs_mapping',false,'stale',true,'revision_id',rid);
  end if;
  if provider_status<>'cancelled' then
    if jsonb_array_length(safe_rooms)=0 then raise exception 'invalid_channel_rooms'; end if;
    for r in select value from jsonb_array_elements(safe_rooms) loop
      select * into mapping from public.channel_unit_mappings where connection_id=c.id and room_type_id=r->>'room_type_id';
      if not found or mapping.room_type_id=any(keys) or mapping.rate_plan_id is distinct from r->>'rate_plan_id' then
        return jsonb_build_object('applied',false,'duplicate',false,'needs_mapping',true,'stale',false,'revision_id',rid);
      end if;
      keys:=array_append(keys,mapping.room_type_id);
      if r->>'checkin_date' is null or r->>'checkout_date' is null
        or (r->>'checkout_date')::date<=(r->>'checkin_date')::date then raise exception 'invalid_channel_dates'; end if;
    end loop;
  end if;
  -- Acquire inventory locks in one stable order before applying any room to avoid cross-room deadlocks.
  perform pg_advisory_xact_lock(hashtextextended(unit_id::text,0)) from (
    select unit_id from public.channel_unit_mappings where connection_id=c.id and room_type_id=any(keys)
    union select unit_id from public.bookings where channel_connection_id=c.id and channel_booking_id=bid and unit_id is not null
  ) u order by unit_id;
  -- Validate the complete replacement before any room is cancelled or written.
  -- OTA data may conflict with a direct sale or an older external source; retain
  -- the pending incident so sales fail closed and no revision is acknowledged.
  if provider_status<>'cancelled' then
    for r in select value from jsonb_array_elements(safe_rooms) loop
      select * into mapping from public.channel_unit_mappings where connection_id=c.id and room_type_id=r->>'room_type_id';
      if exists(select 1 from public.bookings b where b.unit_id=mapping.unit_id and b.status='confirmed'
        and b.checkin_date<(r->>'checkout_date')::date and b.checkout_date>(r->>'checkin_date')::date
        and not coalesce(b.channel_connection_id=c.id and b.channel_booking_id=bid,false)) then
        update public.channel_booking_revisions set last_error='channel_inventory_conflict'
          where connection_id=c.id and revision_id=rid;
        return jsonb_build_object('applied',false,'duplicate',false,'needs_mapping',true,'inventory_conflict',true,'stale',false,'revision_id',rid);
      end if;
    end loop;
  end if;
  if provider_status='cancelled' then
    update public.bookings set status='cancelled',channel_revision_at=revision_at,channel_revision_id=rid
      where channel_connection_id=c.id and channel_booking_id=bid;
  else
    update public.bookings set status='cancelled',channel_revision_at=revision_at,channel_revision_id=rid
      where channel_connection_id=c.id and channel_booking_id=bid and not(channel_room_key=any(keys));
    foreign_currency:=coalesce(p_revision->>'currency','')<>'SEK';
    for r in select value from jsonb_array_elements(safe_rooms) loop
      select * into mapping from public.channel_unit_mappings where connection_id=c.id and room_type_id=r->>'room_type_id';
      room_key:=mapping.room_type_id;
      adults_count:=coalesce((r->'occupancy'->>'adults')::int,0); children_count:=coalesce((r->'occupancy'->>'children')::int,0); infants_count:=coalesce((r->'occupancy'->>'infants')::int,0);
      guests_count:=greatest(1,adults_count+children_count+infants_count);
      if adults_count<0 or children_count<0 or infants_count<0 or guests_count>20 then raise exception 'invalid_channel_occupancy'; end if;
      ages:='{}';
      if jsonb_typeof(r->'occupancy'->'ages')='array' then select coalesce(array_agg(value::int),'{}') into ages from jsonb_array_elements_text(r->'occupancy'->'ages'); end if;
      if cardinality(ages)<>children_count then adults_count:=0; ages:='{}';
      else ages:=ages||array_fill(0,array[infants_count]); end if;
      room_amount:=case when foreign_currency or r->>'amount' is null then null else round((r->>'amount')::numeric)::int end;
      if room_amount<0 then raise exception 'invalid_channel_amount'; end if;
      insert into public.bookings(property_id,unit_id,source,external_id,guest_name,guest_email,guest_phone,checkin_date,checkout_date,status,
        guests,adults,children_ages,notes,payment_amount,payment_status,payment_method,quote_snapshot,
        channel_connection_id,channel_booking_id,channel_room_key,channel_revision_at,channel_revision_id)
      values(c.property_id,mapping.unit_id,'channex','channex:'||c.id||':'||bid||':'||room_key,
        nullif(left(trim(concat_ws(' ',customer->>'name',customer->>'surname')),120),''),nullif(customer->>'mail',''),nullif(customer->>'phone',''),
        (r->>'checkin_date')::date,(r->>'checkout_date')::date,'confirmed',guests_count,nullif(adults_count,0),ages,nullif(sanitized->>'notes',''),
        room_amount,'none','none',jsonb_build_object('provider','channex','currency',p_revision->>'currency','room_amount',r->>'amount','occupancy',r->'occupancy','payment_collect',p_revision->>'payment_collect','ota_name',p_revision->>'ota_name'),
        c.id,bid,room_key,revision_at,rid)
      on conflict(channel_connection_id,channel_booking_id,channel_room_key) where channel_connection_id is not null do update set
        unit_id=excluded.unit_id,guest_name=excluded.guest_name,guest_email=excluded.guest_email,guest_phone=excluded.guest_phone,
        checkin_date=excluded.checkin_date,checkout_date=excluded.checkout_date,status='confirmed',guests=excluded.guests,adults=excluded.adults,children_ages=excluded.children_ages,
        notes=excluded.notes,payment_amount=excluded.payment_amount,quote_snapshot=excluded.quote_snapshot,channel_revision_at=revision_at,channel_revision_id=rid
      returning id into row_id;
      booking_ids:=array_append(booking_ids,row_id);
    end loop;
  end if;
  update public.channel_booking_revisions set status='applied',last_error=null where connection_id=c.id and revision_id=rid;
  return jsonb_build_object('applied',true,'duplicate',false,'needs_mapping',false,'stale',false,'revision_id',rid,'booking_ids',to_jsonb(booking_ids));
end $$;
revoke all on function public.apply_channex_revision(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_channex_revision(uuid,jsonb) to service_role;

-- Serialize pending revision admission with managed sales, not just individual room writes.
-- The shared property lock closes the gap between the public engine's read and its INSERT.
create or replace function public.lock_pending_channel_inventory()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('property-inventory:'||new.property_id::text,0));
  if tg_op='INSERT' then
    update public.channel_connections set sync_dirty_at=clock_timestamp() where id=new.connection_id;
  elsif new.status is distinct from old.status then
    update public.channel_connections set sync_dirty_at=clock_timestamp() where id=new.connection_id;
  end if;
  return new;
end $$;
revoke all on function public.lock_pending_channel_inventory() from public,anon,authenticated;
create trigger channel_revision_inventory_lock before insert or update on public.channel_booking_revisions
for each row execute function public.lock_pending_channel_inventory();
create or replace function public.prevent_managed_booking_overlap()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if row(new.unit_id,new.checkin_date,new.checkout_date,new.status,new.source)
      is not distinct from row(old.unit_id,old.checkin_date,old.checkout_date,old.status,old.source) then return new; end if;
  end if;
  if new.unit_id is null or new.status<>'confirmed' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('property-inventory:'||new.property_id::text,0));
  if new.source in ('manual','direct') and exists(select 1 from public.channel_booking_revisions
    where property_id=new.property_id and status='pending_mapping') then
    raise exception 'channel_sync_required';
  end if;
  if new.source in ('manual','direct') and exists(select 1 from public.channel_connections
    where property_id=new.property_id and last_error='channel_inventory_closure_failed') then
    raise exception 'channel_sync_required';
  end if;
  if new.source in ('manual','direct') and exists(select 1 from public.channel_connections
    where property_id=new.property_id and enabled and
      (last_booking_sync_at is null or last_booking_sync_at<clock_timestamp()-interval '5 minutes'
       or last_ari_sync_at is null or last_ari_sync_at<clock_timestamp()-interval '26 hours')) then
    raise exception 'channel_sync_required';
  end if;
  if new.source in ('manual','direct') and exists(select 1 from public.channel_connections
    where property_id=new.property_id and enabled and sync_lease_until>clock_timestamp()) then
    raise exception 'channel_sync_in_progress';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.unit_id::text,0));
  if new.source in ('manual','direct') and exists(select 1 from public.bookings b where b.unit_id=new.unit_id
    and b.status='confirmed' and b.id<>new.id and b.checkin_date<new.checkout_date and b.checkout_date>new.checkin_date) then
    raise exception 'booking_overlap' using errcode='23P01';
  end if;
  return new;
end $$;
revoke all on function public.prevent_managed_booking_overlap() from public,anon,authenticated;

create or replace function public.validate_channel_sync(
  p_connection_id uuid,p_lease_token uuid,p_dirty_at timestamptz,p_external_property_id text,p_environment text
) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.channel_connections where id=p_connection_id and enabled
    and sync_lease_token=p_lease_token and sync_lease_until>clock_timestamp()
    and sync_dirty_at is not distinct from p_dirty_at
    and external_property_id=p_external_property_id and environment=p_environment)
$$;
revoke all on function public.validate_channel_sync(uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.validate_channel_sync(uuid,uuid,timestamptz,text,text) to service_role;
