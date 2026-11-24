-- Fake ChipChip ERP: the payment requests behind /erp/functions/v1/external-payment-requests (lib/erpPayments.ts):
-- create, list, get one, mark paid (the ERP guide v2), and the sandbox page's approve / reject.
-- Supabase -> SQL Editor -> paste this file -> Run. Safe to re-run: it keeps the requests already made, and adds the v2
-- columns and functions to a table made by the first version. Run it BEFORE deploying code that uses them.
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

-- ---------- v2: read, approval and payment (guide v2) ----------
-- Added with `if not exists`, so a table made by the first version keeps its requests.
alter table erp_payment_requests add column if not exists items jsonb not null default '[]'::jsonb;  -- line items
alter table erp_payment_requests add column if not exists submitted_at timestamptz;
alter table erp_payment_requests add column if not exists approved_at timestamptz;
alter table erp_payment_requests add column if not exists current_approval_level integer;
alter table erp_payment_requests add column if not exists approvals jsonb not null default '[]'::jsonb;
  -- [{approver_id, approver_name, approval_level, status, comments, approved_at}]
alter table erp_payment_requests add column if not exists rejection_reason text;
alter table erp_payment_requests add column if not exists rejected_at timestamptz;
alter table erp_payment_requests add column if not exists rejected_by text;
alter table erp_payment_requests add column if not exists paid_at timestamptz;
alter table erp_payment_requests add column if not exists paid_by text;          -- the paying token's System Name
alter table erp_payment_requests add column if not exists payment_reference text;
alter table erp_payment_requests add column if not exists actual_payment_date date;
alter table erp_payment_requests add column if not exists bank_account_id uuid;
alter table erp_payment_requests add column if not exists expense_number text;    -- EXP-<year>-9xxxx, mock numbers

-- Requests made before v2: submitted when created, and an approved one was auto-approved at that moment.
update erp_payment_requests set submitted_at = created_at where submitted_at is null;
update erp_payment_requests set approved_at = created_at where approved_at is null and status = 'approved';
update erp_payment_requests set current_approval_level = 1 where current_approval_level is null and status = 'pending';

create index if not exists erp_payment_requests_status on erp_payment_requests (status, created_at desc);

-- A new request is submitted when it is created; an auto-approved one is approved at the same moment, a pending one waits
-- at approval level 1.
create or replace function erp_payment_requests_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.submitted_at := coalesce(new.submitted_at, new.created_at);
  if new.status = 'approved' then new.approved_at := coalesce(new.approved_at, new.created_at); end if;
  if new.status = 'pending' then new.current_approval_level := coalesce(new.current_approval_level, 1); end if;
  return new;
end $$;

drop trigger if exists erp_payment_requests_stamp on erp_payment_requests;
create trigger erp_payment_requests_stamp before insert on erp_payment_requests
  for each row execute function erp_payment_requests_stamp();

-- Expense numbers of mark-paid: "EXP-<year>-9<4-digit sequence>", the leading 9 marks a mock number (real: EXP-2026-04123).
create sequence if not exists erp_expense_seq;

create or replace function erp_next_expense_number()
returns text
language sql
volatile
set search_path = public
as $$
  select 'EXP-' || to_char(now() at time zone 'Africa/Addis_Ababa', 'YYYY') || '-9'
         || case when n < 10000 then lpad(n::text, 4, '0') else n::text end
  from (select nextval('erp_expense_seq') as n) s;
$$;

-- GET list: newest first, a page of rows plus the total that matches. p_to is exclusive (the API passes the day after
-- `to`, so `to` itself is included). Null means no filter.
create or replace function erp_list_requests(p_statuses text[], p_from timestamptz, p_to timestamptz, p_limit integer,
                                             p_offset integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  with hit as (
    select * from erp_payment_requests
    where (p_statuses is null or status = any(p_statuses))
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from hit),
    'rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.request_number desc)
                      from (select * from hit order by created_at desc, request_number desc
                            limit p_limit offset p_offset) p), '[]'::jsonb));
