-- StayBoost: direktbokningsmotorn — prismodell per enhet + publik slug.
-- Smoobu-inspirerat men enklare: baspris, helgpåslag, månadsvisa
-- säsongsfaktorer, minsta vistelse och städavgift per enhet.

alter table public.units
  add column base_price int not null default 995,
  add column weekend_pct int not null default 25,
  add column min_stay int not null default 1,
  add column cleaning_fee int not null default 0,
  -- jan..dec i procent av baspriset (jun–aug 100, maj/sep 85, övrigt 70)
  add column monthly_mult numeric[] not null
    default '{70,70,70,70,85,100,100,100,85,70,70,70}';

-- Publik, delbar adress till bokningssidan: /boka/<slug>
alter table public.properties
  add column slug text;

update public.properties
  set slug = 'anlaggning-' || substr(encode(gen_random_bytes(3), 'hex'), 1, 6)
  where slug is null;

alter table public.properties
  alter column slug set not null,
  alter column slug set default ('anlaggning-' || substr(encode(gen_random_bytes(3), 'hex'), 1, 6));

alter table public.properties
  add constraint properties_slug_unique unique (slug);

-- Direktbokningar från den publika bokningssidan
alter table public.bookings drop constraint bookings_source_check;
alter table public.bookings
  add constraint bookings_source_check check (source in ('manual', 'ical', 'direct'));
