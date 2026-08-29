-- StayBoost Fas 1-cron — OBLIGATORISKT, kör MANUELLT i Supabase SQL Editor.
-- Ingår inte i migrationerna (kräver cron_secret i Vault + projekt-URL).
-- Utan detta: inga iCal-uppdateringar, inga gästpåminnelser, inga Swish-timeouts.
-- Den här filen deployar inte cron. Verifiera med select * from cron.job;
-- Byt <PROJEKT-REF> mot projektets referens. Se DEPLOY.md steg 5.
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
