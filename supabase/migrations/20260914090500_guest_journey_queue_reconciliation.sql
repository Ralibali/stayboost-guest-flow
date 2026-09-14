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
    select id, checkin_date, checkout_date
    from public.bookings
    where property_id = t.property_id
      and status = 'confirmed'
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
    if v_send is null or v_send < now() - interval '1 hour' then
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

-- Template ownership is already protected by RLS. The trigger only touches rows
-- reachable through that owned template/property and therefore preserves the
-- existing tenant boundary.
drop trigger if exists message_templates_reconcile_journey_queue on public.message_templates;
create trigger message_templates_reconcile_journey_queue
  after insert or update of enabled, offset_days, send_time, channel or delete
  on public.message_templates
  for each row execute function public.reconcile_journey_template_queue();
