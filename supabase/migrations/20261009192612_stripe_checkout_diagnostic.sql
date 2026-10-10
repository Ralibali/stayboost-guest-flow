-- Durable recovery for an explicit owner-only, unpaid Stripe connection check.
-- No customer data, Checkout URLs, provider responses, or booking references.
create table public.stripe_checkout_diagnostic_attempts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  actor_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  checked_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  key_fingerprint text not null check (key_fingerprint ~ '^[a-f0-9]{64}$'),
  livemode boolean not null,
  api_version text not null default '2026-08-26.dahlia',
  request_body jsonb not null check (jsonb_typeof(request_body) = 'object'),
  idempotency_key text not null unique,
  expires_at bigint not null,
  session_id text check (session_id ~ '^cs_(live|test)_[A-Za-z0-9]+$'),
  outcome text not null default 'create_not_confirmed' check (outcome in (
    'create_and_expire_confirmed','authentication_failed','permission_denied',
    'create_not_confirmed','expiry_not_confirmed','attempt_requires_followup'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_id uuid,
  lease_until timestamptz,
  check ((lease_id is null) = (lease_until is null)),
  check (outcome <> 'create_and_expire_confirmed' or session_id is not null)
);
create unique index stripe_checkout_diagnostic_one_unfinished
  on public.stripe_checkout_diagnostic_attempts(property_id) where completed_at is null;
create index stripe_checkout_diagnostic_recent
  on public.stripe_checkout_diagnostic_attempts(property_id, created_at desc);
alter table public.stripe_checkout_diagnostic_attempts enable row level security;
revoke all on public.stripe_checkout_diagnostic_attempts from public, anon, authenticated;
grant select, insert, update on public.stripe_checkout_diagnostic_attempts to service_role;

-- The property lock serializes simultaneous first clicks. A lease avoids two
-- active HTTP workers; recovery always uses the SAME frozen body and key.
create function public.claim_stripe_checkout_diagnostic(
  p_actor uuid, p_property uuid, p_key_fingerprint text, p_livemode boolean,
  p_payment_method_configuration text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v public.stripe_checkout_diagnostic_attempts%rowtype;
  v_now timestamptz := clock_timestamp();
  v_id uuid;
  v_expiry bigint;
  v_body jsonb;
begin
  perform 1 from public.properties where id=p_property and owner_id=p_actor for update;
  if not found then raise exception 'not_authorized'; end if;
  v_now := clock_timestamp();
  if p_key_fingerprint is null or p_key_fingerprint !~ '^[a-f0-9]{64}$'
    or p_livemode is null
    or (p_payment_method_configuration is not null
      and p_payment_method_configuration !~ '^pmc_[A-Za-z0-9]+$')
  then raise exception 'diagnostic_configuration_invalid'; end if;
  select * into v from public.stripe_checkout_diagnostic_attempts
    where property_id=p_property and completed_at is null for update;
  if found then
    if v.key_fingerprint <> p_key_fingerprint or v.livemode <> p_livemode then
      return jsonb_build_object('state','configuration_changed');
    end if;
    if v.lease_until > v_now then return jsonb_build_object('state','in_progress'); end if;
    -- Stripe may prune idempotency keys after 24h. Never replay an unknown
    -- creation at/after 23h, and never abandon it to start a fresh attempt.
    if v.session_id is null and v.created_at <= v_now - interval '23 hours' then
      return jsonb_build_object('state','attempt_requires_followup');
    end if;
  else
    select * into v from public.stripe_checkout_diagnostic_attempts
      where property_id=p_property and completed_at is not null
      order by created_at desc limit 1;
    if found and v.key_fingerprint=p_key_fingerprint
      and ((v.outcome='create_and_expire_confirmed' and v.checked_at>v_now-interval '1 hour')
        or v.checked_at>v_now-interval '1 minute') then
      return jsonb_build_object('state','cached','status',v.outcome,'checkedAt',v.checked_at);
    end if;
    v_id := gen_random_uuid();
    v_expiry := floor(extract(epoch from v_now))::bigint + 1860;
    -- Freeze the exact form fields once. No caller-controlled amount, URL,
    -- customer, email, booking reference, recovery link, or payment data.
    v_body := jsonb_build_object(
      'mode','payment',
      'success_url','https://stayboost.se/app/startklart',
      'cancel_url','https://stayboost.se/app/startklart',
      'integration_identifier','stayboost-checkout-check-kynrptlz',
      'adaptive_pricing[enabled]','false',
      'after_expiration[recovery][enabled]','false',
      'customer_creation','if_required',
      'invoice_creation[enabled]','false',
      'line_items[0][quantity]','1',
      'line_items[0][price_data][currency]','sek',
      'line_items[0][price_data][unit_amount]','1000',
      'line_items[0][price_data][product_data][name]','StayBoost connection check - no booking',
      'metadata[stayboost_diagnostic]',v_id::text,
      'metadata[property_id]',p_property::text,
      'expires_at',v_expiry::text
    );
    if p_payment_method_configuration is not null then
      v_body := v_body || jsonb_build_object('payment_method_configuration',p_payment_method_configuration);
    end if;
    insert into public.stripe_checkout_diagnostic_attempts
      (id,property_id,actor_id,created_at,checked_at,key_fingerprint,livemode,
       request_body,idempotency_key,expires_at)
      values(v_id,p_property,p_actor,v_now,v_now,p_key_fingerprint,p_livemode,
       v_body,'stayboost-checkout-check:v1:'||v_id::text,v_expiry) returning * into v;
  end if;
  update public.stripe_checkout_diagnostic_attempts
    set lease_id=gen_random_uuid(),lease_until=v_now+interval '30 seconds',
      attempt_count=attempt_count+1
    where id=v.id returning * into v;
  return jsonb_build_object('state','claimed','attempt',to_jsonb(v));
end $$;

-- Null outcome checkpoints the internal session ID without releasing the
-- worker lease. A stale worker cannot overwrite a newer confirmed result.
create function public.finish_stripe_checkout_diagnostic(
  p_attempt uuid, p_lease uuid, p_session text, p_outcome text default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v public.stripe_checkout_diagnostic_attempts%rowtype;
begin
  select * into v from public.stripe_checkout_diagnostic_attempts
    where id=p_attempt and lease_id=p_lease and completed_at is null for update;
  if not found then return false; end if;
  if p_session is not null and (p_session !~ '^cs_(live|test)_[A-Za-z0-9]+$'
    or (v.session_id is not null and v.session_id<>p_session)
    or (v.livemode and p_session !~ '^cs_live_')
    or (not v.livemode and p_session !~ '^cs_test_'))
  then raise exception 'diagnostic_session_mismatch'; end if;
  if p_outcome is not null and p_outcome not in (
    'create_and_expire_confirmed','authentication_failed','permission_denied',
    'create_not_confirmed','expiry_not_confirmed','attempt_requires_followup'
  ) then raise exception 'diagnostic_outcome_invalid'; end if;
  if p_outcome='create_and_expire_confirmed' and coalesce(p_session,v.session_id) is null
    then raise exception 'diagnostic_session_missing'; end if;
  update public.stripe_checkout_diagnostic_attempts set
    session_id=coalesce(p_session,session_id),
    outcome=coalesce(p_outcome,outcome),
    checked_at=case when p_outcome is null then checked_at else clock_timestamp() end,
    completed_at=case
      when p_outcome='create_and_expire_confirmed' then clock_timestamp()
      -- An auth denial after an earlier unknown request cannot prove the
      -- earlier request never created a session. Keep that attempt unresolved.
      when p_outcome in ('authentication_failed','permission_denied')
        and attempt_count=1 and coalesce(p_session,session_id) is null then clock_timestamp()
      else null end,
    lease_id=case when p_outcome is null then lease_id else null end,
    lease_until=case when p_outcome is null then lease_until else null end
    where id=v.id;
  return true;
end $$;
revoke all on function public.claim_stripe_checkout_diagnostic(uuid,uuid,text,boolean,text)
  from public,anon,authenticated;
revoke all on function public.finish_stripe_checkout_diagnostic(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_stripe_checkout_diagnostic(uuid,uuid,text,boolean,text)
  to service_role;
grant execute on function public.finish_stripe_checkout_diagnostic(uuid,uuid,text,text)
  to service_role;
