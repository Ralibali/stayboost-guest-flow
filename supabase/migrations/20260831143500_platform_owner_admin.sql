-- StayBoost platform-owner admin.
-- This is deliberately separate from customer/operator access. The browser can
-- never grant itself platform access; only service-role/server-side tooling may
-- manage platform_admins.

alter table public.account_subscriptions
  add column if not exists plan_interval text check (plan_interval in ('month', 'year')),
  add column if not exists unit_amount integer check (unit_amount is null or unit_amount >= 0),
  add column if not exists currency text;

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
comment on column public.account_subscriptions.plan_interval is
  'Normalized StayBoost billing interval persisted from Stripe for platform reporting.';
comment on column public.account_subscriptions.unit_amount is
  'Subscription list price in minor currency units, persisted from Stripe.';
