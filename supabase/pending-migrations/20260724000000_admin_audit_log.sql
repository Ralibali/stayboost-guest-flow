-- StayBoost: audit-logg för administrativa ändringar.
-- Skriver en rad per manuell ändring i /app (bokningar, källor, tillval, inställningar).
-- Ägaren ser endast sin egen anläggnings händelser. RLS enligt properties.owner_id.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity text not null,
  entity_id uuid,
  action text not null,
  summary text,
  changes jsonb,
  created_at timestamptz not null default now()
);

grant select, insert on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;

alter table public.admin_audit_log enable row level security;

create policy "owners read audit log"
  on public.admin_audit_log for select to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = admin_audit_log.property_id and p.owner_id = auth.uid()
  ));

create policy "owners write audit log"
  on public.admin_audit_log for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.properties p
      where p.id = admin_audit_log.property_id and p.owner_id = auth.uid()
    )
  );

create index if not exists admin_audit_log_property_created
  on public.admin_audit_log (property_id, created_at desc);
