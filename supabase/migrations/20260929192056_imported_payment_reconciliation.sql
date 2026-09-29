-- Imported payments are owner attestation, not a new charge or a provider webhook.
create table public.imported_payment_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in ('record_payment','record_refund')),
  amount_sek integer not null check(amount_sek between 1 and 10000000),
  occurred_at timestamptz not null,
  evidence text not null check(length(trim(evidence)) between 3 and 1000),
  created_at timestamptz not null default now(),
  unique(booking_id,action)
);
create index imported_payment_events_property on public.imported_payment_events(property_id,created_at desc);
create index imported_payment_events_actor on public.imported_payment_events(actor_id);
alter table public.imported_payment_events enable row level security;
create policy "owners read imported payment evidence" on public.imported_payment_events for select to authenticated
using(exists(select 1 from public.properties where id=property_id and owner_id=(select auth.uid())));
revoke all on public.imported_payment_events from public,anon,authenticated,service_role;
grant select on public.imported_payment_events to authenticated;
grant select,insert on public.imported_payment_events to service_role;

alter table public.bookings add column communications_enabled boolean not null default true;
create or replace function public.protect_import_origin()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')='authenticated' then
    if (tg_op='INSERT' and new.external_id is not null) or (tg_op='UPDATE' and new.external_id is distinct from old.external_id) then
      raise exception 'booking_source_server_only' using errcode='42501';
    end if;
  end if;
  if tg_op='INSERT' and new.external_id like 'sirvoy-csv:%' then new.communications_enabled:=false; end if;
  if new.external_id like 'sirvoy-csv:%' then
    if new.status='cancelled' then new.communications_enabled:=false;
    elsif new.communications_enabled and new.payment_status<>'paid' then
      raise exception 'imported_payment_required';
    end if;
  end if;
  if tg_op='UPDATE' and new.external_id like 'sirvoy-csv:%' and new.payment_method='none'
    and old.payment_status='paid' and old.status<>'cancelled' and new.status='cancelled' then
    new.payment_status:='refund_pending'; new.payment_refund_requested_at:=clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.protect_import_origin() from public,anon,authenticated;
create trigger bookings_import_origin before insert or update on public.bookings for each row execute function public.protect_import_origin();

create or replace function public.reconcile_imported_payment(
  p_actor uuid,p_booking uuid,p_action text,p_amount integer,p_occurred_at timestamptz,p_evidence text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype; event public.imported_payment_events%rowtype;
begin
  select * into b from public.bookings where id=p_booking for update;
  if not found or not exists(select 1 from public.properties where id=b.property_id and owner_id=p_actor) then
    raise exception 'booking_not_found' using errcode='42501';
  end if;
  if b.external_id not like 'sirvoy-csv:%' or b.external_id is null or b.source<>'manual' or b.payment_method<>'none' then
    raise exception 'not_imported_payment';
  end if;
  if p_action is null or p_action not in ('record_payment','record_refund') or p_amount is null or p_amount not between 1 and 10000000
    or p_occurred_at is null or p_occurred_at>clock_timestamp()+interval '5 minutes'
    or p_evidence is null or length(trim(p_evidence)) not between 3 and 1000 then raise exception 'invalid_payment_evidence'; end if;
  if b.payment_amount is not null and p_amount<>b.payment_amount then raise exception 'payment_amount_mismatch'; end if;
  select * into event from public.imported_payment_events where booking_id=b.id and action=p_action;
  if found then
    if event.amount_sek<>p_amount or event.occurred_at<>p_occurred_at or event.evidence<>trim(p_evidence) then raise exception 'payment_already_recorded'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'payment_status',b.payment_status,'event_id',event.id);
  end if;
  if p_action='record_payment' then
    if b.payment_status<>'none' or p_occurred_at>b.created_at then raise exception 'invalid_import_payment_state'; end if;
    update public.bookings set payment_status=case when status='cancelled' then 'refund_pending' else 'paid' end,
      payment_amount=p_amount,payment_paid_at=p_occurred_at,
      payment_refund_requested_at=case when status='cancelled' then clock_timestamp() else null end where id=b.id;
  else
    if b.status<>'cancelled' or b.payment_status<>'refund_pending' or b.payment_paid_at is null or p_occurred_at<b.payment_paid_at then
      raise exception 'invalid_import_refund_state';
    end if;
    update public.bookings set payment_status='refunded',payment_refunded_at=p_occurred_at where id=b.id;
  end if;
  insert into public.imported_payment_events(property_id,booking_id,actor_id,action,amount_sek,occurred_at,evidence)
    values(b.property_id,b.id,p_actor,p_action,p_amount,p_occurred_at,trim(p_evidence)) returning * into event;
  return jsonb_build_object('ok',true,'duplicate',false,'payment_status',(select payment_status from public.bookings where id=b.id),'event_id',event.id);
