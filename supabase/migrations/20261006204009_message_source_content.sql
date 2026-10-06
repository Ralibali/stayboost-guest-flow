-- Source imports are drafts. This migration imports no records and sends nothing.
create function public.valid_message_translations(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; v jsonb;
begin
  if value is null or jsonb_typeof(value)<>'object' or octet_length(value::text)>600000 then return false; end if;
  for k,v in select * from jsonb_each(value) loop
    if k not in ('sv','en','de','da','no') or jsonb_typeof(v)<>'object'
      or (select count(*) from jsonb_object_keys(v))<>2
      or jsonb_typeof(v->'subject') is distinct from 'string' or jsonb_typeof(v->'body') is distinct from 'string'
      or length(v->>'subject')>1000 or v->>'subject' ~ E'[\r\n]'
      or length(v->>'body') not between 1 and 100000 then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.valid_message_translations(jsonb) from public,anon;
grant execute on function public.valid_message_translations(jsonb) to authenticated,service_role;

alter table public.message_templates
  drop constraint message_templates_trigger_type_check,
  add constraint message_templates_trigger_type_check check(trigger_type in ('booking_created','pre_arrival','checkin_day','post_stay','manual')),
  add column name text not null default '' check(length(name)<=500),
  add column content_translations jsonb not null default '{}' check(public.valid_message_translations(content_translations)),
  add column body_format text not null default 'text' check(body_format in ('text','html')),
  add column revision integer not null default 1 check(revision>0),
  add column source_archive_id uuid,
  add column source_template_id text check(source_template_id ~ '^[0-9]{1,20}$'),
  add column source_schedule_archive_id uuid,
  add column source_metadata jsonb not null default '{}' check(jsonb_typeof(source_metadata)='object' and octet_length(source_metadata::text)<=20000),
  add column source_reviewed_at timestamptz,
  add column activation_starts_at timestamptz,
  add constraint message_template_source_pair check((source_archive_id is null)=(source_template_id is null)),
  add constraint message_template_source_archive_fk foreign key(source_archive_id,property_id) references public.sirvoy_export_archives(id,property_id),
  add constraint message_template_schedule_archive_fk foreign key(source_schedule_archive_id,property_id) references public.sirvoy_export_archives(id,property_id),
  add constraint message_template_html_email check(body_format='text' or channel='email'),
  add constraint message_template_content_bounds check(length(body) between 1 and 100000 and length(coalesce(subject,''))<=1000 and offset_days between -3660 and 3660),
  add constraint message_template_source_activation check(source_archive_id is null or not enabled or
    (source_reviewed_at is not null and activation_starts_at is not null and activation_starts_at>=source_reviewed_at
      and coalesce(source_metadata->>'import_mapping_supported','false')='true')),
  add constraint message_template_source_unique unique(property_id,source_template_id);

create function public.protect_message_template_source() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user='authenticated' or coalesce(current_setting('request.jwt.claim.role',true),'')='authenticated' then
    if (tg_op='INSERT' and (new.source_archive_id is not null or new.source_schedule_archive_id is not null
        or new.source_metadata<>'{}'::jsonb or new.source_reviewed_at is not null or new.activation_starts_at is not null))
      or (tg_op='UPDATE' and row(new.source_archive_id,new.source_template_id,new.source_schedule_archive_id,new.source_metadata,new.source_reviewed_at,new.activation_starts_at)
        is distinct from row(old.source_archive_id,old.source_template_id,old.source_schedule_archive_id,old.source_metadata,old.source_reviewed_at,old.activation_starts_at)) then
      raise exception 'message_source_server_only' using errcode='42501';
    end if;
  end if;
  if tg_op='UPDATE' then
    if new.property_id<>old.property_id then raise exception 'message_property_immutable' using errcode='42501'; end if;
    if old.source_archive_id is not null and row(new.source_archive_id,new.source_template_id,new.source_schedule_archive_id,new.source_metadata)
      is distinct from row(old.source_archive_id,old.source_template_id,old.source_schedule_archive_id,old.source_metadata) then
      raise exception 'message_source_immutable' using errcode='42501';
    end if;
    if old.source_archive_id is not null and row(new.name,new.subject,new.body,new.content_translations,new.body_format,new.trigger_type,new.offset_days,new.send_time,new.channel)
      is distinct from row(old.name,old.subject,old.body,old.content_translations,old.body_format,old.trigger_type,old.offset_days,old.send_time,old.channel) then
      new.source_reviewed_at:=null; new.activation_starts_at:=null; new.enabled:=false;
    end if;
  end if;
  if new.content_translations ? 'sv' then
    new.subject:=new.content_translations->'sv'->>'subject'; new.body:=new.content_translations->'sv'->>'body';
  end if;
  if new.trigger_type='manual' then new.enabled:=false; end if;
  new.revision:=case when tg_op='INSERT' then 1 else old.revision+1 end;
  return new;
end $$;
revoke all on function public.protect_message_template_source() from public,anon,authenticated;
create trigger message_templates_source_guard before insert or update on public.message_templates
for each row execute function public.protect_message_template_source();

create function public.save_message_template(p_property uuid,p_template uuid,p_revision integer,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.message_templates%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.properties where id=p_property and owner_id=auth.uid()) then
    raise exception 'not_authorized' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k
    where k not in ('name','subject','body','content_translations','body_format','trigger_type','offset_days','send_time','channel','enabled')) then
    raise exception 'invalid_message_template'; end if;
  select * into result from public.message_templates where id=p_template and property_id=p_property for update;
  if not found then raise exception 'message_template_not_found'; end if;
  if p_revision is distinct from result.revision then raise exception 'message_template_changed' using errcode='40001'; end if;
  update public.message_templates set
    name=case when p_data?'name' then p_data->>'name' else name end,
    subject=case when p_data?'subject' then p_data->>'subject' else subject end,
    body=case when p_data?'body' then p_data->>'body' else body end,
    content_translations=case when p_data?'content_translations' then p_data->'content_translations' else content_translations end,
    body_format=case when p_data?'body_format' then p_data->>'body_format' else body_format end,
    trigger_type=case when p_data?'trigger_type' then p_data->>'trigger_type' else trigger_type end,
    offset_days=case when p_data?'offset_days' then (p_data->>'offset_days')::integer else offset_days end,
    send_time=case when p_data?'send_time' then (p_data->>'send_time')::time else send_time end,
    channel=case when p_data?'channel' then p_data->>'channel' else channel end,
    enabled=case when p_data?'enabled' then (p_data->>'enabled')::boolean else enabled end
    where id=p_template returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.save_message_template(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_message_template(uuid,uuid,integer,jsonb) to authenticated;

-- No caller-supplied content: original bytes in the same property's immutable archive
-- are the authority. Unsupported automation is retained as a disabled manual draft.
create function public.import_sirvoy_message_template(p_property uuid,p_actor uuid,p_archive uuid,
  p_send_time time default null,p_schedule_archive uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare src jsonb; clock_source jsonb; tr jsonb:='{}'; lang text; identifier text; existing public.message_templates%rowtype;
  kind text; trigger_name text:='manual'; day_offset integer:=0; meta jsonb; bid uuid;
begin
  perform 1 from public.properties where id=p_property and owner_id=p_actor for update;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  select convert_from(file_bytes,'UTF8')::jsonb into src from public.sirvoy_export_archives
    where id=p_archive and property_id=p_property and export_kind='settings' and byte_count<=1048576;
  if not found or src->>'schema_version' is distinct from '1' then raise exception 'invalid_message_archive'; end if;
  identifier:=src->'source'->>'template_id_observed'; meta:=src->'metadata';
  if identifier is null or identifier!~'^[0-9]{1,20}$' or jsonb_typeof(meta) is distinct from 'object' then raise exception 'invalid_message_archive'; end if;
  select * into existing from public.message_templates where property_id=p_property and source_template_id=identifier;
  if found then
    if existing.source_archive_id<>p_archive or existing.source_schedule_archive_id is distinct from p_schedule_archive then raise exception 'message_source_conflict'; end if;
    return jsonb_build_object('id',existing.id,'duplicate',true,'enabled',existing.enabled);
  end if;
  foreach lang in array array['sv','en','de','da','no'] loop
    tr:=tr||jsonb_build_object(lang,jsonb_build_object('subject',src->'translations'->lang->'subject_exact','body',src->'translations'->lang->'source_body_html_exact'));
  end loop;
  if not public.valid_message_translations(tr) then raise exception 'invalid_message_translations'; end if;
  kind:=meta->'event'->>'value_exact';
  if kind='confirmation' then trigger_name:='booking_created';
  elsif kind in ('checkin','checkout') then
    if meta->'days'->>'hidden_in_saved_dom' is distinct from 'false' or meta->'timing'->>'hidden_in_saved_dom' is distinct from 'false'
      or coalesce(meta->'days'->>'value_exact','')!~'^[0-9]{1,3}$'
      or coalesce(meta->'timing'->>'value_exact','') not in ('before','after')
      or p_send_time is null or p_schedule_archive is null then raise exception 'message_schedule_source_required'; end if;
    select convert_from(file_bytes,'UTF8')::jsonb into clock_source from public.sirvoy_export_archives
      where id=p_schedule_archive and property_id=p_property and export_kind='settings' and byte_count<=1048576;
    if not found or clock_source#>>'{source_pages,localization,timezone}' is distinct from 'Europe/Stockholm'
      or coalesce(clock_source#>>'{source_pages,localization,automatic_messages_clock}','')!~'^[0-2][0-9]:[0-5][0-9]$' then
      raise exception 'message_schedule_source_required'; end if;
    if (clock_source#>>'{source_pages,localization,automatic_messages_clock}')::time is distinct from p_send_time then
      raise exception 'message_schedule_source_mismatch'; end if;
    day_offset:=(meta->'days'->>'value_exact')::integer * case when meta->'timing'->>'value_exact'='before' then -1 else 1 end;
    trigger_name:=case kind when 'checkin' then 'pre_arrival' else 'post_stay' end;
  end if;
  insert into public.message_templates(property_id,name,trigger_type,offset_days,send_time,channel,subject,body,
    body_format,content_translations,enabled,source_archive_id,source_template_id,source_schedule_archive_id,source_metadata)
  values(p_property,meta->'name'->>'value_exact',trigger_name,day_offset,coalesce(p_send_time,'09:00'::time),'email',
    tr->'sv'->>'subject',tr->'sv'->>'body','html',tr,false,p_archive,identifier,p_schedule_archive,
    meta||jsonb_build_object('import_mapping_supported',kind in ('none','confirmation','checkin','checkout')
      and coalesce(meta->'category'->>'value_exact','')='0' and meta->'use-footer'->>'checked_attribute'='false',
      'time_zone','Europe/Stockholm')) returning id into bid;
  return jsonb_build_object('id',bid,'duplicate',false,'enabled',false);
end $$;
revoke all on function public.import_sirvoy_message_template(uuid,uuid,uuid,time,uuid) from public,anon,authenticated;
grant execute on function public.import_sirvoy_message_template(uuid,uuid,uuid,time,uuid) to service_role;

-- Used at all three boundaries: queue construction, lease, and current-state dispatch.
create function public.message_template_eligible(t public.message_templates,b public.bookings)
returns boolean language sql stable security invoker set search_path='' as $$
 select t.enabled and t.trigger_type<>'manual' and t.property_id=b.property_id and
   (t.source_archive_id is null or (
     t.source_reviewed_at is not null and t.activation_starts_at>=t.source_reviewed_at
     and b.created_at>=t.activation_starts_at and coalesce(b.external_id,'') not like 'sirvoy-csv:%'
     and coalesce(t.source_metadata->>'import_mapping_supported','false')='true'
     and (t.trigger_type<>'booking_created' or b.source in ('direct','manual'))))
$$;
revoke all on function public.message_template_eligible(public.message_templates,public.bookings) from public,anon,authenticated;
grant execute on function public.message_template_eligible(public.message_templates,public.bookings) to service_role;

create function public.message_scheduled_at(kind text,offset_days integer,local_time time,checkin date,checkout date,created timestamptz)
returns timestamptz language sql stable security invoker set search_path='' as $$
 select case when kind='booking_created' then created
   when kind in ('pre_arrival','checkin_day') then (checkin+offset_days+local_time) at time zone 'Europe/Stockholm'
   when kind='post_stay' then (checkout+offset_days+local_time) at time zone 'Europe/Stockholm'
   else null end
$$;
revoke all on function public.message_scheduled_at(text,integer,time,date,date,timestamptz) from public,anon;
grant execute on function public.message_scheduled_at(text,integer,time,date,date,timestamptz) to authenticated,service_role;

create or replace function public.generate_booking_messages()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_send timestamptz;
  v_channel text;
  v_existing_templates uuid[];
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

  -- Preserve the identity of pending confirmations across a date-driven queue rebuild,
  -- while refusing confirmations for templates added/retargeted after this booking.
  select coalesce(array_agg(template_id),array[]::uuid[]) into v_existing_templates
    from public.scheduled_messages where booking_id=new.id;

  -- Datumändring: räkna om det som ännu inte skickats
  if tg_op = 'UPDATE'
     and (new.checkin_date <> old.checkin_date or new.checkout_date <> old.checkout_date) then
    delete from scheduled_messages where booking_id = new.id and status = 'pending';
  end if;

  for t in
    select * from message_templates
    where property_id = new.property_id and public.message_template_eligible(message_templates,new)
  loop
    if t.trigger_type='booking_created' and (new.external_id like 'sirvoy-csv:%'
      or (tg_op='UPDATE' and not (t.id=any(v_existing_templates)))) then continue; end if;
    v_send := public.message_scheduled_at(t.trigger_type,t.offset_days,t.send_time,new.checkin_date,new.checkout_date,now());

    -- Sen import (t.ex. iCal mitt under vistelse): spamma inte gästen
    -- med förfallna meddelanden. booking_created skickas dock alltid.
    if v_send is null or (new.external_id like 'sirvoy-csv:%' and v_send<now())
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
  if t.trigger_type in ('booking_created','manual') then
    if not t.enabled or t.trigger_type='manual' or (tg_op='UPDATE' and row(new.trigger_type,new.channel) is distinct from row(old.trigger_type,old.channel)) then
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
    select *
    from public.bookings
    where property_id = t.property_id
      and status = 'confirmed' and communications_enabled and public.message_template_eligible(t,bookings)
  loop
    v_send := public.message_scheduled_at(t.trigger_type,t.offset_days,t.send_time,b.checkin_date,b.checkout_date,b.created_at);

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



drop trigger message_templates_reconcile_journey_queue on public.message_templates;
create trigger message_templates_reconcile_journey_queue
  after insert or update of enabled,trigger_type,offset_days,send_time,channel,activation_starts_at,source_reviewed_at or delete
  on public.message_templates for each row execute function public.reconcile_journey_template_queue();

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
    or not exists(select 1 from public.message_templates where id=m.template_id and public.message_template_eligible(message_templates,b)) then
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
  select * into t from public.message_templates where id=m.template_id and public.message_template_eligible(message_templates,b);
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
    'template',jsonb_build_object('subject',t.subject,'body',t.body,'body_format',t.body_format,
      'content_translations',t.content_translations,'source_archive_id',t.source_archive_id),
    'booking',jsonb_build_object('id',b.id,'status',b.status,'communications_enabled',b.communications_enabled,
      'external_id',b.external_id,'payment_status',b.payment_status,'payment_amount',b.payment_amount,
      'guests',b.guests,'quote_snapshot',jsonb_build_object('language',b.quote_snapshot->'language','currency',b.quote_snapshot->'currency','grandTotal',b.quote_snapshot->'grandTotal',
        'addons',case when jsonb_typeof(b.quote_snapshot->'addons')='array' then
          (select jsonb_agg(jsonb_build_object('name',a->'name','quantity',a->'quantity','lineTotal',a->'lineTotal'))
            from jsonb_array_elements(b.quote_snapshot->'addons') a) else null end),'guest_name',b.guest_name,'guest_email',b.guest_email,
      'guest_phone',b.guest_phone,'guest_token',b.guest_token,'checkin_date',b.checkin_date,'checkout_date',b.checkout_date,
      'unit',jsonb_build_object('name',unit_name),
      'property',jsonb_build_object('name',p.name,'checkin_time',p.checkin_time,'checkout_time',p.checkout_time,
        'directions',p.directions,'wifi_name',p.wifi_name,'wifi_password',p.wifi_password,'contact_phone',p.contact_phone,'review_url',p.review_url)));
end $$;
revoke all on function public.begin_scheduled_message(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_scheduled_message(uuid,uuid) to service_role;

