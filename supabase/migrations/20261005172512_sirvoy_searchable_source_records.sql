-- Searchable source evidence only. No booking, payment, task or messaging writes.
alter table public.sirvoy_export_archives add constraint sirvoy_archive_property_identity unique(id,property_id);
create table public.sirvoy_source_imports (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  archive_id uuid not null unique,
  created_by uuid references auth.users(id) on delete set null,
  source_format text not null check(source_format in ('bookings_condensed','bookings_expanded','sirvoy_compatible')),
  cancellation_scope text not null check(cancellation_scope in ('excluding_cancelled','cancelled','all','unknown')),
  parser_version text not null check(length(parser_version) between 1 and 100),
  headers jsonb not null check(jsonb_typeof(headers)='array' and jsonb_array_length(headers) between 1 and 500),
  row_count integer not null check(row_count between 0 and 20000),
  warnings jsonb not null default '[]' check(jsonb_typeof(warnings)='array'),
  parsed_sha256 text not null check(parsed_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(id,property_id),
  foreign key(archive_id,property_id) references public.sirvoy_export_archives(id,property_id) on delete cascade
);
create index sirvoy_source_imports_property on public.sirvoy_source_imports(property_id,created_at,id);
create index sirvoy_source_imports_creator on public.sirvoy_source_imports(created_by);

create table public.sirvoy_source_records (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  property_id uuid not null,
  source_row integer not null check(source_row between 1 and 20000),
  record_kind text not null check(length(record_kind) between 1 and 100),
  booking_ref text not null check(length(booking_ref) between 1 and 200),
  room_ref text,
  guest_name text,
  guest_email text,
  guest_phone text,
  checkin_date date,
  checkout_date date,
  amount_raw text,
  amount_decimal text check(amount_decimal is null or amount_decimal ~ '^-?[0-9]{1,30}(\.[0-9]{1,12})?$'),
  payment_ref text,
  payment_status text,
  occurred_raw text,
  fields jsonb not null check(jsonb_typeof(fields)='array'),
  search_text text generated always as (
    lower(booking_ref || ' ' || coalesce(room_ref,'') || ' ' || coalesce(guest_name,'') || ' ' || fields::text)
  ) stored,
  foreign key(import_id,property_id) references public.sirvoy_source_imports(id,property_id) on delete cascade,
  unique(import_id,source_row)
);
create index sirvoy_source_records_property_kind on public.sirvoy_source_records(property_id,record_kind,booking_ref,id);
create index sirvoy_source_records_booking on public.sirvoy_source_records(property_id,booking_ref,id);
create index sirvoy_source_records_payment_ref on public.sirvoy_source_records(property_id,payment_ref) where record_kind='PAYMENT';

alter table public.sirvoy_source_imports enable row level security;
alter table public.sirvoy_source_records enable row level security;
create policy "owners read source import manifests" on public.sirvoy_source_imports for select to authenticated
using(exists(select 1 from public.properties p where p.id=property_id and p.owner_id=(select auth.uid())));
create policy "owners read Sirvoy source records" on public.sirvoy_source_records for select to authenticated
using(exists(select 1 from public.properties p where p.id=property_id and p.owner_id=(select auth.uid())));
revoke all on public.sirvoy_source_imports,public.sirvoy_source_records from public,anon,authenticated,service_role;
grant select on public.sirvoy_source_imports,public.sirvoy_source_records to authenticated;
grant select,insert on public.sirvoy_source_imports,public.sirvoy_source_records to service_role;

-- Only Expanded PAYMENT rows participate. Other formats remain linked source
-- rows, never extra transactions. Repeated references are one source transaction;
-- contradictory copies remain visible and are explicitly marked for review.
create view public.sirvoy_source_payment_ledger with(security_invoker=true) as
with payments as (
  select r.*,i.archive_id,i.cancellation_scope,
    case when nullif(r.payment_ref,'') is null then 'row:'||r.id::text else 'ref:'||r.payment_ref end as transaction_key
  from public.sirvoy_source_records r join public.sirvoy_source_imports i on i.id=r.import_id
  where i.source_format='bookings_expanded' and r.record_kind='PAYMENT'
), grouped as (
  select property_id,transaction_key,min(booking_ref) as booking_ref,min(payment_ref) as payment_ref,
    count(*)::integer as source_copies,
    count(distinct jsonb_build_array(booking_ref,amount_decimal,case when amount_decimal is null then amount_raw end,payment_status,occurred_raw))::integer as source_variants,
    min(amount_decimal) as amount_decimal,min(amount_raw) as amount_raw,
    min(payment_status) as payment_status,min(occurred_raw) as occurred_raw,
    bool_or(payment_ref is null or payment_ref='' or amount_decimal is null or nullif(payment_status,'') is null) as incomplete,
    array_agg(distinct cancellation_scope order by cancellation_scope) as source_scopes,
    jsonb_agg(jsonb_build_object('id',id,'archive_id',archive_id,'source_row',source_row) order by import_id,source_row) as sources
  from payments group by property_id,transaction_key
)
select property_id,transaction_key,booking_ref,payment_ref,source_copies,source_variants,
  case when source_variants=1 then amount_decimal else null end as amount_decimal,
  case when source_variants=1 then amount_raw else null end as amount_raw,
  case when source_variants=1 then payment_status else null end as payment_status,
  case when source_variants=1 then occurred_raw else null end as occurred_raw,
  (incomplete or source_variants<>1) as needs_review,source_scopes,sources,
  null::text as currency
from grouped;
revoke all on public.sirvoy_source_payment_ledger from public,anon,authenticated,service_role;
grant select on public.sirvoy_source_payment_ledger to authenticated,service_role;

create function public.index_sirvoy_source(
  p_actor uuid,p_property uuid,p_archive uuid,p_archive_sha256 text,
  p_format text,p_scope text,p_parser_version text,p_headers jsonb,p_records jsonb,p_warnings jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  archive public.sirvoy_export_archives%rowtype;
  existing public.sirvoy_source_imports%rowtype;
  imported_id uuid;
  fingerprint text;
  n integer;
  kind_counts jsonb;
begin
  if not exists(select 1 from public.properties where id=p_property and owner_id=p_actor) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  -- Serializes repeat indexing of this archive without any operational booking lock.
  perform pg_advisory_xact_lock(hashtextextended(p_archive::text,17));
  select * into archive from public.sirvoy_export_archives where id=p_archive and property_id=p_property;
  if not found then raise exception 'archive_not_found'; end if;
  if p_archive_sha256 is distinct from archive.sha256 then raise exception 'archive_integrity_failed'; end if;
  if p_format is distinct from archive.export_kind or p_format not in ('bookings_condensed','bookings_expanded','sirvoy_compatible')
    or p_scope is null or p_scope not in ('excluding_cancelled','cancelled','all','unknown')
    or p_parser_version is null or length(p_parser_version) not between 1 and 100
    or p_headers is null or jsonb_typeof(p_headers)<>'array' or jsonb_array_length(p_headers) not between 1 and 500
    or exists(select 1 from jsonb_array_elements(p_headers) h where jsonb_typeof(h)<>'string')
    or p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>20000
    or p_warnings is null or jsonb_typeof(p_warnings)<>'array'
    or octet_length(p_records::text)>67108864 then raise exception 'invalid_source_data'; end if;
  n:=jsonb_array_length(p_records);
  if exists(
    select 1 from jsonb_array_elements(p_records) with ordinality as e(r,ordinal)
    where jsonb_typeof(r)<>'object' or (r->>'rowNumber')::integer is distinct from ordinal::integer
      or jsonb_typeof(r->'fields') is distinct from 'array'
      or jsonb_array_length(r->'fields')<>jsonb_array_length(p_headers)
      or exists(select 1 from jsonb_array_elements(r->'fields') c where jsonb_typeof(c)<>'string')
      or nullif(r->>'bookingRef','') is null or nullif(r->>'recordKind','') is null
  ) then raise exception 'invalid_source_data'; end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('format',p_format,'scope',p_scope,
    'parser',p_parser_version,'headers',p_headers,'records',p_records)::text,'UTF8')),'hex');
  select * into existing from public.sirvoy_source_imports where archive_id=p_archive;
  if found then
    if existing.parsed_sha256<>fingerprint then raise exception 'source_already_indexed_differently'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'importId',existing.id,'rowCount',existing.row_count);
  end if;
  insert into public.sirvoy_source_imports(property_id,archive_id,created_by,source_format,cancellation_scope,
    parser_version,headers,row_count,warnings,parsed_sha256)
  values(p_property,p_archive,p_actor,p_format,p_scope,p_parser_version,p_headers,n,p_warnings,fingerprint)
  returning id into imported_id;
  insert into public.sirvoy_source_records(import_id,property_id,source_row,record_kind,booking_ref,room_ref,
    guest_name,guest_email,guest_phone,checkin_date,checkout_date,amount_raw,amount_decimal,payment_ref,payment_status,occurred_raw,fields)
  select imported_id,p_property,(r->>'rowNumber')::integer,r->>'recordKind',r->>'bookingRef',nullif(r->>'roomRef',''),
    r->>'guestName',r->>'guestEmail',r->>'guestPhone',nullif(r->>'checkIn','')::date,nullif(r->>'checkOut','')::date,
    r->>'amountRaw',r->>'amountDecimal',nullif(r->>'paymentRef',''),r->>'paymentStatus',r->>'occurredRaw',r->'fields'
  from jsonb_array_elements(p_records) r;
  select coalesce(jsonb_object_agg(record_kind,total),'{}') into kind_counts from (
    select record_kind,count(*) as total from public.sirvoy_source_records where import_id=imported_id group by record_kind
  ) counts;
  return jsonb_build_object('ok',true,'duplicate',false,'importId',imported_id,'rowCount',n,'recordKinds',kind_counts,
    'bookingCount',(select count(distinct booking_ref) from public.sirvoy_source_records where import_id=imported_id),
    'roomCount',(select count(distinct room_ref) from public.sirvoy_source_records where import_id=imported_id));
