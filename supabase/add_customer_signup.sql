-- New-customer sign-up through the order bot, added to a live mock database without re-running schema.sql
-- (which wipes test data). Safe to run more than once. schema.sql carries the same columns and table.
--
--   fake B2B:   customers get the columns the real "Add customer" form and Telegram sign-up write
--               (latitude, longitude, location_accuracy, source), and email is unique as on the real table.
--   fake Admin: a last-mile location carries its map point and contact, as POST /locations sends them.
--   order bot:  bot_signups holds what an unknown number told the bot until Simenesh decides.

alter table b2b_customers add column if not exists latitude numeric;
alter table b2b_customers add column if not exists longitude numeric;
alter table b2b_customers add column if not exists location_accuracy numeric;
alter table b2b_customers add column if not exists source text;
-- The real table refuses a second customer with the same email (23505). Old mock rows have '' as email.
create unique index if not exists b2b_customers_email_key on b2b_customers (email) where email <> '';

alter table adm_locations add column if not exists latitude numeric;
alter table adm_locations add column if not exists longitude numeric;
alter table adm_locations add column if not exists delivery_type text;
alter table adm_locations add column if not exists additional_contact_name text;

-- One sign-up: an unknown number that answered the bot's questions. The agent reads the ones waiting for Simenesh,
-- asks her, creates the customer in both systems and then sets registered (or declined).
create table if not exists bot_signups (
  id serial primary key,
  telegram_id bigint not null,
  telegram_chat_id bigint not null,
  phone text not null,               -- digits with country code, as shared through Telegram
  telegram_name text,
  step text not null default 'business_name',  -- business_name | business_type | tin | location | done
  business_name text,
  business_type text,                -- Restaurant | Hotel | Corporate | Other (the customer's own words when Other)
  tin text,                          -- null when they have none
  address text,                      -- the place name they typed, or Telegram's venue title
  latitude numeric,
  longitude numeric,
  status text not null default 'collecting',  -- collecting | waiting_approval | registered | declined
  agent_note text,
  b2b_customer_id uuid,              -- set by the agent once created
  admin_company_id uuid,
  admin_user_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists bot_signups_telegram on bot_signups (telegram_id, status);
alter table bot_signups enable row level security;
