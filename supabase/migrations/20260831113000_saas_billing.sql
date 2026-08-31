-- StayBoost BP-5: SaaS subscription state.
-- Customer-facing writes are intentionally server-only; authenticated owners may only read their row.

create table if not exists public.billing_accounts (
  owner_id uuid primary key,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text,
  status text not null default 'inactive'
    check (status in ('inactive','incomplete','incomplete_expired','trialing','active','past_due','unpaid','paused','canceled')),
  plan_interval text check (plan_interval in ('month','year')),
  unit_amount integer,
  currency text not null default 'sek' check (currency = 'sek'),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_accounts enable row level security;

drop policy if exists "Owners read own billing account" on public.billing_accounts;
create policy "Owners read own billing account"
  on public.billing_accounts
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

revoke all on table public.billing_accounts from anon;
revoke insert, update, delete on table public.billing_accounts from authenticated;
grant select on table public.billing_accounts to authenticated;

comment on table public.billing_accounts is
  'Server-owned Stripe subscription state for StayBoost SaaS. SMS is included in the subscription and is never metered here.';
comment on column public.billing_accounts.unit_amount is
  'Subscription list price in öre excluding VAT. 44900/month or 449000/year.';
