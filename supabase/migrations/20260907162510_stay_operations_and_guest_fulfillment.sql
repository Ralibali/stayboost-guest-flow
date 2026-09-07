-- Booking-linked operations, with durable purchase snapshots and immutable event history.
-- Rollback: remove operations navigation and RPC grants; retain history.
create table public.stay_operations (
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 kind text not null check(kind in('cleaning','addon')),item_key text not null,
 title text not null,details jsonb not null default '{}',due_date date not null,
 status text not null default 'pending' check(status in('pending','in_progress','done')),
 assigned_to text not null default '',history jsonb not null default '[]',revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(booking_id,kind,item_key)
);
create index stay_operations_property_due on public.stay_operations(property_id,due_date);
alter table public.stay_operations enable row level security;
create policy "owners read stay operations" on public.stay_operations for select to authenticated using(public.owns_property(property_id));
revoke all on public.stay_operations from anon,authenticated;
grant select on public.stay_operations to authenticated;
grant all on public.stay_operations to service_role;

create function public.snapshot_stay_addon() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.bookings;a public.addons;
begin
 select * into b from public.bookings where id=new.booking_id;
 select * into a from public.addons where id=new.addon_id and property_id=b.property_id;
 if not found then raise exception 'Tillvalet tillhör inte bokningens anläggning'; end if;
 if tg_op='UPDATE' and (old.quantity<>new.quantity or old.unit_price<>new.unit_price or old.addon_id<>new.addon_id or old.booking_id<>new.booking_id) then raise exception 'Ett registrerat tillval kan inte skrivas över. Hantera ändringen separat med gästen.'; end if;
 insert into public.stay_operations(property_id,booking_id,kind,item_key,title,details,due_date)
 values(b.property_id,b.id,'addon',new.addon_id::text,a.name,jsonb_build_object('addon_id',a.id,'quantity',new.quantity,'unit_price',new.unit_price,'price_type',a.price_type,'name_source','purchase','purchase_checkin_date',b.checkin_date,'purchase_checkout_date',b.checkout_date,'purchase_unit_id',b.unit_id,'nights',b.checkout_date-b.checkin_date,'checkin_date',b.checkin_date,'checkout_date',b.checkout_date,'unit_id',b.unit_id),b.checkin_date)
 on conflict(booking_id,kind,item_key) do nothing;
 return new;
end $$;
revoke all on function public.snapshot_stay_addon() from public,anon,authenticated;
create trigger snapshot_stay_addon after insert or update on public.booking_addons for each row execute function public.snapshot_stay_addon();

-- Existing purchases are actual rows, not assumed deliveries. Name/type provenance is explicit.
insert into public.stay_operations(property_id,booking_id,kind,item_key,title,details,due_date)
select b.property_id,b.id,'addon',ba.addon_id::text,a.name,jsonb_build_object('addon_id',a.id,'quantity',ba.quantity,'unit_price',ba.unit_price,'price_type',null,'name_source','current_catalog','checkin_date',b.checkin_date,'checkout_date',b.checkout_date,'unit_id',b.unit_id),b.checkin_date
from public.booking_addons ba join public.bookings b on b.id=ba.booking_id join public.addons a on a.id=ba.addon_id and a.property_id=b.property_id
on conflict(booking_id,kind,item_key) do nothing;

create function public.stay_operations_board(p_property uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.owns_property(p_property) then raise exception 'Anläggningen saknas'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>100 then raise exception 'Välj högst 100 dagar'; end if;
 insert into public.stay_operations(property_id,booking_id,kind,item_key,title,details,due_date)
 select property_id,id,'cleaning','turnover','Städning efter utcheckning',jsonb_build_object('unit_id',unit_id,'checkout_date',checkout_date,'checkin_date',checkin_date),checkout_date from public.bookings
 where property_id=p_property and status='confirmed' and unit_id is not null and checkout_date between p_from and p_to
 on conflict(booking_id,kind,item_key) do nothing;
 return coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('booking',jsonb_build_object('guest_name',b.guest_name,'checkin_date',b.checkin_date,'checkout_date',b.checkout_date,'status',b.status,'stay_status',b.stay_status,'payment_status',b.payment_status,'unit_name',u.name),'context_changed',((o.details->>'unit_id') is distinct from b.unit_id::text or (o.details->>'checkout_date') is distinct from b.checkout_date::text or (o.kind='addon' and (o.details->>'checkin_date') is distinct from b.checkin_date::text))) order by o.due_date,o.created_at)
 from public.stay_operations o join public.bookings b on b.id=o.booking_id left join public.units u on u.id=b.unit_id
 where o.property_id=p_property and (o.due_date between p_from and p_to or (o.kind='cleaning' and b.checkout_date between p_from and p_to) or (o.kind='addon' and b.checkin_date between p_from and p_to))),'[]');
end $$;
revoke all on function public.stay_operations_board(uuid,date,date) from public,anon;
grant execute on function public.stay_operations_board(uuid,date,date) to authenticated;

create function public.change_stay_operation(p_id uuid,p_revision integer,p_action text,p_data jsonb default '{}') returns jsonb
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
  o.due_date:=case o.kind when 'cleaning' then b.checkout_date else b.checkin_date end;o.status:='pending';
 elsif changed then raise exception 'Bokningens datum eller boende har ändrats. Anpassa uppgiften först.';
 elsif p_action='assign' then
  if o.status='done' then raise exception 'Öppna uppgiften igen före ändring'; end if;
  if coalesce(length(trim(p_data->>'assigned_to')),0)>200 then raise exception 'Namnet är för långt'; end if;
  o.assigned_to:=coalesce(trim(p_data->>'assigned_to'),'');
  if o.kind='addon' and nullif(p_data->>'due_date','') is not null then
   o.due_date:=(p_data->>'due_date')::date;
   if o.due_date<b.checkin_date or o.due_date>b.checkout_date then raise exception 'Leveransdatum ska vara under vistelsen'; end if;
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
