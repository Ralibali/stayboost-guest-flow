-- StayBoost: datumstyrda pris- och tillgänglighetsregler.

create type public.rate_rule_kind as enum (
  'price_override',
  'price_multiplier',
  'min_stay',
  'closed',
  'no_arrival',
  'no_departure'
);

create table public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  name text,
  kind public.rate_rule_kind not null,
  date_from date not null,
  date_to date not null,
  fixed_price integer,
  pct_delta integer,
  min_stay integer,
  priority integer not null default 0,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_rules_dates check (date_to >= date_from),
  constraint rate_rules_price check (fixed_price is null or fixed_price >= 0),
  constraint rate_rules_pct check (pct_delta is null or pct_delta between -90 and 500),
  constraint rate_rules_min_stay check (min_stay is null or min_stay between 1 and 30),
  constraint rate_rules_payload check (
    (kind = 'price_override' and fixed_price is not null and pct_delta is null and min_stay is null)
    or (kind = 'price_multiplier' and pct_delta is not null and fixed_price is null and min_stay is null)
    or (kind = 'min_stay' and min_stay is not null and fixed_price is null and pct_delta is null)
    or (kind in ('closed','no_arrival','no_departure') and fixed_price is null and pct_delta is null and min_stay is null)
  )
);

create index rate_rules_property_dates on public.rate_rules(property_id, date_from, date_to);
create index rate_rules_unit_dates on public.rate_rules(unit_id, date_from, date_to) where unit_id is not null;
create index rate_rules_active_priority on public.rate_rules(property_id, active, priority desc);

alter table public.rate_rules enable row level security;

grant select, insert, update, delete on public.rate_rules to authenticated;
grant all on public.rate_rules to service_role;

create policy "owners manage rate rules"
  on public.rate_rules for all to authenticated
  using (public.owns_property(property_id))
  with check (public.owns_property(property_id));

create trigger rate_rules_updated_at
  before update on public.rate_rules
  for each row execute function public.set_updated_at();
