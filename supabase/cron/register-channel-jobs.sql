-- Opt-in only, after Channex certification, secrets and channel configuration.
-- Requires the existing Vault project_url and stayboost_cron_secret setup in
-- register-production-jobs.sql. Connections remain disabled until the owner
-- verifies mappings, registers a webhook and explicitly enables the connection.
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='project_url')
    or not exists(select 1 from vault.decrypted_secrets where name='stayboost_cron_secret') then
    raise exception 'Configure project_url and stayboost_cron_secret in Vault first';
  end if;
end $$;

-- Minute batches follow Channex's 30–60 second sync guidance. The same job name
-- replaces its previous definition rather than creating another scheduler.
select cron.schedule('stayboost-channel-sync','* * * * *',$$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/channel-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='stayboost_cron_secret')),
    body := jsonb_build_object('action','cron'),
    timeout_milliseconds := 120000
  );
$$);
