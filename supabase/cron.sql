-- StayBoost Fas 1-cron — kör MANUELLT i Supabase SQL Editor efter deploy
-- (ingår inte i migrationen eftersom den kräver cron_secret i Vault
--  och projektets URL). Byt <PROJEKT-REF> mot projektets referens.
--
-- Förberedelse:
--   1. Supabase Dashboard → Project Settings → Vault → skapa hemligheten
--      "cron_secret" med samma värde som edge-funktionernas CRON_SECRET.
--   2. Aktivera tilläggen pg_cron och pg_net (Database → Extensions).

select cron.schedule('stayboost-ical-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<PROJEKT-REF>.supabase.co/functions/v1/ical-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb);
$$);

select cron.schedule('stayboost-dispatch', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<PROJEKT-REF>.supabase.co/functions/v1/send-scheduled-messages',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb);
$$);
