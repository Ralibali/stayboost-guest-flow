-- Change-driven ARI outbox and provider-acknowledged baseline, never client writable.
alter table public.channel_connections add column ari_horizon_date date;
create table public.channel_ari_state (
  connection_id uuid primary key references public.channel_connections(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  external_property_id text not null,
  environment text not null check(environment in ('staging','production')),
  acknowledged_snapshot jsonb,
  acknowledged_at timestamptz,
  last_receipts jsonb,
  pending_snapshot jsonb,
  pending_payload jsonb,
  pending_dirty_at timestamptz,
  pending_from date,
  prepared_at timestamptz,
  recovery_required boolean not null default false
);
alter table public.channel_ari_state enable row level security;
revoke all on public.channel_ari_state from public,anon,authenticated;
grant all on public.channel_ari_state to service_role;

create or replace function public.prepare_channel_ari(
  p_connection_id uuid,p_lease_token uuid,p_dirty_at timestamptz,p_external_property_id text,p_environment text,
  p_snapshot jsonb,p_payload jsonb,p_from date
) returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.channel_connections%rowtype;
begin
  select * into c from public.channel_connections where id=p_connection_id for update;
  if not found or not c.enabled or c.sync_lease_token is distinct from p_lease_token
    or c.sync_lease_until is null or c.sync_lease_until<=clock_timestamp()
    or c.sync_dirty_at is distinct from p_dirty_at
    or c.external_property_id is distinct from p_external_property_id or c.environment is distinct from p_environment then return false; end if;
  if jsonb_typeof(p_snapshot->'availability') is distinct from 'array' or jsonb_typeof(p_snapshot->'restrictions') is distinct from 'array'
    or jsonb_typeof(p_payload->'availability') is distinct from 'array' or jsonb_typeof(p_payload->'restrictions') is distinct from 'array'
    or p_from is null then raise exception 'invalid_channel_ari'; end if;
  if exists(select 1 from jsonb_array_elements((p_snapshot->'availability')||(p_snapshot->'restrictions')||(p_payload->'availability')||(p_payload->'restrictions')) v
    where v->>'property_id' is distinct from c.external_property_id) then raise exception 'channel_ari_property_mismatch'; end if;
  insert into public.channel_ari_state(connection_id,property_id,external_property_id,environment,pending_snapshot,pending_payload,pending_dirty_at,pending_from,prepared_at)
    values(c.id,c.property_id,c.external_property_id,c.environment,p_snapshot,p_payload,p_dirty_at,p_from,clock_timestamp())
    on conflict(connection_id) do update set property_id=excluded.property_id,external_property_id=excluded.external_property_id,environment=excluded.environment,
      pending_snapshot=excluded.pending_snapshot,pending_payload=excluded.pending_payload,
      pending_dirty_at=excluded.pending_dirty_at,pending_from=excluded.pending_from,prepared_at=excluded.prepared_at;
  return true;
end $$;
revoke all on function public.prepare_channel_ari(uuid,uuid,timestamptz,text,text,jsonb,jsonb,date) from public,anon,authenticated;
grant execute on function public.prepare_channel_ari(uuid,uuid,timestamptz,text,text,jsonb,jsonb,date) to service_role;

create or replace function public.acknowledge_channel_ari(
  p_connection_id uuid,p_lease_token uuid,p_dirty_at timestamptz,p_external_property_id text,p_environment text,p_receipts jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.channel_connections%rowtype; s public.channel_ari_state%rowtype;
begin
  select * into c from public.channel_connections where id=p_connection_id for update;
  if not found or not c.enabled or c.sync_lease_token is distinct from p_lease_token
    or c.sync_lease_until is null or c.sync_lease_until<=clock_timestamp()
    or c.sync_dirty_at is distinct from p_dirty_at
    or c.external_property_id is distinct from p_external_property_id or c.environment is distinct from p_environment then return false; end if;
  select * into s from public.channel_ari_state where connection_id=c.id for update;
  if not found or s.property_id is distinct from c.property_id or s.pending_snapshot is null or s.pending_payload is null
    or s.pending_dirty_at is distinct from p_dirty_at or s.external_property_id is distinct from p_external_property_id
    or s.environment is distinct from p_environment then return false; end if;
  update public.channel_ari_state set acknowledged_snapshot=pending_snapshot,acknowledged_at=clock_timestamp(),last_receipts=p_receipts,
    pending_snapshot=null,pending_payload=null,pending_dirty_at=null,pending_from=null,prepared_at=null,recovery_required=false where connection_id=c.id;
  -- Baseline, freshness, exact dirty CAS and lease release commit together.
  update public.channel_connections set last_ari_sync_at=clock_timestamp(),ari_horizon_date=s.pending_from,
    sync_dirty_at=null,sync_failures=0,next_retry_at=null,last_error=null,sync_lease_token=null,sync_lease_until=null where id=c.id;
  return true;
end $$;
revoke all on function public.acknowledge_channel_ari(uuid,uuid,timestamptz,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.acknowledge_channel_ari(uuid,uuid,timestamptz,text,text,jsonb) to service_role;

create or replace function public.invalidate_channel_ari(p_connection_id uuid,p_lease_token uuid,p_external_property_id text,p_environment text,p_full boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.channel_connections%rowtype;
begin
  select * into c from public.channel_connections where id=p_connection_id for update;
  if not found or c.sync_lease_token is distinct from p_lease_token
    or c.external_property_id is distinct from p_external_property_id or c.environment is distinct from p_environment then return false; end if;
  update public.channel_ari_state set recovery_required=true,
    acknowledged_snapshot=case when p_full then null else acknowledged_snapshot end,
    pending_snapshot=case when p_full then null else pending_snapshot end,
    pending_payload=case when p_full then null else pending_payload end where connection_id=c.id;
  update public.channel_connections set sync_dirty_at=case when p_full then coalesce(sync_dirty_at,clock_timestamp()) else sync_dirty_at end,ari_horizon_date=null,
    last_ari_sync_at=null where id=c.id;
  return true;
end $$;
revoke all on function public.invalidate_channel_ari(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.invalidate_channel_ari(uuid,uuid,text,text,boolean) to service_role;

create or replace function private.invalidate_changed_channel_ari()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(new.property_id,new.external_property_id,new.environment,new.enabled) is distinct from row(old.property_id,old.external_property_id,old.environment,old.enabled)
    or (old.verified_at is not null and new.verified_at is null) then
    delete from public.channel_ari_state where connection_id=new.id;
    update public.channel_connections set ari_horizon_date=null,last_ari_sync_at=null where id=new.id;
  end if;
  return null;
end $$;
revoke all on function private.invalidate_changed_channel_ari() from public,anon,authenticated;
create trigger channel_ari_identity_reset after update on public.channel_connections for each row execute function private.invalidate_changed_channel_ari();
