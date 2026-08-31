-- StayBoost platform-owner admin.
-- This is deliberately separate from customer/operator access. The browser can
-- never grant itself platform access; only service-role/server-side tooling may
-- manage platform_admins.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);

alter table public.platform_admins enable row level security;

revoke all on table public.platform_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_admins to service_role;

comment on table public.platform_admins is
  'Server-managed allowlist for StayBoost platform-owner administration. Never exposed directly to authenticated clients.';
