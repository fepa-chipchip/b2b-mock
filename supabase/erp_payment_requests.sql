-- Fake ChipChip ERP: the payment requests POST /erp/functions/v1/external-payment-requests creates (lib/erpPayments.ts).
-- Supabase -> SQL Editor -> paste this file -> Run. Safe to re-run: it keeps the requests already made.
-- schema.sql does not drop this table, so re-running schema.sql leaves the ERP mock's requests alone.
--
-- request_number: "PR-<year>-9<4-digit sequence>" (PR-2026-90001, ...). The leading 9 marks a mock number; real ERP
-- numbers look like PR-2026-01970. The sequence never restarts, also after "Clear test requests".
-- Documents: name, type and decoded size only. The base64 itself is never stored.

create sequence if not exists erp_payment_request_seq;

create or replace function erp_next_request_number()
returns text
language sql
volatile
set search_path = public
as $$
  select 'PR-' || to_char(now() at time zone 'Africa/Addis_Ababa', 'YYYY') || '-9'
         || case when n < 10000 then lpad(n::text, 4, '0') else n::text end
  from (select nextval('erp_payment_request_seq') as n) s;
$$;

create table if not exists erp_payment_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique default erp_next_request_number(),
  external_source text not null,            -- the token's System Name
  external_reference text,                  -- the caller's idempotency key
  status text not null,                     -- approved (token auto-approves) or pending
  title text not null,
  description text,
  amount numeric not null,
  total_amount numeric not null check (total_amount > 0),
  currency text not null default 'ETB',
  vendor_name text,
  vendor_bank_name text,
  vendor_bank_account text,
  vendor_bank_branch text,
  payment_method text not null default 'bank_transfer',
  preferred_payment_date date,
  department_id uuid,
  category_id uuid,
  business_unit text not null default 'chipchip',
  vat_applicable boolean not null default false,
  vat_amount numeric not null default 0,
  requester_first_name text,
  requester_last_name text,
  requester_email text,
  documents jsonb not null default '[]'::jsonb,    -- [{file_name, file_type, size_bytes}]
  allocations jsonb not null default '[]'::jsonb,  -- [{business_unit, percentage}]
  created_at timestamptz not null default now()
);

-- Idempotency, as in the real ERP: one request per (source, reference). Requests without a reference are never deduped.
create unique index if not exists erp_payment_requests_source_reference
  on erp_payment_requests (external_source, external_reference) where external_reference is not null;
create index if not exists erp_payment_requests_created on erp_payment_requests (created_at desc);

-- Only the server (service role) touches it, like every other mock table.
alter table erp_payment_requests enable row level security;
revoke all on function erp_next_request_number() from public, anon, authenticated;
grant execute on function erp_next_request_number() to service_role;
grant usage on sequence erp_payment_request_seq to service_role;

notify pgrst, 'reload schema';
