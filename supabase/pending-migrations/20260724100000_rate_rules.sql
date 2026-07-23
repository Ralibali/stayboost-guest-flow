-- StayBoost: datumstyrda pris- och tillgänglighetsregler per boende.
-- En regel gäller för en enhet (eller hela anläggningen om unit_id är null)
-- under [date_from, date_to] och kan sätta fast nattpris, procentjustering,
-- minsta vistelse eller blockera ankomst/avresa/hela datum.
-- Server-side prissättning i booking-engine är enda sanningskälla och läser
-- dessa regler före monthly_mult / weekend_pct.
--
-- Reglerna tillämpas per natt. Vid överlapp vinner högre `priority`
-- (fallback: senast skapad). `active = false` inaktiverar regeln utan att
-- radera den — bra för säsonger och kampanjer.

create type public.rate_rule_kind as enum (
  'price_override',   -- sätt exakt nattpris (fixed_price krävs)
  'price_multiplier', -- justera nattpriset med pct_delta (%)
  'min_stay',         -- kräv minst N nätter om vistelsen berör datumet
  'closed',           -- blockera datumet helt för direktbokning
  'no_arrival',       -- gäster får inte checka in detta datum
  'no_departure'      -- gäster får inte checka ut detta datum
);

create table if not exists public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  name text,
  kind public.rate_rule_kind not null,
  date_from date not null,
  date_to date not null,
  fixed_price int check (fixed_price is null or (fixed_price between 0 and 1000000)),
  pct_delta int check (pct_delta is null or (pct_delta between -90 and 500)),
  min_stay int check (min_stay is null or (min_stay between 1 and 30)),
  priority int not null default 0,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_to >= date_from),
  check (
    (kind = 'price_override'   and fixed_price is not null) or
    (kind = 'price_multiplier' and pct_delta   is not null) or
    (kind = 'min_stay'         and min_stay    is not null) or
    (kind in ('closed','no_arrival','no_departure'))
  )
);

grant select, insert, update, delete on public.rate_rules to authenticated;
grant all on public.rate_rules to service_role;

alter table public.rate_rules enable row level security;

create policy "owners manage rate rules"
  on public.rate_rules for all to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = rate_rules.property_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.properties p
    where p.id = rate_rules.property_id and p.owner_id = auth.uid()
  ));

-- Publika bokningsmotorn (service-role) läser aktiva, framtidsrelevanta regler.
create index if not exists rate_rules_lookup_idx
  on public.rate_rules (property_id, unit_id, date_from, date_to)
  where active;

create index if not exists rate_rules_active_idx
  on public.rate_rules (property_id, active);

create or replace function public.rate_rules_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger rate_rules_updated_at
  before update on public.rate_rules
  for each row execute function public.rate_rules_touch_updated_at();
