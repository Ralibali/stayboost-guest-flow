-- När ska ett tillval synas i driftöversikten?
-- arrival = ankomstdagen (t.ex. välkomstpaket)
-- each_stay_day = varje dag gästen disponerar tjänsten (t.ex. cykel)
-- each_morning = morgonen efter varje övernattning (t.ex. frukost)
alter table public.addons
  add column if not exists service_timing text not null default 'arrival'
  check (service_timing in ('arrival', 'each_stay_day', 'each_morning'));
