-- StayBoost production cron auth without committing a raw secret.
-- The raw secret lives only in Supabase Vault. Edge Functions validate it
-- against this service-role-only SHA-256 verifier.

create table if not exists public.ops_runtime_auth (
  key text primary key,
  secret_sha256 text not null check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.ops_runtime_auth enable row level security;
revoke all on table public.ops_runtime_auth from public, anon, authenticated;
grant select on table public.ops_runtime_auth to service_role;

create or replace function public.verify_ops_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_secret is not null
    and exists (
      select 1
      from public.ops_runtime_auth
      where key = 'cron'
        and secret_sha256 = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    );
$$;

revoke all on function public.verify_ops_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_ops_cron_secret(text) to service_role;