end $$;
revoke all on function public.index_sirvoy_source(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.index_sirvoy_source(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) to service_role;

create function public.read_sirvoy_source(
  p_actor uuid,p_property uuid,p_view text default 'records',p_search text default '',
  p_kind text default '',p_scope text default '',p_offset integer default 0,p_record uuid default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; total bigint;
begin
  if not exists(select 1 from public.properties where id=p_property and owner_id=p_actor) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if p_offset is null or p_offset not between 0 and 1000000 or p_search is null or length(p_search)>200
    or p_kind is null or length(p_kind)>100 or p_scope is null
    or p_scope not in ('','excluding_cancelled','cancelled','all','unknown') then raise exception 'invalid_request'; end if;
  if p_view='summary' then
    return jsonb_build_object(
      'sourceRows',(select count(*) from public.sirvoy_source_records where property_id=p_property),
      'bookingCount',(select count(distinct booking_ref) from public.sirvoy_source_records where property_id=p_property),
      'roomRefs',(select coalesce(jsonb_agg(room_ref order by room_ref),'[]') from (select distinct room_ref from public.sirvoy_source_records where property_id=p_property and room_ref is not null) rooms),
      'paymentCount',(select count(*) from public.sirvoy_source_payment_ledger where property_id=p_property),
      'paymentsNeedingReview',(select count(*) from public.sirvoy_source_payment_ledger where property_id=p_property and needs_review),
      'imports',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'archive_id',i.archive_id,'filename',a.filename,
        'format',i.source_format,'scope',i.cancellation_scope,'row_count',i.row_count,'warnings',i.warnings,'created_at',i.created_at) order by i.created_at,i.id),'[]')
        from public.sirvoy_source_imports i join public.sirvoy_export_archives a on a.id=i.archive_id where i.property_id=p_property));
  elsif p_view='detail' then
    select jsonb_build_object('record',to_jsonb(r)-'search_text','headers',i.headers,'format',i.source_format,
      'scope',i.cancellation_scope,'filename',a.filename,'archive_id',i.archive_id,'archive_sha256',a.sha256) into result
    from public.sirvoy_source_records r join public.sirvoy_source_imports i on i.id=r.import_id
      join public.sirvoy_export_archives a on a.id=i.archive_id
    where r.id=p_record and r.property_id=p_property;
    if result is null then raise exception 'record_not_found'; end if;
    return result;
  elsif p_view='payments' then
    select count(*) into total from public.sirvoy_source_payment_ledger
      where property_id=p_property and (p_search='' or strpos(lower(booking_ref||' '||coalesce(payment_ref,'')),lower(p_search))>0)
        and (p_scope='' or p_scope=any(source_scopes));
    select coalesce(jsonb_agg(to_jsonb(page) order by page.booking_ref,page.transaction_key),'[]') into result from (
      select * from public.sirvoy_source_payment_ledger where property_id=p_property
        and (p_search='' or strpos(lower(booking_ref||' '||coalesce(payment_ref,'')),lower(p_search))>0)
        and (p_scope='' or p_scope=any(source_scopes)) order by booking_ref,transaction_key limit 50 offset p_offset
    ) page;
    return jsonb_build_object('rows',result,'total',total,'hasMore',p_offset+50<total);
  elsif p_view<>'records' then raise exception 'invalid_request'; end if;
  select count(*) into total from public.sirvoy_source_records r join public.sirvoy_source_imports i on i.id=r.import_id
    where r.property_id=p_property and (p_search='' or strpos(r.search_text,lower(p_search))>0)
      and (p_kind='' or r.record_kind=p_kind) and (p_scope='' or i.cancellation_scope=p_scope);
  select coalesce(jsonb_agg(to_jsonb(page) order by page.booking_ref,page.id),'[]') into result from (
    select r.id,r.booking_ref,r.record_kind,r.room_ref,r.guest_name,r.guest_email,r.guest_phone,
      r.checkin_date,r.checkout_date,r.amount_raw,r.amount_decimal,r.payment_ref,r.payment_status,r.occurred_raw,
      r.source_row,i.source_format,i.cancellation_scope,i.archive_id,a.filename
    from public.sirvoy_source_records r join public.sirvoy_source_imports i on i.id=r.import_id
      join public.sirvoy_export_archives a on a.id=i.archive_id
    where r.property_id=p_property and (p_search='' or strpos(r.search_text,lower(p_search))>0)
      and (p_kind='' or r.record_kind=p_kind) and (p_scope='' or i.cancellation_scope=p_scope)
    order by r.booking_ref,r.id limit 50 offset p_offset
  ) page;
  return jsonb_build_object('rows',result,'total',total,'hasMore',p_offset+50<total);
end $$;
revoke all on function public.read_sirvoy_source(uuid,uuid,text,text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.read_sirvoy_source(uuid,uuid,text,text,text,text,integer,uuid) to service_role;

comment on table public.sirvoy_source_records is 'Read-only searchable Sirvoy source rows linked to exact archived files; never operational StayBoost bookings.';
comment on view public.sirvoy_source_payment_ledger is 'Signed source payment rows, not provider verification or new charges/refunds. Currency is unknown; contradictory copies require review.';
