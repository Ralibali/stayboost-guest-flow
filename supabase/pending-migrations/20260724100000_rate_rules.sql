-- StayBoost: datumstyrda prisregler, stängda datum och ankomst-/avresespärrar.
-- En regel gäller för en enhet under [date_from, date_to] och kan sätta
-- fast pris, procentpåslag, minsta vistelse eller blockera ankomst/avresa/hela datum.
-- Server-side prissättning läser dessa regler före monthly_mult / weekend_pct.

create type public.rate_rule_kind as enum (
  'price_override',
  'price_multiplier',
  'min_stay',
  'closed',
  'no_arrival',
  'no_departure'
);

create table if not exists public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  kind public.rate_rule_kind not null,
  date_from date not null,
  date_to date not null,
  fixed_price int check (fixed_price is null or fixed_price >= 0),
  pct_delta int check (pct_delta is null or pct_delta between -90 and 500),
  min_stay int check (min_stay is null or (min_stay between 1 and 30)),
  note text,
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
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

create index if not exists rate_rules_lookup
  on public.rate_rules (property_id, unit_id, date_from, date_to);
