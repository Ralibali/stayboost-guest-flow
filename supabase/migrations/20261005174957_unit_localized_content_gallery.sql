-- Additive catalogue content only. Existing unit ownership RLS remains unchanged.
-- Original Sirvoy extracts and asset provenance belong in the private source archive.
create or replace function public.valid_unit_translations(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare language_key text; entry jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for language_key, entry in select * from jsonb_each(value) loop
    if language_key not in ('sv','en','de','da','no') or jsonb_typeof(entry) <> 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(entry) as k where k not in ('name','description'))
      or not (entry ?& array['name','description'])
      or jsonb_typeof(entry->'name') <> 'string'
      or (entry->>'name') !~ '[^[:space:]]' or length(entry->>'name') > 2000
      or (jsonb_typeof(entry->'description') not in ('string','null'))
      or length(entry->>'description') > 100000 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.valid_unit_gallery(value jsonb, property_uuid uuid, unit_uuid uuid)
returns boolean language plpgsql immutable set search_path = '' as $$
declare image jsonb; seen_ids text[] := '{}'; seen_paths text[] := '{}';
begin
  if value is null or jsonb_typeof(value) <> 'array' then return false; end if;
  if jsonb_array_length(value) > 100 then return false; end if;
  for image in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(image) <> 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(image) as k where k not in ('id','storage_path','alt_text'))
      or not (image ?& array['id','storage_path','alt_text'])
      or jsonb_typeof(image->'id') <> 'string'
      or (image->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(image->'storage_path') <> 'string'
      or (image->>'storage_path') !~ ('^' || property_uuid::text || '/' || unit_uuid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$')
      or jsonb_typeof(image->'alt_text') <> 'string' or length(image->>'alt_text') > 2000
      or (image->>'id') = any(seen_ids) or (image->>'storage_path') = any(seen_paths)
    then return false; end if;
    seen_ids := array_append(seen_ids, image->>'id');
    seen_paths := array_append(seen_paths, image->>'storage_path');
  end loop;
  return true;
end $$;

-- Pure validation functions do not read tables or bypass RLS.
revoke all on function public.valid_unit_translations(jsonb) from public, anon;
revoke all on function public.valid_unit_gallery(jsonb,uuid,uuid) from public, anon;
grant execute on function public.valid_unit_translations(jsonb) to authenticated, service_role;
grant execute on function public.valid_unit_gallery(jsonb,uuid,uuid) to authenticated, service_role;

alter table public.units
  add column content_translations jsonb not null default '{}'::jsonb,
  add column gallery jsonb not null default '[]'::jsonb,
  add constraint units_content_translations_valid check(public.valid_unit_translations(content_translations)),
  add constraint units_gallery_valid check(public.valid_unit_gallery(gallery,property_id,id));
comment on column public.units.content_translations is 'Exact plain text per language; no trimming, HTML rendering, source state or auth data.';
comment on column public.units.gallery is 'Ordered public catalogue originals in this unit-images property/unit folder; no Sirvoy thumbnail or signed URLs.';

-- Keep full original/draft texts in the request body, not URL query filters.
-- Invoker rights retain the existing owner-only units policies, including WITH CHECK.
create or replace function public.save_unit_content(
  p_unit_id uuid, p_property_id uuid, p_original jsonb, p_draft jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare snapshot jsonb; affected integer;
begin
  foreach snapshot in array array[p_original,p_draft] loop
    if snapshot is null or jsonb_typeof(snapshot) <> 'object' then raise exception 'invalid_unit_content'; end if;
    if not (snapshot ?& array['name','description','image_url','content_translations','gallery'])
      or exists(select 1 from jsonb_object_keys(snapshot) as k where k not in ('name','description','image_url','content_translations','gallery'))
      or jsonb_typeof(snapshot->'name') <> 'string'
      or length(snapshot->>'name') > 2000
      or jsonb_typeof(snapshot->'description') not in ('string','null')
      or length(snapshot->>'description') > 100000
      or jsonb_typeof(snapshot->'image_url') not in ('string','null')
      or length(snapshot->>'image_url') > 2048
      or not public.valid_unit_translations(snapshot->'content_translations')
      or not public.valid_unit_gallery(snapshot->'gallery',p_property_id,p_unit_id)
    then raise exception 'invalid_unit_content'; end if;
  end loop;
  update public.units set
    name = p_draft->>'name', description = p_draft->>'description', image_url = p_draft->>'image_url',
    content_translations = p_draft->'content_translations', gallery = p_draft->'gallery'
  where id=p_unit_id and property_id=p_property_id
    and name is not distinct from p_original->>'name'
    and description is not distinct from p_original->>'description'
    and image_url is not distinct from p_original->>'image_url'
    and content_translations = p_original->'content_translations'
    and gallery = p_original->'gallery';
  get diagnostics affected = row_count;
  return affected = 1;
end $$;
revoke all on function public.save_unit_content(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_unit_content(uuid,uuid,jsonb,jsonb) to authenticated;