end $$;
revoke all on function public.reconcile_imported_payment(uuid,uuid,text,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function public.reconcile_imported_payment(uuid,uuid,text,integer,timestamptz,text) to service_role;

create or replace function public.generate_booking_messages()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_send timestamptz;
  v_channel text;
begin
  -- Avbokning: släck det som inte hunnit skickas
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    update scheduled_messages set status = 'cancelled'
      where booking_id = new.id and status = 'pending';
    return new;
  end if;

  if not new.communications_enabled then
    update public.scheduled_messages set status='cancelled',error='communications_paused_by_owner'
      where booking_id=new.id and status='pending';
    return new;
  end if;

  if new.status <> 'confirmed' then
    return new;
  end if;

  -- Datumändring: räkna om det som ännu inte skickats
  if tg_op = 'UPDATE'
     and (new.checkin_date <> old.checkin_date or new.checkout_date <> old.checkout_date) then
    delete from scheduled_messages where booking_id = new.id and status = 'pending';
  end if;

  for t in
    select * from message_templates
    where property_id = new.property_id and enabled
  loop
    if new.external_id like 'sirvoy-csv:%' and t.trigger_type='booking_created' then continue; end if;
    v_send := case t.trigger_type
      when 'booking_created' then now()
      when 'pre_arrival' then
        ((new.checkin_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
      when 'checkin_day' then
        ((new.checkin_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
      when 'post_stay' then
        ((new.checkout_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
    end;

    -- Sen import (t.ex. iCal mitt under vistelse): spamma inte gästen
    -- med förfallna meddelanden. booking_created skickas dock alltid.
    if (new.external_id like 'sirvoy-csv:%' and v_send<now())
      or (t.trigger_type <> 'booking_created' and v_send < now() - interval '1 hour') then
      continue;
    end if;

    foreach v_channel in array
      (case t.channel when 'both' then array['email','sms'] else array[t.channel] end)
    loop
      insert into scheduled_messages (booking_id, template_id, channel, send_at)
      values (new.id, t.id, v_channel, v_send)
      on conflict (booking_id, template_id, channel) do update set send_at=excluded.send_at,status='pending',error=null
        where public.scheduled_messages.status='cancelled'
          and (public.scheduled_messages.error='communications_paused_by_owner'
            or public.scheduled_messages.error like 'Sirvoy import:%');
    end loop;
  end loop;

  return new;
end $$;


-- Guest Journey lifecycle hardening.
-- Keep the existing booking -> scheduled_messages engine as the source of truth,
-- but reconcile future queued messages whenever a lifecycle template changes.

create or replace function public.reconcile_journey_template_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.message_templates%rowtype;
  b record;
  v_send timestamptz;
  v_channel text;
begin
  if tg_op = 'DELETE' then
    delete from public.scheduled_messages
      where template_id = old.id and status = 'pending';
    return old;
  end if;

  t := new;

  -- Booking confirmations are intentionally not backfilled: editing that template
  -- must never send a fresh confirmation to an old booking. Its pending row still
  -- renders the latest template body at send time.
  if t.trigger_type = 'booking_created' then
    if not t.enabled then
      delete from public.scheduled_messages
        where template_id = t.id and status = 'pending';
    end if;
    return new;
  end if;

  -- Rebuild only unsent rows for this template. Sent history is immutable.
  delete from public.scheduled_messages
    where template_id = t.id and status = 'pending';

  if not t.enabled then
    return new;
  end if;

  for b in
    select id, checkin_date, checkout_date, external_id
    from public.bookings
    where property_id = t.property_id
      and status = 'confirmed' and communications_enabled
  loop
    v_send := case t.trigger_type
      when 'pre_arrival' then
        ((b.checkin_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
      when 'checkin_day' then
        ((b.checkin_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
      when 'post_stay' then
        ((b.checkout_date + t.offset_days)::text || ' ' || t.send_time::text)::timestamp
          at time zone 'Europe/Stockholm'
      else null
    end;

    -- Same late-import guard as generate_booking_messages().
    if v_send is null or (b.external_id like 'sirvoy-csv:%' and v_send<now()) or v_send < now() - interval '1 hour' then
      continue;
    end if;

    foreach v_channel in array
      (case t.channel when 'both' then array['email','sms'] else array[t.channel] end)
    loop
      insert into public.scheduled_messages (booking_id, template_id, channel, send_at)
      values (b.id, t.id, v_channel, v_send)
      on conflict (booking_id, template_id, channel) do update
        set send_at = excluded.send_at,
            status = 'pending',
            error = null
        where public.scheduled_messages.status = 'pending';
    end loop;
  end loop;

  return new;
end;
$$;


-- Safe migration default: imported guests opt in explicitly to future lifecycle messages.
update public.bookings set communications_enabled=false where external_id like 'sirvoy-csv:%';
revoke all on function public.generate_booking_messages() from public,anon,authenticated;
revoke all on function public.reconcile_journey_template_queue() from public,anon,authenticated;
