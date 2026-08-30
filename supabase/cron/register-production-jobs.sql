-- StayBoost BP-4 production cron registration.
-- Körs EFTER att migrationer + Edge Functions är deployade och Vault innehåller:
--   project_url            = https://<project-ref>.supabase.co
--   stayboost_cron_secret  = samma värde som Edge Function-hemligheten CRON_SECRET
--
-- Exempel (kör med riktiga värden i Supabase SQL Editor, committa ALDRIG värdena):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random-long-secret>', 'stayboost_cron_secret');
--
-- Supabase rekommenderar pg_cron + pg_net + Vault för schemalagda Edge Functions.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'project_url'
  ) then
    raise exception 'Vault secret project_url saknas';
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'stayboost_cron_secret'
  ) then
    raise exception 'Vault secret stayboost_cron_secret saknas';
  end if;
end
$$;

-- Samma job name är avsiktlig: cron.schedule ersätter befintlig definition
-- i stället för att skapa dubbletter när setupen körs igen.
select cron.schedule(
  'stayboost-ops-cron',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/ops-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'stayboost_cron_secret'
      )
    ),
    body := jsonb_build_object(
      'trigger', 'pg_cron',
      'scheduledAt', now()
    ),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- Verifiering efter aktivering:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'stayboost-ops-cron';
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select job_name, last_started_at, last_succeeded_at, last_failed_at, last_error
--     from public.ops_job_state order by job_name;
