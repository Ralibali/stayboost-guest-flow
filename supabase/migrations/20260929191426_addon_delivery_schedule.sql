-- Explicit delivery schedules for new purchases only. Old purchase tasks are retained.
alter table public.addons add column fulfillment_type text not null default 'arrival';
alter table public.addons add constraint addons_fulfillment_type_valid
 check(fulfillment_type in ('arrival','each_morning','departure') and (fulfillment_type<>'each_morning' or price_type='per_night'));

create or replace function public.snapshot_stay_addon() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.bookings; a public.addons; d date; day_index integer; v_key text;
begin
 select * into b from public.bookings where id=new.booking_id;
 select * into a from public.addons where id=new.addon_id and property_id=b.property_id;
 if not found then raise exception 'Tillvalet tillhör inte bokningens anläggning'; end if;
 if tg_op='UPDATE' then
  if row(old.quantity,old.unit_price,old.addon_id,old.booking_id) is distinct from row(new.quantity,new.unit_price,new.addon_id,new.booking_id) then
   raise exception 'Ett registrerat tillval kan inte skrivas över. Hantera ändringen separat med gästen.';
  end if;
  return new; -- Catalog edits cannot add or replace deliveries on a previous purchase.
 end if;
 for day_index in select generate_series(case when a.fulfillment_type='each_morning' then 1 else 0 end,
   case when a.fulfillment_type='each_morning' then b.checkout_date-b.checkin_date else 0 end) loop
  d:=case a.fulfillment_type when 'departure' then b.checkout_date when 'each_morning' then b.checkin_date+day_index else b.checkin_date end;
  v_key:=new.addon_id::text||case when a.fulfillment_type='each_morning' then ':'||d::text else '' end;
  insert into public.stay_operations(property_id,booking_id,kind,item_key,title,details,due_date)
  values(b.property_id,b.id,'addon',v_key,a.name,jsonb_build_object('addon_id',a.id,'quantity',new.quantity,
    'unit_price',new.unit_price,'price_type',a.price_type,'fulfillment_type',a.fulfillment_type,'delivery_day_index',day_index,
    'name_source','purchase','purchase_checkin_date',b.checkin_date,'purchase_checkout_date',b.checkout_date,
    'purchase_unit_id',b.unit_id,'nights',b.checkout_date-b.checkin_date,'checkin_date',b.checkin_date,
    'checkout_date',b.checkout_date,'unit_id',b.unit_id),d)
  on conflict(booking_id,kind,item_key) do nothing;
 end loop;
 return new;
end $$;
revoke all on function public.snapshot_stay_addon() from public,anon,authenticated;

create or replace function public.change_stay_operation(p_id uuid,p_revision integer,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.stay_operations;b public.bookings;changed boolean;event jsonb;v_status text;today date;
begin
 if auth.uid() is null then raise exception 'Logga in'; end if;
 select * into o from public.stay_operations where id=p_id for update;
 if not found or not public.owns_property(o.property_id) then raise exception 'Uppgiften saknas'; end if;
 if p_revision is distinct from o.revision then raise exception 'Uppgiften har ändrats. Läs senaste versionen och försök igen.'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or length(p_data::text)>8000 then raise exception 'Ogiltiga uppgifter'; end if;
 select * into b from public.bookings where id=o.booking_id for share;
 if b.status<>'confirmed' then raise exception 'Bokningen är avbokad. Historiken finns kvar.'; end if;
 changed:=(o.details->>'unit_id') is distinct from b.unit_id::text or (o.details->>'checkout_date') is distinct from b.checkout_date::text or (o.kind='addon' and (o.details->>'checkin_date') is distinct from b.checkin_date::text);
 if jsonb_array_length(o.history)>=500 then raise exception 'Historiken är full'; end if;
 today:=(now() at time zone 'Europe/Stockholm')::date;
 if p_action='reset' then
  if coalesce(length(trim(p_data->>'note')),0) not between 1 and 2000 then raise exception 'Beskriv varför uppgiften öppnas igen'; end if;
  event:=jsonb_build_object('label','Öppnad igen med aktuell bokning','note',trim(p_data->>'note'),'previous_basis',jsonb_build_object('unit_id',o.details->'unit_id','checkin_date',o.details->'checkin_date','checkout_date',o.details->'checkout_date'),'previous_status',o.status);
  o.details:=o.details||jsonb_build_object('unit_id',b.unit_id,'checkin_date',b.checkin_date,'checkout_date',b.checkout_date);
  if o.kind='cleaning' then o.due_date:=b.checkout_date;
  elsif o.details->>'fulfillment_type' in ('each_morning','departure') then
   if nullif(p_data->>'due_date','') is not null then o.due_date:=(p_data->>'due_date')::date; end if;
   if o.due_date<=b.checkin_date or o.due_date>b.checkout_date then
    raise exception 'Välj ett nytt leveransdatum efter ankomst och senast på avresedagen. Kontrollera köpet med gästen.';
   end if;
  else o.due_date:=b.checkin_date; end if;
  o.status:='pending';
 elsif changed then raise exception 'Bokningens datum eller boende har ändrats. Anpassa uppgiften först.';
 elsif p_action='assign' then
  if o.status='done' then raise exception 'Öppna uppgiften igen före ändring'; end if;
  if coalesce(length(trim(p_data->>'assigned_to')),0)>200 then raise exception 'Namnet är för långt'; end if;
  o.assigned_to:=coalesce(trim(p_data->>'assigned_to'),'');
  if o.kind='addon' and nullif(p_data->>'due_date','') is not null then
   o.due_date:=(p_data->>'due_date')::date;
   if o.due_date<b.checkin_date or o.due_date>b.checkout_date or (o.details->>'fulfillment_type'='each_morning' and o.due_date=b.checkin_date) then raise exception 'Leveransdatum ska vara under vistelsen; morgonleverans sker efter ankomst'; end if;
  end if;
  event:=jsonb_build_object('label','Ansvarig och planering uppdaterad','assigned_to',o.assigned_to,'due_date',o.due_date);
 elsif p_action='status' then
  v_status:=p_data->>'status';
  if not ((o.status='pending' and v_status='in_progress') or (o.status='in_progress' and v_status='done')) then raise exception 'Statusändringen är inte tillåten'; end if;
  if v_status='done' and o.kind='cleaning' and b.checkout_date>today and b.stay_status<>'checked_out' then raise exception 'Bekräfta först gästens utcheckning'; end if;
  if coalesce(length(trim(p_data->>'note')),0) not between 1 and 2000 then raise exception 'Skriv en kort arbetsanteckning'; end if;
  o.status:=v_status;event:=jsonb_build_object('label',case when v_status='in_progress' then 'Arbetet påbörjat' when o.kind='cleaning' then 'Städningen klar' else 'Tillvalet levererat' end,'note',trim(p_data->>'note'));
 else raise exception 'Okänd åtgärd'; end if;
 o.history:=o.history||jsonb_build_array(event||jsonb_build_object('at',now(),'actor_id',auth.uid(),'assigned_to',o.assigned_to));
 update public.stay_operations set details=o.details,due_date=o.due_date,status=o.status,assigned_to=o.assigned_to,history=o.history,revision=revision+1,updated_at=now() where id=p_id returning * into o;
 return to_jsonb(o);
end $$;
revoke all on function public.change_stay_operation(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.change_stay_operation(uuid,integer,text,jsonb) to authenticated;
