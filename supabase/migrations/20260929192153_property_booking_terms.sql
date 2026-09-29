-- Each property can link its own guest booking terms without relying on build-time globals.
alter table public.properties add column booking_terms_url text,
  add constraint property_booking_terms_https check (
    booking_terms_url is null or (
      length(booking_terms_url) between 1 and 2048
      and booking_terms_url ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
    )
  );
comment on column public.properties.booking_terms_url is
  'Public HTTPS guest booking terms. Owner-configured; never contains access credentials.';
