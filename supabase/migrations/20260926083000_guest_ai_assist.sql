-- StayBoost Guest AI v1: human-approved reply drafts and property knowledge base.
-- No autonomous sending. AI drafts remain internal until an operator copies/sends them.

alter table public.properties
  add column if not exists guest_ai_enabled boolean not null default false,
  add column if not exists guest_ai_instructions text;

alter table public.chat_messages
  add column if not exists ai_draft text,
  add column if not exists ai_draft_created_at timestamptz;

create table if not exists public.guest_ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  question text not null check (char_length(question) between 2 and 500),
  answer text not null check (char_length(answer) between 2 and 4000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guest_ai_knowledge_property_idx
  on public.guest_ai_knowledge(property_id, enabled, created_at desc);

alter table public.guest_ai_knowledge enable row level security;

drop policy if exists "owner reads guest_ai_knowledge" on public.guest_ai_knowledge;
create policy "owner reads guest_ai_knowledge" on public.guest_ai_knowledge
  for select to authenticated
  using (public.owns_property(property_id));

drop policy if exists "owner inserts guest_ai_knowledge" on public.guest_ai_knowledge;
create policy "owner inserts guest_ai_knowledge" on public.guest_ai_knowledge
  for insert to authenticated
  with check (public.owns_property(property_id));

drop policy if exists "owner updates guest_ai_knowledge" on public.guest_ai_knowledge;
create policy "owner updates guest_ai_knowledge" on public.guest_ai_knowledge
  for update to authenticated
  using (public.owns_property(property_id))
  with check (public.owns_property(property_id));

drop policy if exists "owner deletes guest_ai_knowledge" on public.guest_ai_knowledge;
create policy "owner deletes guest_ai_knowledge" on public.guest_ai_knowledge
  for delete to authenticated
  using (public.owns_property(property_id));

grant select, insert, update, delete on public.guest_ai_knowledge to authenticated;
grant all on public.guest_ai_knowledge to service_role;

comment on column public.chat_messages.ai_draft is
  'Internal AI-assisted reply draft. Never sent automatically.';
comment on table public.guest_ai_knowledge is
  'Operator-maintained facts used for internal guest reply suggestions.';

notify pgrst, 'reload schema';
