-- B2B order mock: paste the whole file into Supabase -> SQL Editor -> Run. Safe to re-run (it drops and re-creates).
-- Every customer and person here is invented. Product names and units follow ChipChip's catalogue; prices are samples.

drop table if exists feedback, orders, inbox_messages, inbox, locations, staff_companies, staff, products, companies, settings cascade;

create table companies (
  id serial primary key,
  name text not null,
  customer_type text not null default 'Restaurant',
  tax_rate numeric not null default 0.15,
  credit_limit numeric not null default 100000,
  payment_terms_days int not null default 7,
  -- B2B app's view of credit
  b2b_unpaid numeric not null default 0,
  b2b_credit_status text not null default 'good',      -- good | overdue | suspended
  -- Admin's company wallet: negative = owed
  admin_wallet_balance numeric not null default 0
);

create table locations (
  id serial primary key,
  company_id int not null references companies(id) on delete cascade,
  label text not null
);

create table staff (
  id serial primary key,
  name text not null,
  phone text unique,                 -- digits only, with country code: 2519XXXXXXXX
  telegram_id bigint unique,
  telegram_name text,
  usual_company_id int references companies(id)
);

create table staff_companies (
  staff_id int references staff(id) on delete cascade,
  company_id int references companies(id) on delete cascade,
  primary key (staff_id, company_id)
);

create table products (
  id serial primary key,
  name text not null,
  other_names text not null default '',   -- spellings customers use, English or Amharic, comma separated
  unit text not null,                      -- kg, pcs, 0.5 kg
  b2b_price numeric not null,
  admin_price numeric not null,            -- the B2B deal price in Admin
  min_qty numeric not null default 1,
  active boolean not null default true
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
  staff_id int references staff(id),
  sender_name text,
  company_id int references companies(id),          -- set when known (one company, or the customer picked one)
  status text not null default 'collecting',       -- collecting | waiting_company | ready | proposed | created | rejected
  agent_note text,
  created_at timestamptz default now(),
  last_message_at timestamptz default now()
);

create table inbox_messages (
  id serial primary key,
  inbox_id int not null references inbox(id) on delete cascade,
  kind text not null,                -- text | photo | document
  text text,
  file_path text,                    -- in the order-files storage bucket
  file_name text,
  created_at timestamptz default now()
);

create table orders (
  id serial primary key,
  inbox_id int unique references inbox(id),
  company_id int not null references companies(id),
  location_id int references locations(id),
  delivery_date date not null,
  notes text,
  items jsonb not null,              -- [{product_id, name, unit, quantity, price, total}]
  subtotal numeric not null,
  tax numeric not null,
  total numeric not null,
  b2b_copy jsonb,                    -- what the B2B app would hold, or null
  admin_copy jsonb,                  -- what Admin would hold, or null
  credit_check jsonb not null,
  placed_as text,
  created_at timestamptz default now()
);