$$;

-- GET one: the whole row, or null.
create or replace function erp_get_request(p_request_number text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select to_jsonb(r) from erp_payment_requests r where r.request_number = p_request_number;
$$;

-- POST mark_paid, in one transaction with the row locked, so two calls at once cannot both pay it.
-- outcome: paid | already_paid (the FIRST payment's details) | not_approved | not_found.
create or replace function erp_mark_paid(p_request_number text, p_payment_reference text, p_payment_date date,
                                         p_bank_account_id uuid, p_paid_by text)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare r erp_payment_requests%rowtype;
begin
  select * into r from erp_payment_requests where request_number = p_request_number for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if r.status = 'approved' then
    update erp_payment_requests
       set status = 'paid', paid_at = now(), paid_by = p_paid_by, payment_reference = p_payment_reference,
           actual_payment_date = p_payment_date, bank_account_id = p_bank_account_id,
           expense_number = erp_next_expense_number()
     where id = r.id
    returning * into r;
    return jsonb_build_object('outcome', 'paid', 'request_number', r.request_number, 'status', r.status,
      'payment_reference', r.payment_reference, 'payment_date', r.actual_payment_date, 'expense_number', r.expense_number);
  end if;
  if r.status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'request_number', r.request_number, 'status', r.status,
      'payment_reference', r.payment_reference, 'payment_date', r.actual_payment_date, 'expense_number', r.expense_number);
  end if;
  return jsonb_build_object('outcome', 'not_approved', 'request_number', r.request_number, 'status', r.status);
end $$;

-- The sandbox page's Approve / Reject (the real ERP's approval chain, one level here). Only a pending request moves.
-- outcome: approved | rejected | not_pending | not_found.
create or replace function erp_decide_request(p_request_number text, p_decision text, p_by text, p_comments text)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare r erp_payment_requests%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'decision must be approved or rejected'; end if;
  select * into r from erp_payment_requests where request_number = p_request_number for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('outcome', 'not_pending', 'status', r.status); end if;
  update erp_payment_requests
     set status = p_decision,
         approvals = approvals || jsonb_build_array(jsonb_build_object(
           'approver_id', gen_random_uuid(), 'approver_name', p_by, 'approval_level', coalesce(current_approval_level, 1),
           'status', p_decision, 'comments', nullif(p_comments, ''),
           'approved_at', case when p_decision = 'approved' then now() end)),
         approved_at = case when p_decision = 'approved' then now() else approved_at end,
         rejected_at = case when p_decision = 'rejected' then now() else rejected_at end,
         rejected_by = case when p_decision = 'rejected' then p_by else rejected_by end,
         rejection_reason = case when p_decision = 'rejected' then nullif(p_comments, '') else rejection_reason end
   where id = r.id;
  return jsonb_build_object('outcome', p_decision);
end $$;

revoke all on function erp_payment_requests_stamp() from public, anon, authenticated;
revoke all on function erp_next_expense_number() from public, anon, authenticated;
revoke all on function erp_list_requests(text[], timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function erp_get_request(text) from public, anon, authenticated;
revoke all on function erp_mark_paid(text, text, date, uuid, text) from public, anon, authenticated;
revoke all on function erp_decide_request(text, text, text, text) from public, anon, authenticated;
grant execute on function erp_payment_requests_stamp() to service_role;
grant execute on function erp_next_expense_number() to service_role;
grant execute on function erp_list_requests(text[], timestamptz, timestamptz, integer, integer) to service_role;
grant execute on function erp_get_request(text) to service_role;
grant execute on function erp_mark_paid(text, text, date, uuid, text) to service_role;
grant execute on function erp_decide_request(text, text, text, text) to service_role;
grant usage on sequence erp_expense_seq to service_role;

notify pgrst, 'reload schema';
