-- StayBoost BP-3: server-owned, auditable payment lifecycle.
-- Additiv migration: inga priser eller affärsregler ändras.

-- ============================================================
-- Payment states + audit timestamps
-- ============================================================
alter table public.bookings
  drop constraint if exists bookings_payment_status_check;

alter table public.bookings
  add constraint bookings_payment_status_check
  check (payment_status in ('none', 'pending', 'paid', 'refund_pending', 'refunded', 'expired'));

alter table public.bookings
  add column if not exists payment_paid_at timestamptz,
  add column if not exists payment_refund_requested_at timestamptz,
  add column if not exists payment_refunded_at timestamptz,
  add column if not exists payment_expired_at timestamptz,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_refund_id text;

create unique index if not exists bookings_stripe_session_unique
  on public.bookings (stripe_session_id)
  where stripe_session_id is not null;

-- Stripe levererar webhooks at-least-once. Tabellen ger ett beständigt audit-spår
-- och gör retry/duplicate-resultat synligt utan att lagra hela Stripe-payloaden.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text,
  last_error text
);

alter table public.stripe_webhook_events enable row level security;
-- Endast service-role (stripe-webhook) ska läsa/skriva event-ledgern.
revoke all on table public.stripe_webhook_events from anon, authenticated;

-- ============================================================
-- Browserklienten får ändra vanliga bokningsdetaljer men aldrig betalningssanning.
-- En pending payment-hold får inte heller avbokas direkt från browsern: den måste
-- gå genom payment-action så Stripe/Swish-state och inventory ändras tillsammans.
-- Edge Functions använder service_role och passerar därför denna spärr.
-- ============================================================
create or replace function public.protect_payment_lifecycle_from_clients()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  request_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if request_role <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.payment_status <> 'none'
       or new.payment_method <> 'none'
       or new.payment_amount is not null
       or new.payment_ref is not null
       or new.payment_expires_at is not null
       or new.stripe_session_id is not null then
      raise exception 'payment_lifecycle_server_only' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.payment_status is distinct from old.payment_status
     or new.payment_method is distinct from old.payment_method
     or new.payment_amount is distinct from old.payment_amount
     or new.payment_ref is distinct from old.payment_ref
     or new.payment_expires_at is distinct from old.payment_expires_at
     or new.stripe_session_id is distinct from old.stripe_session_id
     or new.payment_paid_at is distinct from old.payment_paid_at
     or new.payment_refund_requested_at is distinct from old.payment_refund_requested_at
     or new.payment_refunded_at is distinct from old.payment_refunded_at
     or new.payment_expired_at is distinct from old.payment_expired_at
     or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
     or new.stripe_refund_id is distinct from old.stripe_refund_id
     or (old.payment_status = 'pending' and new.status is distinct from old.status) then
    raise exception 'payment_lifecycle_server_only' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_protect_payment_lifecycle on public.bookings;
create trigger bookings_protect_payment_lifecycle
  before insert or update on public.bookings
  for each row execute function public.protect_payment_lifecycle_from_clients();

-- ============================================================
-- Atomär fallback för utgångna betalningsreservationer.
-- BP-4 kopplar scheduler/observability till funktionen; den exponeras inte för klienten.
-- ============================================================
create or replace function public.expire_pending_payment_holds(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.bookings
  set status = 'cancelled',
      payment_status = 'expired',
      payment_expired_at = coalesce(payment_expired_at, p_now),
      payment_expires_at = null
  where status = 'confirmed'
    and payment_status = 'pending'
    and payment_expires_at is not null
    and payment_expires_at <= p_now;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_pending_payment_holds(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_pending_payment_holds(timestamptz) to service_role;
