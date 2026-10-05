-- Extend the existing webchat inbox; scheduled_messages remains the outbound source of truth.
-- No provider connection, guest notification, booking write or automatic reply is created here.
alter table public.chat_messages
  add column channel text not null default 'webchat' check (channel in ('webchat','email','sms','whatsapp')),
  add column logged_manually boolean not null default false,
  add column visitor_phone text check (length(visitor_phone) <= 30),
  add column booking_id uuid,
  add column inbox_status text not null default 'open' check (inbox_status in ('open','waiting','resolved')),
  add column assigned_to text not null default '' check (length(assigned_to) <= 120),
  add column followup_date date,
  add column internal_note text not null default '' check (length(internal_note) <= 4000),
  add column inbox_version integer not null default 1;

-- A booking from another property must never be attached, even for owners of both properties.
create unique index bookings_id_property_inbox_key on public.bookings(id, property_id);
alter table public.chat_messages add constraint inbox_booking_same_property
  foreign key (booking_id, property_id) references public.bookings(id, property_id)
  on delete set null (booking_id);
create index inbox_booking_idx on public.chat_messages(booking_id) where booking_id is not null;
create index inbox_queue_idx on public.chat_messages(property_id, inbox_status, followup_date);

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to authenticated;
-- Source identity and guest content remain immutable to browser clients.
grant update(read_at,inbox_status,assigned_to,followup_date,internal_note,booking_id)
  on public.chat_messages to authenticated;
grant insert(property_id,visitor_name,visitor_email,visitor_phone,message,channel,logged_manually)
  on public.chat_messages to authenticated;
create policy "owner logs external inbox messages" on public.chat_messages
  for insert to authenticated with check (
    public.owns_property(property_id) and logged_manually and channel in ('email','sms','whatsapp')
    and length(trim(visitor_name)) between 1 and 120
    and length(trim(message)) between 1 and 4000
    and case when channel='email' then visitor_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      when channel='whatsapp' then regexp_replace(coalesce(visitor_phone,''),'[ ()-]','','g') ~ '^\+[0-9]{7,15}$'
      else regexp_replace(coalesce(visitor_phone,''),'[ ()-]','','g') ~ '^\+?[0-9]{6,15}$' end
  );

-- Optimistic locking for operator workflow changes without invalidating AI drafts/read markers.
create function public.bump_inbox_version() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if (new.inbox_status,new.assigned_to,new.followup_date,new.internal_note,new.booking_id)
     is distinct from (old.inbox_status,old.assigned_to,old.followup_date,old.internal_note,old.booking_id) then
    new.inbox_version := old.inbox_version + 1;
  else new.inbox_version := old.inbox_version;
  end if;
  return new;
end $$;
revoke all on function public.bump_inbox_version() from public,anon,authenticated;
create trigger chat_messages_inbox_version before update on public.chat_messages
  for each row execute function public.bump_inbox_version();

notify pgrst, 'reload schema';
