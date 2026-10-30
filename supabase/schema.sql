-- B2B order mock: paste the whole file into Supabase -> SQL Editor -> Run.
-- Safe to re-run: it drops every mock table and re-creates it, so it ALSO WIPES all test orders, carts and messages.
--
-- Three groups of tables live here:
--   b2b_*   the fake ChipChip B2B (its PostgREST tables, served at /b2b/rest/v1/<name without b2b_>)
--   adm_*   the fake ChipChip Admin (served by the Go-API copy at /admin-api/v1 and /v2)
--   the rest: the order bot (ours, kept at go-live), the four questions, feedback, and the mock's own logins.
-- Every customer, company and person is invented (phones 2519000000xx, TINs 00000001xx).
-- Product names and units follow ChipChip's catalogue; prices are samples.

drop table if exists
  -- old mock tables (before the two systems were split)
  orders, locations, staff_companies, staff, products, companies,
  -- bot, settings, feedback, logins
  feedback, inbox_messages, inbox, bot_contacts, settings, mock_sessions, mock_accounts,
  -- fake Admin
  adm_orders, adm_group_carts, adm_groups, adm_locations, adm_payment_methods, adm_group_deals, adm_products,
  adm_b2b_customer_users, adm_users, adm_b2b_customers, adm_customer_types,
  -- fake B2B
  b2b_order_items, b2b_orders, b2b_product_prices, b2b_products, b2b_payment_types, b2b_pricing_settings,
  b2b_customers, b2b_customer_types, b2b_profiles
cascade;

-- =====================================================================================================
-- Fake ChipChip B2B (columns copied from b2bchip src/integrations/supabase/types.ts, reduced)
-- =====================================================================================================
create table b2b_profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  role text not null default 'operations',  -- admin | finance | operations | sales_agent | ...
  is_active boolean not null default true,
  created_at timestamptz default now()
);

create table b2b_customer_types (
  id uuid primary key,
  name text not null,
  tax_exempt boolean not null default false,
  custom_tax_rate numeric,
  icon text,
  is_active boolean not null default true,
  is_excluded_from_main_business boolean not null default false,
  exclusion_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table b2b_customers (
  id uuid primary key,
  name text not null,
  phone text,
  email text not null default '',
  address text,
  customer_type_id uuid not null references b2b_customer_types(id),
  type text,
  is_active boolean not null default true,
  approval_status text default 'approved',
  credit_limit numeric not null default 100000,
  credit_status text not null default 'good',  -- good | overdue | suspended | legal_process | credit_limit_exceeded | approved_override
  agreement_url text,
  agreement_date text,
  tin_number text,                              -- same TIN as the company in Admin: how the two systems are matched
  tax_exempt_override boolean default false,
  tax_exempt_reason text,
  legal_process_initiated boolean default false,
  legal_process_date timestamptz,
  assigned_sales_agent_id uuid,
  telegram_id bigint,
  created_at timestamptz not null default now()
);

create table b2b_products (
  id uuid primary key,
  name text not null,
  price numeric not null,          -- base price, ETB per unit
  unit text not null,
  weight numeric,                  -- kg per unit
  quantity numeric not null default 500,  -- stock on hand
  status text not null default 'active',
  approval_status text default 'approved',
  short_description text,
  created_at timestamptz default now()
);

create table b2b_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references b2b_products(id) on delete cascade,
  customer_type text not null,     -- the customer type NAME, as in the real table
  price numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table b2b_payment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  label text not null,
  description text,
  is_active boolean not null default true,
  configuration jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table b2b_pricing_settings (
  id uuid primary key default gen_random_uuid(),
  tax_rate numeric not null default 15,
  delivery_fee_base numeric not null default 0,
  delivery_fee_threshold_kg numeric not null default 1
);

create table b2b_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references b2b_customers(id),
  date timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  delivery_date date,
  status text not null default 'Processing',
  payment_type text not null,
  payment_status text not null,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  discount_reason text,
  tax_rate numeric not null default 0,
  tax_amount numeric not null default 0,
  delivery_fee numeric default 0,
  amount numeric not null default 0,
  total_quantity numeric not null default 0,
  notes text,
  source text not null default 'web',
  warehouse_id uuid,
  fs_number text
);