create table feedback (
  id serial primary key,
  about text not null,               -- 'order:12', 'setting:q1', 'general'
  ok boolean,
  comment text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------- sample data
insert into companies (name, customer_type, credit_limit, payment_terms_days, b2b_unpaid, b2b_credit_status, admin_wallet_balance) values
  ('Abay Bar & Restaurant',        'Restaurant', 100000, 7,  18021.42, 'good',    -18021.42),
  ('Entoto View Hotel',            'Hotel',      100000, 7,  52460.28, 'good',    -52460.28),
  ('Sheger Pharma PLC (canteen)',  'Corporate',  100000, 15, 0,        'good',    0),
  ('Bole Burger House',            'Restaurant', 50000,  7,  61200.00, 'overdue', -48900.00);

insert into locations (company_id, label) values
  (1, 'Abay Bar & Restaurant, Kazanchis'),
  (2, 'Entoto View Hotel, Africa Avenue'),
  (2, 'Entoto View Hotel, kitchen back door'),
  (3, 'Sheger Pharma PLC, Akaki factory canteen'),
  (4, 'Bole Burger House, Bole Medhanialem');

-- Selam orders for two companies (the case behind question 4); the others for one.
insert into staff (name, phone, usual_company_id) values
  ('Selam (test)',  '251900000001', 1),
  ('Dawit (test)',  '251900000002', 3),
  ('Hana (test)',   '251900000003', 4);
insert into staff_companies values (1, 1), (1, 2), (2, 3), (3, 4);

insert into products (name, other_names, unit, b2b_price, admin_price, min_qty) values
  ('Potato',               'dinich, ድንች',                       'kg',     49.50,  49.50, 1),
  ('Potato for Chips',     'potato fot chips, chips potato',     'kg',     55.00,  55.00, 1),
  ('Tomato A',             'tomato ripe, የበሰለ ቲማቲም',            'kg',     77.00,  77.00, 1),
  ('Tomato A Raw',         'tomato medium, መካከለኛ ቲማቲም, raw tomato', 'kg', 77.00,  77.00, 1),
  ('Red Onion habesha',    'red onion, ቀይ ሽንኩርት',                'kg',    113.30, 113.30, 1),
  ('Carrot',               'karot, ካሮት',                         'kg',     74.80,  74.80, 1),
  ('White Cabbage',        'tikil gomen, ጥቅል ጎመን',               'kg',     58.30,  58.30, 1),
  ('Beetroot',             'key sir, ቀይ ስር',                      'kg',     77.00,  77.00, 1),
  ('Avocado Ripe',         'avocado, አቮካዶ',                       'kg',    145.00, 145.00, 1),
  ('Garlic',               'nech shinkurt, ነጭ ሽንኩርት',            'kg',    308.00, 308.00, 1),
  ('Ginger',               'zinjibil, ዝንጅብል',                    'kg',    137.50, 137.50, 0.5),
  ('Green Chili',          'karia, ቃሪያ',                          '0.5 kg', 104.50, 104.50, 1),
  ('Indian chilli',        'indian chili',                       'kg',    220.00, 220.00, 1),
  ('Coriander',            'dimbilal, ድንብላል',                    'pcs',    77.00,  77.00, 1),
  ('Cauliflower',          'abeba gomen',                        'kg',    209.00, 209.00, 1),
  ('Broccoli',             'brocoli',                            'kg',    181.50, 181.50, 1),
  ('Green Beans',          'fosolia, ፎሶሊያ',                      'kg',    139.70, 139.70, 1),
  ('Lemon',                'lomi, ሎሚ',                            'kg',    181.50, 181.50, 1),
  ('Papaya',               'papaye, ፓፓያ',                         'kg',     90.00,  90.00, 1),
  ('Sugar',                'sukar, ስኳር',                          'kg',    209.00, 209.00, 1),
  ('Difen Miser (Local)',  'difen miser, ድፍን ምስር',               'kg',    319.00, 319.00, 1),
  ('Viva sofit',           'viva yegebeta, viva',                'pcs',   126.50, 126.50, 1),
  ('OK Pasta',             'ok pasta',                           'pcs',    95.00,  95.00, 1),
  ('Ottima Pasta',         'ottima pasta',                       'pcs',    98.00,  98.00, 1),
  ('Wakene Flour',         'wakene flour, ዱቄት',                   'kg',     92.00,  92.00, 1),
  ('Addis Tea',            'addis shay, አዲስ ሻይ',                  'pcs',   183.75, 183.75, 1);

-- The four questions, with the mock's starting guess. Simenesh changes them on the Settings page.
insert into settings (key, value) values
  ('q1_where',   'both'),        -- both | b2b | admin
  ('q2_credit',  'admin_wallet'),-- admin_wallet | b2b_status | both
  ('q3_placed_as','simenesh'),   -- simenesh | staff
  ('q4_several', 'ask');         -- ask | usual

-- Storage for photos and files customers send (private; the agent gets short-lived links)
insert into storage.buckets (id, name, public) values ('order-files', 'order-files', false)
  on conflict (id) do nothing;

-- Only the server (service role) touches these tables.
alter table companies enable row level security;
alter table locations enable row level security;
alter table staff enable row level security;
alter table staff_companies enable row level security;
alter table products enable row level security;
alter table settings enable row level security;
alter table inbox enable row level security;
alter table inbox_messages enable row level security;
alter table orders enable row level security;
alter table feedback enable row level security;
