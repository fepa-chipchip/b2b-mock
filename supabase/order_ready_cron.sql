-- Every minute, Supabase calls the app's GET /api/cron/order-ready, which tells Zeami about orders that became ready.
-- Run once in Supabase -> SQL Editor, after supabase/add_zeami_notify.sql (or schema.sql), with the two placeholders
-- replaced. Safe to run again (it updates the secrets and the job). pg_cron, pg_net and Vault are on every Supabase
-- plan; Vercel's own cron cannot run every minute on the Hobby plan, which is why the timer lives here.
--
--   <APP_URL>      the deployed site, e.g. https://<project>.vercel.app (no trailing slash)
--   <CRON_SECRET>  the same value as the CRON_SECRET environment variable in Vercel
--
-- Both are kept in Vault, so the job's text in cron.job holds neither.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  want jsonb := jsonb_build_object(
    'order_ready_cron_url', '<APP_URL>/api/cron/order-ready',
    'order_ready_cron_secret', '<CRON_SECRET>');
  k text;
  found uuid;
begin
  if want::text like '%<APP_URL>%' or want::text like '%<CRON_SECRET>%' then
    raise exception 'Replace <APP_URL> and <CRON_SECRET> first';
  end if;
  for k in select jsonb_object_keys(want) loop
    select id into found from vault.secrets where name = k;
    if found is null then perform vault.create_secret(want->>k, k);
    else perform vault.update_secret(found, want->>k);
    end if;
  end loop;
end $$;

-- Same name again replaces the job.
select cron.schedule('zeami-order-ready', '* * * * *', $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'order_ready_cron_url'),
    headers := jsonb_build_object('authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'order_ready_cron_secret')),
    timeout_milliseconds := 30000);
$job$);

-- Checks:
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, content, created from net._http_response order by created desc limit 5;
--     (200 with {"ok":true,"sent":..}; 401 = CRON_SECRET differs; "notify":"off" = ZEAMI_HOOK_URL unset in Vercel)
-- Stop:
--   select cron.unschedule('zeami-order-ready');
