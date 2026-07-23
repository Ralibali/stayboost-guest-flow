-- ============================================================
-- StayBoost · Chatt-widget (tillval per anläggning)
-- Besökare på ägarens hemsida lämnar ett meddelande i en
-- inbäddad widget → mejlas till ägaren + sparas i inkorgen.
-- Allt designstyrt av ägaren själv i Inställningar.
-- ============================================================

alter table public.properties
  add column chat_enabled boolean not null default false,
  add column chat_email text,               -- mottagare, t.ex. info@auroramedia.se
  add column chat_title text not null default 'Chatta med oss',
  add column chat_greeting text not null default 'Hej! Skriv ett meddelande så svarar vi så snart vi kan.',
  add column chat_color text not null default '#1B1B19',
  add column chat_position text not null default 'right'
    check (chat_position in ('right', 'left')),
  add column chat_button_label text not null default 'Skicka';

-- Inkorg: alla meddelanden som lämnats via widgeten.
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  visitor_name text,
  visitor_email text not null,
  message text not null,
  page_url text,
  emailed boolean not null default false, -- true om Brevo-mailet gick iväg
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index chat_messages_property_idx on public.chat_messages (property_id, created_at desc);

-- ---------- RLS ----------
alter table public.chat_messages enable row level security;

create policy "owner reads chat_messages" on public.chat_messages
  for select using (public.owns_property(property_id));

create policy "owner updates chat_messages" on public.chat_messages
  for update using (public.owns_property(property_id))
  with check (public.owns_property(property_id));

-- Inserts sker alltid via edge function med service role (publik POST),
-- så ingen insert-policy för vanliga användare behövs.
