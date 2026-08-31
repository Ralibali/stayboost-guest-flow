-- StayBoost SaaS billing foundation.
-- Separate from guest booking payments: this table tracks the property owner's
-- StayBoost subscription only. Client users may read their own row but can
-- never mutate billing state directly.

create table if not exists public.account_subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'inactive' check (
    status in (
      'inactive',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    )
  ),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_subscriptions enable row level security;

drop policy if exists "Owners read own subscription" on public.account_subscriptions;
create policy "Owners read own subscription"
  on public.account_subscriptions
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.account_subscriptions to authenticated;
revoke insert, update, delete on public.account_subscriptions from anon, authenticated;

create table if not exists public.saas_billing_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.saas_billing_events enable row level security;
revoke all on public.saas_billing_events from anon, authenticated;

comment on table public.account_subscriptions is
  'Server-owned Stripe subscription state for StayBoost SaaS customers. Never used for guest booking payments.';
comment on table public.saas_billing_events is
  'Server-only Stripe webhook idempotency ledger for StayBoost SaaS billing.';
