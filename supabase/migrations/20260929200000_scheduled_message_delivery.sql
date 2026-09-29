-- Server-owned delivery attempts. A lease prevents competing cron workers from
-- dispatching the same queue item. An uncertain provider result is never retried
-- automatically: email/SMS providers are not a distributed database transaction.
alter table public.scheduled_messages add column delivery_attempt_id uuid,
  add column delivery_lease_until timestamptz;
create table public.scheduled_message_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.scheduled_messages(id) on delete set null,
  original_message_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Preserve the logical message identity if reconciliation deletes a queue row.
  template_id uuid not null,
  channel text not null,
  state text not null check(state in ('claimed','started','accepted','rejected','unknown','aborted')),
  claimed_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  provider_id text,
  error text
);
create index scheduled_delivery_message on public.scheduled_message_delivery_attempts(message_id,claimed_at desc);
create index scheduled_delivery_identity on public.scheduled_message_delivery_attempts(booking_id,template_id,channel,claimed_at desc);
create index scheduled_delivery_property on public.scheduled_message_delivery_attempts(property_id,claimed_at desc);
alter table public.scheduled_message_delivery_attempts enable row level security;
create policy "owners read own message delivery attempts" on public.scheduled_message_delivery_attempts
  for select to authenticated using(exists(select 1 from public.properties where id=property_id and owner_id=(select auth.uid())));
revoke all on public.scheduled_message_delivery_attempts from public,anon,authenticated;
grant select on public.scheduled_message_delivery_attempts to authenticated;
grant all on public.scheduled_message_delivery_attempts to service_role;
-- Owners may cancel a queued message, but cannot forge a delivery lease or move
-- it to another booking/template. Trigger-owned lifecycle updates still work.
revoke update on public.scheduled_messages from authenticated;
grant update(status) on public.scheduled_messages to authenticated;

