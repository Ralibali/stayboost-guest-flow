-- Original exports are evidence, not operational bookings or payment assertions.
-- Bytes, encoding and BOM are retained exactly; no guest communications are generated.
create table public.sirvoy_export_archives (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  filename text not null check(length(filename) between 1 and 255),
  media_type text not null default 'application/octet-stream' check(length(media_type) between 1 and 120),
  export_kind text not null check(export_kind in ('bookings_condensed','bookings_expanded','sirvoy_compatible','guests','payments','accounting','settings','other')),
  coverage_from date,
  coverage_to date,
  coverage_filter text check(length(coverage_filter) <= 300),
  row_count integer check(row_count >= 0),
  row_count_note text check(length(row_count_note) <= 200),
  file_bytes bytea not null check(octet_length(file_bytes) between 1 and 10485760),
  byte_count integer generated always as (octet_length(file_bytes)) stored,
  sha256 text generated always as (encode(sha256(file_bytes), 'hex')) stored,
  created_at timestamptz not null default now(),
  constraint sirvoy_archive_coverage_order check(coverage_from is null or coverage_to is null or coverage_to >= coverage_from),
  unique(property_id, sha256)
);
create index sirvoy_export_archives_property_created on public.sirvoy_export_archives(property_id, created_at desc, id);
create index sirvoy_export_archives_creator on public.sirvoy_export_archives(created_by);
alter table public.sirvoy_export_archives enable row level security;
create policy "owners read their Sirvoy export archive"
on public.sirvoy_export_archives for select to authenticated
using(exists(select 1 from public.properties p where p.id=property_id and p.owner_id=(select auth.uid())));
-- Uploads go through a server-side owner check. Archives have no overwrite/delete API.
-- Existing explicit property/account deletion still cascades through its associated archive.
revoke all on public.sirvoy_export_archives from public, anon, authenticated, service_role;
grant select on public.sirvoy_export_archives to authenticated;
grant select, insert on public.sirvoy_export_archives to service_role;
comment on table public.sirvoy_export_archives is
  'Immutable original Sirvoy exports. Archive presence does not mean data has been mapped or imported into operational StayBoost tables.';
