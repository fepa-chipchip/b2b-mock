-- "Order ready" notices to Zeami, added to a live mock database without re-running schema.sql (which wipes test
-- data). Safe to run more than once. schema.sql carries the same columns and functions.
--
-- An order is ready once its sender has been quiet 90 s (GET /api/agent/inbox's rule). Vercel has no timer, so a job
-- calls GET /api/cron/order-ready every minute (supabase/order_ready_cron.sql) and the bot's webhook looks too on
-- every incoming message. Both go through claim_ready_orders(), which hands each ready order to one caller only, and
-- finish_ready_order(), which records it as announced once Zeami took it (lib/readyOrders.ts).
--
--   ready_notified_for  the last_message_at already announced. A message after it makes the order ready again.
--   ready_notices       how many times it was announced (the event id's round: order-<id>-ready, order-<id>-ready-2)
--   ready_claimed_at    a caller is announcing it now; a claim older than 2 minutes is free again
--   ready_claimed_for   the last_message_at that caller is announcing

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inbox' and column_name = 'ready_notified_for') then
    alter table inbox add column ready_notified_for timestamptz;
    -- Orders from before this file are not announced: only what arrives from now on starts the agent.
    update inbox set ready_notified_for = last_message_at;
  end if;
end $$;
alter table inbox add column if not exists ready_notices int not null default 0;
alter table inbox add column if not exists ready_claimed_at timestamptz;
alter table inbox add column if not exists ready_claimed_for timestamptz;
create index if not exists inbox_collecting_last_message on inbox (last_message_at) where status = 'collecting';

-- Orders that became ready and are not announced yet, claimed for the caller (skip locked: two callers at once never
-- get the same order). Only orders quiet for less than p_max_age_seconds: one left in collecting for days, or a backlog
-- from while the link was unset, does not start the agent. Answers (inbox_id, round).
create or replace function claim_ready_orders(p_quiet_seconds int default 90, p_max_age_seconds int default 86400,
                                              p_limit int default 20)
returns table (inbox_id int, round int)
language sql
set search_path = public
as $$
  update inbox i
     set ready_claimed_at = now(), ready_claimed_for = i.last_message_at
    from (select id from inbox
           where status = 'collecting'
             and last_message_at <= now() - make_interval(secs => p_quiet_seconds)
             and last_message_at >  now() - make_interval(secs => p_max_age_seconds)
             and (ready_notified_for is null or ready_notified_for < last_message_at)
             and (ready_claimed_at is null or ready_claimed_at < now() - interval '2 minutes')
           order by last_message_at
           limit p_limit
           for update skip locked) c
   where i.id = c.id
  returning i.id, i.ready_notices + 1;
$$;

-- After the POST to Zeami: sent records the claimed round as announced; not sent frees the claim so the next call
-- tries again with the same round (same event id, so Zeami drops it if the first try did arrive).
create or replace function finish_ready_order(p_inbox_id int, p_round int, p_sent boolean)
returns void
language sql
set search_path = public
as $$
  update inbox
     set ready_notified_for = case when p_sent then ready_claimed_for else ready_notified_for end,
         ready_notices      = case when p_sent then greatest(ready_notices, p_round) else ready_notices end,
         ready_claimed_at   = null
   where id = p_inbox_id;
$$;

-- Only the server (service role) calls them.
revoke all on function claim_ready_orders(int, int, int) from public, anon, authenticated;
revoke all on function finish_ready_order(int, int, boolean) from public, anon, authenticated;
grant execute on function claim_ready_orders(int, int, int) to service_role;
grant execute on function finish_ready_order(int, int, boolean) to service_role;
notify pgrst, 'reload schema';
