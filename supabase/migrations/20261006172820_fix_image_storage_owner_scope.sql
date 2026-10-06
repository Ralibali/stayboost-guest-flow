-- Qualify the outer storage object name: inside the properties subquery, an
-- unqualified name resolves to properties.name and rejects valid owner uploads.
-- Only replace the six existing write predicates. Keep their roles, commands,
-- public reads, buckets, and property-folder ownership boundary unchanged.

alter policy "owner uploads unit images" on storage.objects
  with check (
    objects.bucket_id = 'unit-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  );

alter policy "owner updates unit images" on storage.objects
  using (
    objects.bucket_id = 'unit-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  ) with check (
    objects.bucket_id = 'unit-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  );

alter policy "owner deletes unit images" on storage.objects
  using (
    objects.bucket_id = 'unit-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  );

alter policy "owner uploads addon images" on storage.objects
  with check (
    objects.bucket_id = 'addon-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  );

alter policy "owner updates addon images" on storage.objects
  using (
    objects.bucket_id = 'addon-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  ) with check (
    objects.bucket_id = 'addon-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  );

alter policy "owner deletes addon images" on storage.objects
  using (
    objects.bucket_id = 'addon-images'
    and exists (
      select 1 from public.properties p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[1]
    )
  );
