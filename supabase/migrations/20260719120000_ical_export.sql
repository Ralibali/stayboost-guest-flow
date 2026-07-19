-- StayBoost: iCal-export per enhet (tvåvägssynk).
-- Kanalerna pollar denna publika .ics-länk och blockerar datum som är
-- bokade via andra kanaler/direkt. Token i länken är nyckeln — inga
-- gästuppgifter lämnas ut i flödet, bara blockerade datum.

alter table public.units
  add column ical_feed_token text not null default encode(gen_random_bytes(12), 'hex');

create unique index units_ical_feed_token_key on public.units (ical_feed_token);
