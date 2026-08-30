-- StayBoost BP-4: cron coordination + operational observability.
-- Additiv migration. Inga priser, bokningsregler eller channel-manager-gränser ändras.

-- ============================================================
-- Global job heartbeat/lock state.
-- Klienten får endast läsa ofarliga tidsstämplar. last_error, last_summary och
-- lease-fält kan innehålla interna/integrationsspecifika detaljer och är service-role-only.
-- ============================================================
create table if not exists public.ops_job_state (
  job_name text primary key,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  last_summary jsonb not null default '{}'::jsonb,
  lock_token uuid,
  lock_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.ops_job_state enable row level security;
revoke all on table public.ops_job_state from anon, authenticated;
grant select (job_name, last_started_at, last_succeeded_at, last_failed_at, updated_at)
  on table public.ops_job_state to authenticated;

drop policy if exists "Authenticated read scheduler health" on public.ops_job_state;
create policy "Authenticated read scheduler health"
  on public.ops_job_state
  for select
  to authenticated
  using (true);

-- Atomärt lease-lås så dubbla pg_cron/HTTP-anrop inte kör samma globala
-- orchestration samtidigt. Defaultleasen är längre än 5-minutersschemat;
-- ett kraschat jobb självläker när leasen löper ut.
create or replace function public.ops_claim_cron_run(
  p_run_id uuid,
  p_ttl_seconds integer default 360
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
  ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 360), 600));
begin
  insert into public.ops_job_state (job_name)
  values ('ops-cron')
  on conflict (job_name) do nothing;

  update public.ops_job_state
  set lock_token = p_run_id,
      lock_expires_at = now() + (ttl::text || ' seconds')::interval,
      last_started_at = now(),
      updated_at = now()
  where job_name = 'ops-cron'
    and (
      lock_expires_at is null
      or lock_expires_at <= now()
      or lock_token = p_run_id
    );

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.ops_release_cron_run(p_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ops_job_state
  set lock_token = null,
      lock_expires_at = null,
      updated_at = now()
  where job_name = 'ops-cron' and lock_token = p_run_id;
$$;

revoke all on function public.ops_claim_cron_run(uuid, integer) from public, anon, authenticated;
revoke all on function public.ops_release_cron_run(uuid) from public, anon, authenticated;
grant execute on function public.ops_claim_cron_run(uuid, integer) to service_role;
grant execute on function public.ops_release_cron_run(uuid) to service_role;

-- ============================================================
-- Ägarspecifika, deduplicerade driftlarm.
-- Samma fingerprint uppdateras i stället för att skapa notisspam var 5:e minut.
-- ============================================================
create table if not exists public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  fingerprint text not null,
  code text not null,
  severity text not null check (severity in ('warning', 'critical')),
  title text not null,
  detail text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (property_id, fingerprint)
);

create index if not exists operational_alerts_open
  on public.operational_alerts (property_id, severity, last_seen_at desc)
  where resolved_at is null;

alter table public.operational_alerts enable row level security;
revoke all on table public.operational_alerts from anon, authenticated;
grant select on table public.operational_alerts to authenticated;

drop policy if exists "Owners read own operational alerts" on public.operational_alerts;
create policy "Owners read own operational alerts"
  on public.operational_alerts
  for select
  to authenticated
  using (public.owns_property(property_id));

-- Index för BP-4:s små, frekventa health scans.
create index if not exists bookings_payment_ops
  on public.bookings (payment_status, payment_expires_at)
  where payment_status in ('pending', 'refund_pending');

create index if not exists stripe_webhook_events_unresolved
  on public.stripe_webhook_events (received_at)
  where processed_at is null or last_error is not null;

create index if not exists scheduled_messages_failed_recent
  on public.scheduled_messages (send_at desc)
  where status = 'failed';