create table b2b_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references b2b_orders(id) on delete cascade,
  product_id uuid references b2b_products(id),
  product_name text not null,
  quantity numeric not null,
  price numeric not null,
  total numeric not null,
  created_at timestamptz default now()
);

-- =====================================================================================================
-- Fake ChipChip Admin (shapes from chipadminreact docs/B2B.md and src/components/pages/b2b/**)
-- =====================================================================================================
create table adm_customer_types (
  id uuid primary key,
  name text not null,
  tax_exempt boolean not null default false,
  custom_tax_rate numeric,
  is_active boolean not null default true
);

create table adm_b2b_customers (
  id uuid primary key,
  business_name text not null,
  tin text,
  phone text,
  status text not null default 'ACTIVE',
  credit_limit numeric not null default 0,
  payment_terms_days int not null default 30,
  credit_status text not null default 'GOOD',
  charge_vat boolean,
  customer_type_id uuid references adm_customer_types(id),
  wallet_account_id text,
  wallet_balance numeric not null default 0,   -- the wallet service's live balance; negative = owed
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table adm_users (
  id uuid primary key,
  name text not null,
  phone text unique,               -- digits with country code, 2519...
  email text,
  telegram_id bigint,
  status text not null default 'ACTIVE',
  is_system boolean not null default false,   -- a back-office account: may call /system/*
  created_at timestamptz not null default now()
);

create table adm_b2b_customer_users (
  id uuid primary key default gen_random_uuid(),
  b2b_customer_id uuid not null references adm_b2b_customers(id) on delete cascade,
  user_id uuid not null references adm_users(id) on delete cascade,
  role text not null default 'MEMBER',        -- ADMIN | MEMBER
  created_at timestamptz not null default now(),
  unique (b2b_customer_id, user_id)
);

create table adm_products (
  id uuid primary key,
  name text not null,
  measuring_unit text not null,
  primary_image text not null default '',
  product_status text not null default 'ACTIVE',
  current_unit_price numeric,
  remaining_stock numeric not null default 500,
  vendor_id uuid
);

create table adm_group_deals (
  id uuid primary key,
  product_id uuid not null references adm_products(id) on delete cascade,
  deal_type text not null default 'B2B',
  group_price numeric not null,
  min_quantity_per_order numeric not null default 1,
  max_quantity_per_order numeric not null default 1000,
  max_group_member int not null default 1,
  expiration_time int not null default 24,
  lead_time text not null default '24h',
  reorder_wait_time text not null default '0h'
);

create table adm_payment_methods (
  id uuid primary key,
  name text not null,
  sort int not null default 0
);

-- A shopper's saved last-mile delivery locations (GET /locations/last_mile answers per user)
create table adm_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references adm_users(id) on delete cascade,
  name text not null,
  location_title text,
  contact_phone text
);

create table adm_groups (
  id uuid primary key default gen_random_uuid(),
  group_deals_id uuid not null references adm_group_deals(id),
  user_id uuid not null references adm_users(id),
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);

create table adm_group_carts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references adm_groups(id) on delete cascade,
  user_id uuid not null references adm_users(id),
  quantity numeric not null,
  ordered boolean not null default false,
  created_at timestamptz not null default now()
);

-- One row per group cart line, as Admin shows them (one row per product)
create table adm_orders (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null,
  user_id uuid not null references adm_users(id),
  b2b_customer_id uuid references adm_b2b_customers(id),
  group_cart_id uuid references adm_group_carts(id) on delete set null,
  product_id uuid references adm_products(id),
  item_name text not null,
  quantity numeric not null,
  unit_price numeric not null,
  subtotal numeric not null,
  total_amount numeric not null,
  status text not null default 'PENDING',
  location_id uuid references adm_locations(id) on delete set null,
  location_name text,
  delivery_note text,
  payment_method_id uuid,
  with_packaging boolean not null default true,
  is_b2b_order boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================================================
-- The mock's own logins (one table for both fake systems) and sessions
-- =====================================================================================================
create table mock_accounts (
  system text not null,            -- 'b2b' (login = email) | 'admin' (login = phone, digits)
  login text not null,
  password_sha256 text not null,   -- hex sha256 of the test password; edit the row to change it
  user_id uuid not null,           -- b2b_profiles.id or adm_users.id
  primary key (system, login)
);

create table mock_sessions (
  token text primary key,
  system text not null,            -- 'b2b' | 'admin'
  kind text not null,              -- 'user' (logged in) | 'shopper' (handed out by /system/users lookups)
  user_id uuid not null,
  expires_at timestamptz not null
);

-- =====================================================================================================
-- The order bot (our own service), the four questions, feedback
-- =====================================================================================================
create table bot_contacts (
  telegram_id bigint primary key,
  phone text not null,             -- digits with country code, as shared through Telegram
  telegram_name text,
  linked_at timestamptz default now()
);

create table settings (
  key text primary key,
  value text not null,
  answered_by text,
  comment text,
  updated_at timestamptz default now()
);

-- One order as the customer sent it: one or more Telegram messages grouped together
create table inbox (
  id serial primary key,
  telegram_chat_id bigint not null,
  sender_phone text,
  sender_name text,
  admin_user_id uuid,              -- the sender as a linked user in Admin
  company_id uuid,                 -- the Admin company (adm_b2b_customers.id), once known
  status text not null default 'collecting',  -- collecting | waiting_company | asked | proposed | created | rejected | unknown_sender
  agent_note text,
  b2b_order_number text,
  admin_bill_id text,
  created_at timestamptz default now(),
  last_message_at timestamptz default now()
);

create table inbox_messages (
  id serial primary key,
  inbox_id int not null references inbox(id) on delete cascade,
  kind text not null,              -- text | photo | document
  text text,
  file_path text,                  -- in the order-files storage bucket
  file_name text,
  created_at timestamptz default now()
);

create table feedback (
  id serial primary key,
  about text not null,             -- 'b2b-order:ORD-...', 'admin-bill:<uuid>', 'setting:q1', 'general', 'setup'
  ok boolean,
  comment text,
  created_at timestamptz default now()
);

-- =====================================================================================================
-- Sample data. Ids are md5(<label>)::uuid so they stay the same on every re-run.
-- =====================================================================================================
create temporary table seed_products (n int, name text, unit text, price numeric, deal_price numeric, weight numeric);
insert into seed_products values
  (1,  'Potato',              'kg',     49.50,  49.50, 1),
  (2,  'Potato for Chips',    'kg',     55.00,  55.00, 1),
  (3,  'Tomato A',            'kg',     77.00,  77.00, 1),
  (4,  'Tomato A Raw',        'kg',     77.00,  77.00, 1),
  (5,  'Red Onion habesha',   'kg',    113.30, 113.30, 1),
  (6,  'Carrot',              'kg',     74.80,  74.80, 1),
  (7,  'White Cabbage',       'kg',     58.30,  58.30, 1),
  (8,  'Beetroot',            'kg',     77.00,  77.00, 1),
  (9,  'Avocado Ripe',        'kg',    145.00, 145.00, 1),
  (10, 'Garlic',              'kg',    308.00, 308.00, 1),
  (11, 'Ginger',              'kg',    137.50, 137.50, 1),
  (12, 'Green Chili',         '0.5 kg', 104.50, 104.50, 0.5),
  (13, 'Indian chilli',       'kg',    220.00, 220.00, 1),
  (14, 'Coriander',           'pcs',    77.00,  77.00, 0.1),
  (15, 'Cauliflower',         'kg',    209.00, 209.00, 1),
  (16, 'Broccoli',            'kg',    181.50, 181.50, 1),
  (17, 'Green Beans',         'kg',    139.70, 139.70, 1),
  (18, 'Lemon',               'kg',    181.50, 181.50, 1),
  (19, 'Papaya',              'kg',     90.00,  90.00, 1),
  (20, 'Sugar',               'kg',    209.00, 209.00, 1),
  (21, 'Difen Miser (Local)', 'kg',    319.00, 319.00, 1),
  (22, 'Viva sofit',          'pcs',   126.50, 126.50, 0.2),
  (23, 'OK Pasta',            'pcs',    95.00,  95.00, 0.5),
  (24, 'Ottima Pasta',        'pcs',    98.00,  98.00, 0.5),
  (25, 'Wakene Flour',        'kg',     92.00,  92.00, 1),
  (26, 'Addis Tea',           'pcs',   183.75, 183.75, 0.25);

-- ---------------------------------------------------------------- fake B2B
insert into b2b_profiles (id, email, full_name, role) values
  (md5('b2b-profile-agent')::uuid,    'order-agent@mock.chipchip.test', 'Zeami order agent (test)', 'operations'),
  (md5('b2b-profile-simenesh')::uuid, 'simenesh@mock.chipchip.test',    'Simenesh (test)',          'operations');

insert into b2b_customer_types (id, name) values
  (md5('b2b-type-restaurant')::uuid, 'Restaurant'),
  (md5('b2b-type-hotel')::uuid,      'Hotel'),
  (md5('b2b-type-corporate')::uuid,  'Corporate');

insert into b2b_customers (id, name, phone, address, customer_type_id, type, credit_limit, agreement_url, agreement_date, tin_number) values
  (md5('co-abay')::uuid,   'Abay Bar & Restaurant',       '+251900000101', 'Kazanchis, Addis Ababa',        md5('b2b-type-restaurant')::uuid, 'Restaurant', 100000, 'agreements/abay.pdf',   '2026-03-01', '0000000101'),
  (md5('co-entoto')::uuid, 'Entoto View Hotel',           '+251900000102', 'Africa Avenue, Addis Ababa',    md5('b2b-type-hotel')::uuid,      'Hotel',      100000, 'agreements/entoto.pdf', '2026-04-12', '0000000102'),
  (md5('co-sheger')::uuid, 'Sheger Pharma PLC (canteen)', '+251900000103', 'Akaki, Addis Ababa',            md5('b2b-type-corporate')::uuid,  'Corporate',  100000, 'agreements/sheger.pdf', '2026-05-20', '0000000103'),
  (md5('co-bole')::uuid,   'Bole Burger House',           '+251900000104', 'Bole Medhanialem, Addis Ababa', md5('b2b-type-restaurant')::uuid, 'Restaurant', 50000,  null,                    null,         '0000000104');

insert into b2b_products (id, name, price, unit, weight)
  select md5('b2b-product-' || n)::uuid, name, price, unit, weight from seed_products;

-- Hotels have their own price on a few products (the real app takes product_prices over products.price)
insert into b2b_product_prices (product_id, customer_type, price) values
  (md5('b2b-product-1')::uuid, 'Hotel', 47.00),
  (md5('b2b-product-3')::uuid, 'Hotel', 74.00),
  (md5('b2b-product-5')::uuid, 'Hotel', 109.00);

insert into b2b_payment_types (name, label) values
  ('cash',    'Cash on Delivery'),
  ('credit',  'Credit (Net 30)'),
  ('prepaid', 'Pre-paid');

insert into b2b_pricing_settings (tax_rate, delivery_fee_base, delivery_fee_threshold_kg) values (15, 0, 1);

-- Earlier unpaid credit orders: Abay's and Entoto's are inside the 7-day grace; Bole's is 12 days old, so Bole is overdue.
insert into b2b_orders (id, order_number, customer_id, date, created_at, delivery_date, status, payment_type, payment_status,
                        subtotal, tax_rate, tax_amount, amount, total_quantity, source) values
  (md5('b2b-order-abay')::uuid,   'ORD-1761800000000-1001', md5('co-abay')::uuid,   now() - interval '2 days',  now() - interval '2 days',  current_date - 1,  'Delivered', 'credit', 'credit', 15499.00, 15, 2324.85, 17823.85, 230, 'web'),
  (md5('b2b-order-entoto')::uuid, 'ORD-1761700000000-1002', md5('co-entoto')::uuid, now() - interval '3 days',  now() - interval '3 days',  current_date - 2,  'Delivered', 'credit', 'credit', 46164.00, 15, 6924.60, 53088.60, 480, 'web'),
  (md5('b2b-order-bole')::uuid,   'ORD-1760900000000-1003', md5('co-bole')::uuid,   now() - interval '12 days', now() - interval '12 days', current_date - 11, 'Delivered', 'credit', 'credit', 48400.00, 15, 7260.00, 55660.00, 800, 'web');

insert into b2b_order_items (order_id, product_id, product_name, quantity, price, total) values
  (md5('b2b-order-abay')::uuid,   md5('b2b-product-1')::uuid, 'Potato',            120,  49.50,  5940.00),
  (md5('b2b-order-abay')::uuid,   md5('b2b-product-3')::uuid, 'Tomato A',           80,  77.00,  6160.00),
  (md5('b2b-order-abay')::uuid,   md5('b2b-product-5')::uuid, 'Red Onion habesha',  30, 113.30,  3399.00),
  (md5('b2b-order-entoto')::uuid, md5('b2b-product-5')::uuid, 'Red Onion habesha', 300, 109.00, 32700.00),
  (md5('b2b-order-entoto')::uuid, md5('b2b-product-6')::uuid, 'Carrot',            180,  74.80, 13464.00),
  (md5('b2b-order-bole')::uuid,   md5('b2b-product-2')::uuid, 'Potato for Chips',  600,  55.00, 33000.00),
  (md5('b2b-order-bole')::uuid,   md5('b2b-product-3')::uuid, 'Tomato A',          200,  77.00, 15400.00);

-- ---------------------------------------------------------------- fake Admin
insert into adm_customer_types (id, name) values
  (md5('adm-type-restaurant')::uuid, 'Restaurant'),
  (md5('adm-type-hotel')::uuid,      'Hotel'),
  (md5('adm-type-corporate')::uuid,  'Corporate');

-- Bole's wallet leaves 1,100 ETB to spend: a normal order there is refused ("order exceeds available credit limit").
insert into adm_b2b_customers (id, business_name, tin, phone, credit_limit, payment_terms_days, charge_vat, customer_type_id, wallet_account_id, wallet_balance, created_at) values
  (md5('adm-co-abay')::uuid,   'Abay Bar & Restaurant',       '0000000101', '251900000101', 100000, 7,  true, md5('adm-type-restaurant')::uuid, '2003-' || md5('adm-co-abay'),   -17823.85, now() - interval '200 days'),
  (md5('adm-co-entoto')::uuid, 'Entoto View Hotel',           '0000000102', '251900000102', 100000, 7,  true, md5('adm-type-hotel')::uuid,      '2003-' || md5('adm-co-entoto'), -53088.60, now() - interval '180 days'),
  (md5('adm-co-sheger')::uuid, 'Sheger Pharma PLC (canteen)', '0000000103', '251900000103', 100000, 15, true, md5('adm-type-corporate')::uuid,  '2003-' || md5('adm-co-sheger'), 0,         now() - interval '150 days'),
  (md5('adm-co-bole')::uuid,   'Bole Burger House',           '0000000104', '251900000104', 50000,  7,  true, md5('adm-type-restaurant')::uuid, '2003-' || md5('adm-co-bole'),   -48900.00, now() - interval '120 days');

insert into adm_users (id, name, phone, is_system) values
  (md5('adm-user-agent')::uuid,    'Zeami order agent (test)', '251900000099', true),
  (md5('adm-user-simenesh')::uuid, 'Simenesh (test)',          '251900000009', false),
  (md5('adm-user-selam')::uuid,    'Selam (test)',             '251900000001', false),
  (md5('adm-user-dawit')::uuid,    'Dawit (test)',             '251900000002', false),
  (md5('adm-user-hana')::uuid,     'Hana (test)',              '251900000003', false);

-- Simenesh is linked to every company (as in reality); Selam orders for two companies, the others for one.
insert into adm_b2b_customer_users (b2b_customer_id, user_id, role) values
  (md5('adm-co-abay')::uuid,   md5('adm-user-simenesh')::uuid, 'ADMIN'),
  (md5('adm-co-entoto')::uuid, md5('adm-user-simenesh')::uuid, 'ADMIN'),
  (md5('adm-co-sheger')::uuid, md5('adm-user-simenesh')::uuid, 'ADMIN'),
  (md5('adm-co-bole')::uuid,   md5('adm-user-simenesh')::uuid, 'ADMIN'),
  (md5('adm-co-abay')::uuid,   md5('adm-user-selam')::uuid,    'MEMBER'),
  (md5('adm-co-entoto')::uuid, md5('adm-user-selam')::uuid,    'MEMBER'),
  (md5('adm-co-sheger')::uuid, md5('adm-user-dawit')::uuid,    'MEMBER'),
  (md5('adm-co-bole')::uuid,   md5('adm-user-hana')::uuid,     'MEMBER');

insert into adm_products (id, name, measuring_unit, current_unit_price)
  select md5('adm-product-' || n)::uuid, name, unit, deal_price from seed_products;
insert into adm_group_deals (id, product_id, group_price)
  select md5('adm-deal-' || n)::uuid, md5('adm-product-' || n)::uuid, deal_price from seed_products;

insert into adm_payment_methods (id, name, sort) values
  (md5('adm-pm-telebirr')::uuid, 'telebirr',        1),
  (md5('adm-pm-mpesa')::uuid,    'MPesa',           2),
  (md5('adm-pm-wallet')::uuid,   'ChipChip Wallet', 3),
  (md5('adm-pm-cbe')::uuid,      'CBE',             4),
  (md5('adm-pm-awash')::uuid,    'Awash Bank',      5);

-- Saved delivery locations belong to a user. Simenesh has every company's; staff have their own company's.
insert into adm_locations (user_id, name, location_title, contact_phone) values
  (md5('adm-user-simenesh')::uuid, 'Abay Bar & Restaurant, Kazanchis',         'Abay',        '251900000101'),
  (md5('adm-user-simenesh')::uuid, 'Entoto View Hotel, Africa Avenue',         'Entoto',      '251900000102'),
  (md5('adm-user-simenesh')::uuid, 'Entoto View Hotel, kitchen back door',     'Entoto back', '251900000102'),
  (md5('adm-user-simenesh')::uuid, 'Sheger Pharma PLC, Akaki factory canteen', 'Sheger',      '251900000103'),
  (md5('adm-user-simenesh')::uuid, 'Bole Burger House, Bole Medhanialem',      'Bole Burger', '251900000104'),
  (md5('adm-user-selam')::uuid,    'Abay Bar & Restaurant, Kazanchis',         'Abay',        '251900000101'),
  (md5('adm-user-selam')::uuid,    'Entoto View Hotel, Africa Avenue',         'Entoto',      '251900000102'),
  (md5('adm-user-selam')::uuid,    'Entoto View Hotel, kitchen back door',     'Entoto back', '251900000102'),
  (md5('adm-user-dawit')::uuid,    'Sheger Pharma PLC, Akaki factory canteen', 'Sheger',      '251900000103'),
  (md5('adm-user-hana')::uuid,     'Bole Burger House, Bole Medhanialem',      'Bole Burger', '251900000104');

drop table seed_products;

-- ---------------------------------------------------------------- the agent's test logins
-- Test accounts of the mock, not real credentials. The plain passwords are in README ("Set up").
-- To change one:  update mock_accounts set password_sha256 = encode(sha256('<new password>'::bytea), 'hex')
--                 where system = 'b2b' and login = 'order-agent@mock.chipchip.test';
insert into mock_accounts (system, login, password_sha256, user_id) values
  ('b2b',   'order-agent@mock.chipchip.test', '4a63bd85efe0c5122a6b9a81ad706cc20999b4774735fde42827792fe6790adf', md5('b2b-profile-agent')::uuid),
  ('admin', '251900000099',                   'ee75b2d15249ae4da4474b94268f292001258f2c779f8ac044c2bf428dababce', md5('adm-user-agent')::uuid);

-- ---------------------------------------------------------------- the four questions (answers are for the agent)
insert into settings (key, value) values
  ('q1_where',     'both'),         -- both | b2b | admin
  ('q2_credit',    'admin_wallet'), -- admin_wallet | b2b_status | both
  ('q3_placed_as', 'simenesh'),     -- simenesh | staff
  ('q4_several',   'ask');          -- ask | usual

-- Storage for photos and files customers send (private; the agent gets short-lived links)
insert into storage.buckets (id, name, public) values ('order-files', 'order-files', false)
  on conflict (id) do nothing;

-- Only the server (service role) touches these tables.
do $$
declare t text;
begin
  foreach t in array array[
    'b2b_profiles','b2b_customer_types','b2b_customers','b2b_products','b2b_product_prices','b2b_payment_types',
    'b2b_pricing_settings','b2b_orders','b2b_order_items',
    'adm_customer_types','adm_b2b_customers','adm_users','adm_b2b_customer_users','adm_products','adm_group_deals',
    'adm_payment_methods','adm_locations','adm_groups','adm_group_carts','adm_orders',
    'mock_accounts','mock_sessions','bot_contacts','settings','inbox','inbox_messages','feedback']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
