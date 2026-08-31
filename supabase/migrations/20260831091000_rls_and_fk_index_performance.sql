-- StayBoost production bootstrap performance hardening.
-- Supabase Performance Advisor findings only; no business behavior changes.

-- Evaluate auth.uid() once per statement instead of once per candidate row.
drop policy if exists "Owners manage own properties" on public.properties;
create policy "Owners manage own properties" on public.properties
  for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Keep the ownership helper equally deterministic for policies on child tables.
create or replace function public.owns_property(pid uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.properties
    where id = pid
      and owner_id = (select auth.uid())
  )
$$;

-- Cover foreign keys used by deletes/joins. These indexes are intentionally
-- additive and safe on both empty bootstrap DBs and populated installations.
create index if not exists properties_owner_id_idx
  on public.properties (owner_id);
create index if not exists ical_sources_unit_id_idx
  on public.ical_sources (unit_id);
create index if not exists message_templates_property_id_idx
  on public.message_templates (property_id);
create index if not exists scheduled_messages_template_id_idx
  on public.scheduled_messages (template_id);
create index if not exists booking_addons_addon_id_idx
  on public.booking_addons (addon_id);
create index if not exists stripe_webhook_events_booking_id_idx
  on public.stripe_webhook_events (booking_id);