create or replace function public.claim_scheduled_message(p_message_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.scheduled_messages%rowtype; b public.bookings%rowtype;
  prior public.scheduled_message_delivery_attempts%rowtype; token uuid:=gen_random_uuid(); bid uuid;
begin
  select booking_id into bid from public.scheduled_messages where id=p_message_id;
  if not found then return null; end if;
  -- Same lock order as cancellation: booking first, then queue row.
  select * into b from public.bookings where id=bid for update;
  select * into m from public.scheduled_messages where id=p_message_id for update;
  if not found or m.status<>'pending' or m.send_at>clock_timestamp() then return null; end if;
  if b.status<>'confirmed' or not b.communications_enabled or coalesce(b.payment_status,'none') not in ('none','paid')
    or (b.external_id like 'sirvoy-csv:%' and b.payment_status<>'paid')
    or not exists(select 1 from public.message_templates where id=m.template_id and property_id=b.property_id and enabled) then
    return null;
  end if;
  select * into prior from public.scheduled_message_delivery_attempts
    where booking_id=b.id and template_id=m.template_id and channel=m.channel and state='accepted' limit 1;
  if found then
    update public.scheduled_messages set status='sent',sent_at=prior.finished_at,error=null,
      delivery_attempt_id=null,delivery_lease_until=null where id=m.id;
    return null;
  end if;
  if exists(select 1 from public.scheduled_message_delivery_attempts
    where booking_id=b.id and template_id=m.template_id and channel=m.channel and state='unknown') then
    update public.scheduled_messages set status='failed',error='Leveransresultatet är osäkert. Kontrollera leverantören före nytt utskick.' where id=m.id;
    return null;
  end if;
  select * into prior from public.scheduled_message_delivery_attempts
    where booking_id=b.id and template_id=m.template_id and channel=m.channel and state in ('claimed','started')
    order by claimed_at desc limit 1 for update;
  if found then
    if prior.lease_until>clock_timestamp() then return null; end if;
    if prior.state='started' then
      update public.scheduled_message_delivery_attempts set state='unknown',finished_at=clock_timestamp(),error='worker_lease_expired_after_dispatch' where id=prior.id;
      update public.scheduled_messages set status='failed',delivery_attempt_id=null,delivery_lease_until=null,
        error='Leveransresultatet är osäkert. Kontrollera leverantören före nytt utskick.' where id=m.id;
      return null;
    elsif prior.state='claimed' then
      update public.scheduled_message_delivery_attempts set state='aborted',finished_at=clock_timestamp(),error='worker_lease_expired_before_dispatch' where id=prior.id;
    end if;
  end if;
  insert into public.scheduled_message_delivery_attempts(id,message_id,original_message_id,booking_id,property_id,template_id,channel,state,lease_until)
    values(token,m.id,m.id,b.id,b.property_id,m.template_id,m.channel,'claimed',clock_timestamp()+interval '5 minutes');
  update public.scheduled_messages set delivery_attempt_id=token,delivery_lease_until=clock_timestamp()+interval '5 minutes' where id=m.id;
  return jsonb_build_object('message_id',m.id,'attempt_id',token);
end $$;
revoke all on function public.claim_scheduled_message(uuid) from public,anon,authenticated;
grant execute on function public.claim_scheduled_message(uuid) to service_role;

create or replace function public.begin_scheduled_message(p_message_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.scheduled_messages%rowtype; b public.bookings%rowtype;
  t public.message_templates%rowtype; p public.properties%rowtype; unit_name text; bid uuid;
begin
  select booking_id into bid from public.scheduled_messages where id=p_message_id;
  if not found then return null; end if;
  select * into b from public.bookings where id=bid for update;
  select * into m from public.scheduled_messages where id=p_message_id for update;
  if not found or m.delivery_attempt_id is distinct from p_attempt_id or m.delivery_lease_until is null or m.delivery_lease_until<=clock_timestamp()
    or m.status<>'pending' or m.send_at>clock_timestamp() then return null; end if;
  select * into t from public.message_templates where id=m.template_id and property_id=b.property_id and enabled;
  if not found or b.status<>'confirmed' or not b.communications_enabled
    or coalesce(b.payment_status,'none') not in ('none','paid')
    or (b.external_id like 'sirvoy-csv:%' and b.payment_status<>'paid') then return null; end if;
  select * into p from public.properties where id=b.property_id;
  select name into unit_name from public.units where id=b.unit_id and property_id=b.property_id;
  update public.scheduled_message_delivery_attempts set state='started',started_at=clock_timestamp()
    where id=p_attempt_id and state='claimed';
  if not found then return null; end if;
  -- Authorization is checked again at dispatch, using current booking/contact and
  -- template data. Cancellation after this transaction is an in-flight delivery.
  return jsonb_build_object('message_id',m.id,'attempt_id',p_attempt_id,'channel',m.channel,'send_at',m.send_at,
    'template',jsonb_build_object('subject',t.subject,'body',t.body),
    'booking',jsonb_build_object('id',b.id,'status',b.status,'communications_enabled',b.communications_enabled,
      'external_id',b.external_id,'payment_status',b.payment_status,'guest_name',b.guest_name,'guest_email',b.guest_email,
      'guest_phone',b.guest_phone,'guest_token',b.guest_token,'checkin_date',b.checkin_date,'checkout_date',b.checkout_date,
      'unit',jsonb_build_object('name',unit_name),
      'property',jsonb_build_object('name',p.name,'checkin_time',p.checkin_time,'checkout_time',p.checkout_time,
        'directions',p.directions,'wifi_name',p.wifi_name,'wifi_password',p.wifi_password,'contact_phone',p.contact_phone,'review_url',p.review_url)));
end $$;
revoke all on function public.begin_scheduled_message(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_scheduled_message(uuid,uuid) to service_role;

create or replace function public.finish_scheduled_message(p_message_id uuid,p_attempt_id uuid,p_state text,p_error text default null,p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.scheduled_message_delivery_attempts%rowtype;
begin
  if p_state is null or p_state not in ('accepted','rejected','unknown','aborted') then raise exception 'invalid_delivery_state'; end if;
  perform 1 from public.scheduled_messages where id=p_message_id for update;
  select * into a from public.scheduled_message_delivery_attempts where id=p_attempt_id for update;
  if not found or a.original_message_id<>p_message_id then return false; end if;
  if a.state not in ('claimed','started','unknown') then return a.state=p_state; end if;
  if p_state='accepted' and a.state='claimed' then return false; end if;
  update public.scheduled_message_delivery_attempts set state=p_state,finished_at=clock_timestamp(),
    error=nullif(left(p_error,500),''),provider_id=nullif(left(p_provider_id,255),'') where id=a.id;
  update public.scheduled_messages set
    status=case when status<>'pending' then status when p_state='accepted' then 'sent'
      when p_state in ('rejected','unknown') then 'failed' else 'pending' end,
    sent_at=case when p_state='accepted' then clock_timestamp() else sent_at end,
    error=case when status<>'pending' then error else nullif(left(p_error,500),'') end,
    delivery_attempt_id=null,delivery_lease_until=null
    where id=p_message_id and delivery_attempt_id=p_attempt_id;
  return true;
end $$;
revoke all on function public.finish_scheduled_message(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_scheduled_message(uuid,uuid,text,text,text) to service_role;
