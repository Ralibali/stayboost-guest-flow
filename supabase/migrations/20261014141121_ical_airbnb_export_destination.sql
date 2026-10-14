-- Preserve the existing Booking.com projection and append exact Airbnb origin.
-- Unknown origin stays occupied. Never infer a channel from names or dates.
create or replace view public.ical_export_bookings with (security_invoker=true) as
select b.id,b.property_id,b.unit_id,b.status,b.checkin_date,b.checkout_date,
  (coalesce(s.channel_type='booking',false) or
    coalesce(public.sirvoy_source_field(r.fields,i.headers,'Booking source')='Booking.com',false)
  ) as booking_com_origin,
  (coalesce(s.channel_type='airbnb',false) or
    coalesce(public.sirvoy_source_field(r.fields,i.headers,'Booking source')='Airbnb',false)
  ) as airbnb_origin
from public.bookings b
left join public.ical_sources s on s.id=b.ical_source_id and s.property_id=b.property_id
left join public.sirvoy_source_records r on r.id=b.source_booking_record_id
  and r.property_id=b.property_id and r.record_kind='BOOKING'
left join public.sirvoy_source_imports i on i.id=r.import_id
  and i.property_id=b.property_id and i.source_format='bookings_condensed';

revoke all on public.ical_export_bookings from public,anon,authenticated,service_role;
grant select on public.ical_export_bookings to service_role;
comment on view public.ical_export_bookings is
  'Private date-only projection. Exact Booking.com or Airbnb origin is omitted only from its matching destination feed; unknown origins stay blocked.';
