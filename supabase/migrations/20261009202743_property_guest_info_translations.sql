-- Generic property guest information, not private access instructions. No content backfill.
create or replace function public.valid_property_guest_info(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare language_key text; entry jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for language_key, entry in select * from jsonb_each(value) loop
    if language_key not in ('sv','en','de','da','no') or jsonb_typeof(entry) <> 'object' then return false; end if;
    if not (entry ?& array['directions','house_rules'])
      or exists(select 1 from jsonb_object_keys(entry) as k where k not in ('directions','house_rules'))
      or jsonb_typeof(entry->'directions') not in ('string','null')
      or jsonb_typeof(entry->'house_rules') not in ('string','null')
      or length(entry->>'directions') > 100000 or length(entry->>'house_rules') > 100000
    then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.valid_property_guest_info(jsonb) from public, anon;
grant execute on function public.valid_property_guest_info(jsonb) to authenticated, service_role;

alter table public.properties
  add column guest_info_translations jsonb not null default '{}'::jsonb,
  add constraint properties_guest_info_valid check(public.valid_property_guest_info(guest_info_translations));
comment on column public.properties.guest_info_translations is
  'Plain text directions and house_rules in sv/en/de/da/no. Null falls back; empty string hides. No private access data or source metadata.';

create or replace function public.sync_property_guest_info()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare expected_context text;
begin
  -- Old Settings clients use select('*') then submit the entire stale row, including
  -- newly added columns. Any translated change therefore needs the owner's CAS RPC.
  -- This marker prevents accidental stale writes; owner checks and RLS remain the authority.
  -- Trusted service imports and legacy-only properties are unaffected.
  if tg_op = 'UPDATE' and current_user = 'authenticated'
    and (old.guest_info_translations <> '{}'::jsonb or new.guest_info_translations <> '{}'::jsonb)
    and (new.guest_info_translations is distinct from old.guest_info_translations
      or new.directions is distinct from old.directions or new.house_rules is distinct from old.house_rules)
  then
    expected_context := old.id::text || ':' ||
      md5(jsonb_build_object('directions',old.directions,'house_rules',old.house_rules,'guest_info_translations',old.guest_info_translations)::text) || ':' ||
      md5(jsonb_build_object('directions',new.directions,'house_rules',new.house_rules,'guest_info_translations',new.guest_info_translations)::text);
    if current_setting('stayboost.guest_info_write',true) is distinct from expected_context
    then raise exception 'guest_info_use_language_editor'; end if;
  end if;
  if new.guest_info_translations ? 'sv' then
    new.directions := new.guest_info_translations->'sv'->>'directions';
    new.house_rules := new.guest_info_translations->'sv'->>'house_rules';
  end if;
  return new;
end $$;
revoke all on function public.sync_property_guest_info() from public, anon, authenticated;
create trigger properties_sync_guest_info before insert or update on public.properties
for each row execute function public.sync_property_guest_info();

-- Invoker rights retain the existing property ownership RLS. CAS covers these three fields only.
create or replace function public.save_property_guest_info(
  p_property_id uuid, p_original jsonb, p_draft jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare snapshot jsonb; affected integer; previous_context text;
begin
  if (select auth.uid()) is null then return false; end if;
  foreach snapshot in array array[p_original,p_draft] loop
    if snapshot is null or jsonb_typeof(snapshot) <> 'object' then raise exception 'invalid_property_guest_info'; end if;
    if not (snapshot ?& array['directions','house_rules','guest_info_translations'])
      or exists(select 1 from jsonb_object_keys(snapshot) as k where k not in ('directions','house_rules','guest_info_translations'))
      or jsonb_typeof(snapshot->'directions') not in ('string','null')
      or jsonb_typeof(snapshot->'house_rules') not in ('string','null')
      or length(snapshot->>'directions') > 100000 or length(snapshot->>'house_rules') > 100000
      or not public.valid_property_guest_info(snapshot->'guest_info_translations')
    then raise exception 'invalid_property_guest_info'; end if;
  end loop;
  if p_draft->'guest_info_translations' ? 'sv' and (
    p_draft->>'directions' is distinct from p_draft->'guest_info_translations'->'sv'->>'directions'
    or p_draft->>'house_rules' is distinct from p_draft->'guest_info_translations'->'sv'->>'house_rules'
  ) then raise exception 'invalid_property_guest_info'; end if;
  previous_context := current_setting('stayboost.guest_info_write',true);
  perform set_config('stayboost.guest_info_write',p_property_id::text || ':' || md5(p_original::text) || ':' || md5(p_draft::text),true);
  begin
    update public.properties set
      directions=p_draft->>'directions', house_rules=p_draft->>'house_rules',
      guest_info_translations=p_draft->'guest_info_translations'
    where id=p_property_id and owner_id=(select auth.uid())
      and directions is not distinct from p_original->>'directions'
      and house_rules is not distinct from p_original->>'house_rules'
      and guest_info_translations=p_original->'guest_info_translations';
    get diagnostics affected = row_count;
  exception when others then
    perform set_config('stayboost.guest_info_write',coalesce(previous_context,''),true);
    raise;
  end;
  perform set_config('stayboost.guest_info_write',coalesce(previous_context,''),true);
  return affected = 1;
end $$;
revoke all on function public.save_property_guest_info(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_property_guest_info(uuid,jsonb,jsonb) to authenticated;
