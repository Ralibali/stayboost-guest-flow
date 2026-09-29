-- Atomic, insert-only cutover. Called by the authenticated booking-import Edge Function
-- after owner verification. Imported stays never enqueue guest communications.
create or replace function public.import_sirvoy_stays(p_property uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r jsonb; bid uuid; eid text; uid uuid; imported integer := 0; skipped integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'invalid_import';
  end if;
  perform 1 from public.properties where id=p_property for update;
  if not found then raise exception 'property_not_found'; end if;
  -- Every required field is revalidated at the trust boundary. No status or
  -- payment assertions are accepted from a CSV; source amounts are documentary.
  for r in select value from jsonb_array_elements(p_rows) loop
    eid := r->>'external_id'; uid := (r->>'unit_id')::uuid;
    if eid is null or eid !~ '^sirvoy-csv:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
       or length(eid)>180 or not exists(select 1 from public.units where id=uid and property_id=p_property)
       or (r->>'checkin_date')::date >= (r->>'checkout_date')::date
       or r->>'checkin_date' is null or r->>'checkout_date' is null
       or length(coalesce(r->>'guest_name','')) not between 2 and 120
       or length(coalesce(r->>'guest_email',''))>254 or length(coalesce(r->>'guest_phone',''))>40
       or (nullif(r->>'guest_email','') is not null and r->>'guest_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
       or (r->>'guests')::integer not between 1 and 20 or r->>'guests' is null
       or (r->>'amount_sek')::integer<0 or (r->>'amount_sek')::integer>10000000
       or length(coalesce(r->>'internal_notes',''))>10000 then
      raise exception 'invalid_import_row';
    end if;
    if exists(select 1 from public.bookings where property_id=p_property and external_id=eid) then
      skipped := skipped+1; continue;
    end if;
    -- StayBoost takes ownership after cutover. The canonical inventory lock
    -- rejects conflicts and rolls back the entire batch.
    insert into public.bookings(property_id,unit_id,source,external_id,guest_name,guest_email,guest_phone,
      checkin_date,checkout_date,guests,internal_notes,payment_amount,payment_status,payment_method)
    values(p_property,uid,'manual',eid,r->>'guest_name',nullif(r->>'guest_email',''),nullif(r->>'guest_phone',''),
      (r->>'checkin_date')::date,(r->>'checkout_date')::date,(r->>'guests')::integer,
      nullif(r->>'internal_notes',''),(r->>'amount_sek')::integer,'none','none') returning id into bid;
    update public.scheduled_messages set status='cancelled',error='Sirvoy import: no automatic guest messages'
      where booking_id=bid and status='pending';
    imported := imported+1;
  end loop;
  return jsonb_build_object('imported',imported,'skipped',skipped);
end $$;
revoke all on function public.import_sirvoy_stays(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_sirvoy_stays(uuid,jsonb) to service_role;
