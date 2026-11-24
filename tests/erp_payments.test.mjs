// The fake ChipChip ERP's /erp/functions/v1/external-payment-requests (lib/erpPayments.ts, ERP guide v2: create, list,
// get one, mark paid), run against a real Postgres (PGlite, in-process) built from supabase/erp_payment_requests.sql,
// standing in for Supabase. List, get one and mark paid run the file's own SQL functions, as the Supabase store does.
// Run with `npm test` (Node 22.18+ loads the .ts files directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { handleExternalPaymentRequest, loadTokens, loadHashedTokens, allTokens, base64Size, departmentCategory } from "../lib/erpPayments.ts";
import { erpSpec } from "../lib/openapi.ts";

const SQL = readFileSync(new URL("../supabase/erp_payment_requests.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ROLES = "create role anon; create role authenticated; create role service_role;";
const URL_ = "https://mock.example/erp/functions/v1/external-payment-requests";

// Test tokens of this file only.
const TOKENS = [
  { token: "tok-auto", system_name: "zeami-test", auto_approve: true },
  { token: "tok-pending", system_name: "zeami-pending", auto_approve: false },
  { token: "tok-revoked", system_name: "zeami-test", auto_approve: true, revoked: true },
  { token: "tok-expired", system_name: "zeami-test", auto_approve: true, expires_at: "2026-01-01T00:00:00Z" },
];

const COLS = ["external_source", "external_reference", "status", "title", "description", "amount", "total_amount", "currency",
  "vendor_name", "vendor_bank_name", "vendor_bank_account", "vendor_bank_branch", "payment_method", "preferred_payment_date",
  "department_id", "category_id", "business_unit", "vat_applicable", "vat_amount", "requester_first_name",
  "requester_last_name", "requester_email", "items", "documents", "allocations"];
const JSONB = new Set(["items", "documents", "allocations"]);

/**
 * What supabase-js does for lib/erpStore.ts: select by (source, reference), insert returning (23505 = conflict), and
 * the rpc calls of list, get one and mark paid, which run the SQL functions of supabase/erp_payment_requests.sql.
 */
function pgStore(pg) {
  return {
    async findByReference(source, ref) {
      const r = await pg.query("select id, request_number, status from erp_payment_requests where external_source = $1 and external_reference = $2", [source, ref]);
      return r.rows[0] || null;
    },
    async insert(row) {
      const vals = COLS.map((c) => (JSONB.has(c) ? JSON.stringify(row[c]) : row[c]));
      try {
        const r = await pg.query(
          `insert into erp_payment_requests (${COLS.join(",")}) values (${COLS.map((_, i) => `$${i + 1}`).join(",")})
           returning id, request_number, status`, vals);
        return { row: r.rows[0] };
      } catch (e) {
        if (e.code === "23505") return { conflict: true };
        throw e;
      }
    },
    async list(q) {
      const r = await pg.query("select erp_list_requests($1::text[], $2::timestamptz, $3::timestamptz, $4::int, $5::int) as j",
        [q.statuses, q.from, q.to, q.limit, q.offset]);
      return r.rows[0].j;
    },
    async get(n) {
      return (await pg.query("select erp_get_request($1) as j", [n])).rows[0].j || null;
    },
    async markPaid(p) {
      return (await pg.query("select erp_mark_paid($1, $2, $3::date, $4::uuid, $5) as j",
        [p.request_number, p.payment_reference, p.payment_date, p.bank_account_id, p.paid_by])).rows[0].j;
    },
  };
}

// One in-process Postgres for the file (starting one takes seconds); each test starts from a fresh table.
let shared = null;
async function freshDb() {
  if (!shared) { shared = new PGlite(); await shared.exec(ROLES); }
  await shared.exec(`drop table if exists erp_payment_requests cascade; drop function if exists erp_next_request_number();
    drop sequence if exists erp_payment_request_seq; drop sequence if exists erp_expense_seq cascade;`);
  await shared.exec(SQL);
  return shared;
}

async function setup(tokens = TOKENS) {
  const pg = await freshDb();
  const logs = [];
  const deps = { store: pgStore(pg), tokens: () => tokens, now: () => new Date("2026-11-17T09:00:00Z"), log: (l) => logs.push(l) };
  const call = async (body, { token = "tok-auto", method = "POST", raw, query = "" } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (method !== "GET" && method !== "DELETE") init.body = raw !== undefined ? raw : JSON.stringify(body);
    const res = await handleExternalPaymentRequest(new Request(URL_ + query, init), deps);
    return { status: res.status, body: await res.json(), allow: res.headers.get("allow") };
  };
  const get = (query, opts = {}) => call(undefined, { ...opts, method: "GET", query });
  const rows = async () => (await pg.query("select * from erp_payment_requests order by created_at, request_number")).rows;
  /** The sandbox page's Approve / Reject (erp_decide_request), as app/erp/actions.ts calls it. */
  const decide = async (n, decision, comments = "") =>
    (await pg.query("select erp_decide_request($1, $2, 'Sandbox approver', $3) as j", [n, decision, comments])).rows[0].j;
  return { pg, call, get, rows, logs, decide, deps };
}

const MIN = { title: "Supplier payment", total_amount: 1500 };
const B64 = Buffer.from("hello invoice").toString("base64"); // 13 bytes

test("400: bad JSON, missing title, total_amount missing / 0 / negative / text", async () => {
  const { call, rows } = await setup();
  const cases = [
    [{ raw: "{not json" }, undefined, "Invalid JSON body"],
    [{}, { total_amount: 10 }, "title is required"],
    [{}, { title: "  ", total_amount: 10 }, "title is required"],
    [{}, { title: "x" }, "total_amount is required"],
    [{}, { title: "x", total_amount: 0 }, "total_amount must be a number greater than 0"],
    [{}, { title: "x", total_amount: -5 }, "total_amount must be a number greater than 0"],
    [{}, { title: "x", total_amount: "100" }, "total_amount must be a number greater than 0"],
    [{}, [MIN], "Request body must be a JSON object"],
    [{}, { ...MIN, preferred_payment_date: "20/11/2026" }, "preferred_payment_date must be a date YYYY-MM-DD"],
    [{}, { ...MIN, department_id: "sourcing" }, "department_id must be a uuid"],
  ];
  for (const [opts, body, error] of cases) {
    const r = await call(body, opts);
    assert.equal(r.status, 400, JSON.stringify(body ?? opts));
    assert.deepEqual(r.body, { success: false, error });
  }
  assert.equal((await rows()).length, 0);
});

test("401: missing, invalid, revoked, expired token; nothing created", async () => {
  const { call, rows } = await setup();
  for (const [token, error] of [[null, "Missing API token"], ["", "Missing API token"], ["nope", "Invalid API token"],
    ["tok-revoked", "API token has been revoked"], ["tok-expired", "API token has expired"]]) {
    const r = await call(MIN, { token });
    assert.equal(r.status, 401, String(token));
    assert.deepEqual(r.body, { success: false, error });
  }
  assert.equal((await rows()).length, 0);
});

test("405: any method but GET and POST, before the token is looked at", async () => {
  const { call } = await setup();
  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const r = await call(MIN, { method, token: null });
    assert.equal(r.status, 405, method);
    assert.deepEqual(r.body, { success: false, error: "Method not allowed" });
    assert.equal(r.allow, "GET, POST");
  }
});

test("200 auto-approve (v2: 200, not 201): approved, mock number PR-<year>-9xxxx, defaults filled, source = System Name", async () => {
  const { call, rows } = await setup();
  const r = await call({ ...MIN, external_reference: "order-1" });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.status, "approved");
  assert.equal(r.body.message, "Payment request created and auto-approved");
  assert.match(r.body.request_id, /^[0-9a-f-]{36}$/);
  assert.match(r.body.request_number, /^PR-\d{4}-9\d{4}$/);
  // The guide's create answer, in its order.
  assert.deepEqual(Object.keys(r.body), ["success", "request_id", "request_number", "status", "external_source",
    "external_reference", "documents_uploaded", "message"]);
  assert.equal(r.body.external_source, "zeami-test");
  assert.equal(r.body.external_reference, "order-1");
  assert.equal(r.body.documents_uploaded, 0);
  assert.equal(r.body.duplicate, undefined);
  const [row] = await rows();
  assert.equal(row.id, r.body.request_id);
  assert.equal(row.external_source, "zeami-test");
  assert.equal(Number(row.amount), 1500);
  assert.equal(row.currency, "ETB");
  assert.equal(row.payment_method, "bank_transfer");
  assert.equal(row.business_unit, "chipchip");
  assert.equal(row.vat_applicable, false);
  assert.equal(Number(row.vat_amount), 0);

  const second = await call({ ...MIN, external_reference: "order-2" });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.request_number, r.body.request_number);
});

test("200 without auto-approve: pending; no reference answers external_reference null", async () => {
  const { call, rows } = await setup();
  const r = await call({ ...MIN, external_reference: "order-p" }, { token: "tok-pending" });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "pending");
  assert.equal(r.body.message, "Payment request created");
  assert.equal(r.body.external_source, "zeami-pending");
  const bare = await call(MIN, { token: "tok-pending" });
  assert.equal(bare.body.external_reference, null);
  assert.equal((await rows())[0].external_source, "zeami-pending");
});

test("fallback env: ERP_MOCK_TOKEN + ERP_MOCK_SOURCE + ERP_MOCK_AUTO_APPROVE", () => {
  assert.deepEqual(loadTokens({ ERP_MOCK_TOKEN: "t1" }), [{ token: "t1", system_name: "zeami-test", auto_approve: true }]);
  assert.deepEqual(loadTokens({ ERP_MOCK_TOKEN: "t1", ERP_MOCK_SOURCE: "zeami-x", ERP_MOCK_AUTO_APPROVE: "false" }),
    [{ token: "t1", system_name: "zeami-x", auto_approve: false }]);
  assert.deepEqual(loadTokens({ ERP_MOCK_TOKENS: '[{"token":"a","system_name":"s","auto_approve":false}]', ERP_MOCK_TOKEN: "ignored" }),
    [{ token: "a", system_name: "s", auto_approve: false }]);
  assert.deepEqual(loadTokens({}), []);
  assert.throws(() => loadTokens({ ERP_MOCK_TOKENS: "not json" }), /not valid JSON/);
});

// The committed form (lib/erpMockTokens.json): only sha256 hashes, the tokens stay in the user's .env.local.
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const HASHED = [
  { sha256: sha("hash-auto"), system_name: "zeami-hashed", auto_approve: true },
  { sha256: sha("hash-pending").toUpperCase(), system_name: "zeami-hashed-pending", auto_approve: false },
  { sha256: sha("hash-revoked"), system_name: "zeami-hashed", auto_approve: true, revoked: true },
  { sha256: sha("hash-expired"), system_name: "zeami-hashed", auto_approve: true, expires_at: "2026-01-01T00:00:00Z" },
];

test("committed hashes: a listed token is accepted with its System Name and approval; wrong, revoked, expired are 401", async () => {
  const { call, rows } = await setup(allTokens({}, HASHED));
  const a = await call({ ...MIN, external_reference: "h-1" }, { token: "hash-auto" });
  assert.equal(a.status, 200);
  assert.equal(a.body.status, "approved");
  assert.match(a.body.request_number, /^PR-\d{4}-9\d{4}$/);
  const p = await call({ ...MIN, external_reference: "h-2" }, { token: "hash-pending" });
  assert.equal(p.status, 200);
  assert.equal(p.body.status, "pending");
  assert.deepEqual((await rows()).map((r) => r.external_source), ["zeami-hashed", "zeami-hashed-pending"]);
  for (const [token, error] of [["hash-wrong", "Invalid API token"], [sha("hash-auto"), "Invalid API token"],
    ["hash-revoked", "API token has been revoked"], ["hash-expired", "API token has expired"]]) {
    const r = await call(MIN, { token });
    assert.equal(r.status, 401, token);
    assert.deepEqual(r.body, { success: false, error });
  }
  assert.equal((await rows()).length, 2);
});

test("committed hashes sit beside the Vercel variables; a malformed list is a 500 that names no token", async () => {
  const both = allTokens({ ERP_MOCK_TOKEN: "env-tok" }, HASHED.slice(0, 1));
  assert.deepEqual(both.map((t) => t.system_name), ["zeami-test", "zeami-hashed"]);
  const { call } = await setup(both);
  assert.equal((await call({ ...MIN, external_reference: "e-1" }, { token: "env-tok" })).status, 200);
  assert.equal((await call({ ...MIN, external_reference: "e-2" }, { token: "hash-auto" })).status, 200);
  assert.deepEqual(allTokens({}, undefined), []);
  assert.throws(() => loadHashedTokens({}), /must be a JSON list/);
  assert.throws(() => loadHashedTokens([{ sha256: "abc", system_name: "x" }]), /needs a sha256/);
  assert.throws(() => loadHashedTokens([{ sha256: sha("x"), token: "x" }]), /never the token/);
  const logs = [];
  const res = await handleExternalPaymentRequest(
    new Request(URL_, { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify(MIN) }),
    { store: pgStore(null), tokens: () => allTokens({}, [{ sha256: "nope" }]), log: (l) => logs.push(l) });
  assert.equal(res.status, 500);
  assert.deepEqual(logs, ["erp mock: lib/erpMockTokens.json[0] needs a sha256 (64 hex characters)"]);
});

test("the committed lib/erpMockTokens.json holds only hashes and loads", () => {
  const file = JSON.parse(readFileSync(new URL("../lib/erpMockTokens.json", import.meta.url), "utf8"));
  const tokens = loadHashedTokens(file);
  assert.ok(tokens.length > 0);
  for (const t of tokens) {
    assert.equal(t.token, undefined);
    assert.match(t.sha256, /^[0-9a-f]{64}$/);
  }
});

test("no token configured: every call is 401; a broken ERP_MOCK_TOKENS is a 500 that names no token", async () => {
  const { call } = await setup([]);
  assert.equal((await call(MIN)).status, 401);
  const logs = [];
  const res = await handleExternalPaymentRequest(
    new Request(URL_, { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify(MIN) }),
    { store: pgStore(null), tokens: () => loadTokens({ ERP_MOCK_TOKENS: "{oops" }), log: (l) => logs.push(l) });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { success: false, error: "Internal server error" });
  assert.deepEqual(logs, ["erp mock: ERP_MOCK_TOKENS is not valid JSON"]);
});

test("duplicate: the same external_reference answers 200 with the ORIGINAL request and creates nothing", async () => {
  const { call, rows } = await setup();
  const first = await call({ ...MIN, external_reference: "inv-77" }, { token: "tok-pending" });
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, undefined);
  const again = await call({ title: "changed title", total_amount: 99, external_reference: "inv-77" }, { token: "tok-pending" });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { success: true, duplicate: true, request_id: first.body.request_id,
    request_number: first.body.request_number, status: "pending" });
  assert.equal((await rows()).length, 1);

  // Another System Name may use the same reference; requests without a reference are never deduped.
  for (const r of [await call({ ...MIN, external_reference: "inv-77" }, { token: "tok-auto" }), await call(MIN), await call(MIN)]) {
    assert.equal(r.status, 200);
    assert.equal(r.body.duplicate, undefined);
  }
  assert.equal((await rows()).length, 4);
});

test("a retry that races the first call (unique conflict on insert) still answers the original as duplicate", async () => {
  const { pg, call } = await setup();
  const first = await call({ ...MIN, external_reference: "race-1" });
  const store = pgStore(pg);
  let looked = 0;
  // The first lookup misses (as if the other call had not committed yet); the insert then hits the unique index.
  const racing = { ...store, findByReference: async (s, r) => (looked++ === 0 ? null : store.findByReference(s, r)) };
  const res = await handleExternalPaymentRequest(
    new Request(URL_, { method: "POST", headers: { authorization: "Bearer tok-auto" }, body: JSON.stringify({ ...MIN, external_reference: "race-1" }) }),
    { store: racing, tokens: () => TOKENS });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, duplicate: true, request_id: first.body.request_id,
    request_number: first.body.request_number, status: "approved" });
});

test("FAIL500-: the request is created and the answer is 500; the retry answers 200 duplicate", async () => {
  const { call, rows, logs } = await setup();
  const r = await call({ ...MIN, external_reference: "FAIL500-abc" });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { success: false, error: "Internal server error" });
  const created = await rows();
  assert.equal(created.length, 1);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(created[0].request_number));

  const retry = await call({ ...MIN, external_reference: "FAIL500-abc" });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, { success: true, duplicate: true, request_id: created[0].id,
    request_number: created[0].request_number, status: "approved" });
  assert.equal((await rows()).length, 1);
});

test("a database error answers 500 without the token in the log", async () => {
  const logs = [];
  const broken = { findByReference: async () => { throw new Error("connection refused"); }, insert: async () => { throw new Error("x"); } };
  const res = await handleExternalPaymentRequest(
    new Request(URL_, { method: "POST", headers: { authorization: "Bearer tok-auto" }, body: JSON.stringify({ ...MIN, external_reference: "r" }) }),
    { store: broken, tokens: () => TOKENS, log: (l) => logs.push(l) });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { success: false, error: "Internal server error" });
  assert.deepEqual(logs, ["erp mock: database error: connection refused"]);
});

test("documents: more than 10 is 400; base64 must decode (no data: prefix); empty is refused", async () => {
  const { call, rows } = await setup();
  const doc = (i) => ({ file_name: `f${i}.pdf`, file_type: "application/pdf", base64: B64 });
  const eleven = await call({ ...MIN, documents: Array.from({ length: 11 }, (_, i) => doc(i)) });
  assert.equal(eleven.status, 400);
  assert.deepEqual(eleven.body, { success: false, error: "documents: at most 10 files per request" });

  for (const base64 of [`data:application/pdf;base64,${B64}`, "not base64!", "abc", ""]) {
    const r = await call({ ...MIN, documents: [doc(0), { ...doc(1), base64 }] });
    assert.equal(r.status, 400, base64);
    assert.match(r.body.error, /^documents\[1\]\.base64 is not valid base64/);
  }
  assert.equal((await call({ ...MIN, documents: [{ base64: B64 }] })).status, 400);
  assert.equal((await rows()).length, 0);

  const ten = await call({ ...MIN, documents: Array.from({ length: 10 }, (_, i) => doc(i)) });
  assert.equal(ten.status, 200);
  assert.equal(ten.body.documents_uploaded, 10);
});

test("documents: only name, type and size are stored, never the base64", async () => {
  const { pg, call } = await setup();
  const big = Buffer.alloc(3000, 7).toString("base64");
  const r = await call({ ...MIN, external_reference: "docs-1", documents: [
    { file_name: "invoice.pdf", file_type: "application/pdf", base64: B64 },
    { file_name: "receipt.jpg", file_type: "image/jpeg", base64: big.replace(/(.{76})/g, "$1\n") },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.documents_uploaded, 2);
  const row = (await pg.query("select documents, row_to_json(t)::text as whole from erp_payment_requests t")).rows[0];
  assert.deepEqual(row.documents, [
    { file_name: "invoice.pdf", file_type: "application/pdf", size_bytes: 13 },
    { file_name: "receipt.jpg", file_type: "image/jpeg", size_bytes: 3000 },
  ]);
  assert.ok(!row.whole.includes(B64), "the base64 is not anywhere in the row");
  assert.ok(!row.whole.includes(big.slice(0, 40)));
  assert.ok(!row.whole.includes("base64"));
});

test("base64Size: exact decoded sizes", () => {
  for (const n of [1, 2, 3, 4, 5, 100]) assert.equal(base64Size(Buffer.alloc(n).toString("base64")), n);
  assert.equal(base64Size("@@@@"), null);
});

test("every body field is kept as sent", async () => {
  const { call, rows } = await setup();
  const body = {
    title: "Repayment", total_amount: 1150, amount: 1000, currency: "USD", external_reference: "full-1",
    description: "B2B purchase", vendor_name: "Example Supplier", vendor_bank_name: "Example Bank",
    vendor_bank_account: 1000000000001, vendor_bank_branch: "Bole", payment_method: "cash",
    preferred_payment_date: "2026-11-20", department_id: "6B863514-6646-4A6E-ACA4-D53D40EF0862",
    category_id: "b1134780-e645-4d07-b7f5-c5f0da451781", business_unit: "chipchip-b2b", vat_applicable: true,
    vat_amount: 150, requester_first_name: "Test", requester_last_name: "Person", requester_email: "test@example.com",
    allocations: [{ business_unit: "chipchip", percentage: 60 }, { business_unit: "chipchip-b2b", percentage: 40 }],
  };
  assert.equal((await call(body)).status, 200);
  const [row] = await rows();
  assert.equal(Number(row.amount), 1000);
  assert.equal(Number(row.total_amount), 1150);
  assert.equal(row.currency, "USD");
  assert.equal(row.vendor_bank_account, "1000000000001");
  assert.equal(row.payment_method, "cash");
  assert.equal(new Date(row.preferred_payment_date).toISOString().slice(0, 10), "2026-11-20");
  assert.equal(row.department_id, "6b863514-6646-4a6e-aca4-d53d40ef0862");
  assert.equal(row.vat_applicable, true);
  assert.equal(Number(row.vat_amount), 150);
  assert.equal(row.requester_email, "test@example.com");
  assert.deepEqual(row.allocations, body.allocations);
});

test("request numbers: PR-<year>-9 + 4 digits, and they keep growing past 9999", async () => {
  const { pg } = await setup();
  const year = (await pg.query("select to_char(now() at time zone 'Africa/Addis_Ababa', 'YYYY') as y")).rows[0].y;
  assert.equal((await pg.query("select erp_next_request_number() as n")).rows[0].n, `PR-${year}-90001`);
  await pg.query("select setval('erp_payment_request_seq', 9999)");
  assert.equal((await pg.query("select erp_next_request_number() as n")).rows[0].n, `PR-${year}-910000`);
});

test("the SQL file is safe to re-run and keeps the requests", async () => {
  const { pg, call, rows } = await setup();
  await call({ ...MIN, external_reference: "keep-1" });
  await pg.exec(SQL);
  assert.equal((await rows()).length, 1);
  assert.equal((await call({ ...MIN, external_reference: "keep-1" })).status, 200);
});


/* ---------- v2: list, get one, mark paid ---------- */

// The guide's list fields, in its order (section 3); get one adds three (section 4).
const LIST_KEYS = ["id", "request_number", "title", "description", "status", "vendor_name", "vendor_bank_name",
  "vendor_bank_account", "vendor_bank_branch", "amount", "vat_amount", "total_amount", "currency", "payment_method",
  "preferred_payment_date", "business_unit", "external_source", "external_reference", "submitted_at", "approved_at",
  "paid_at", "payment_reference", "actual_payment_date", "rejection_reason", "rejected_at", "created_at",
  "requester_first_name", "requester_last_name", "requester_email", "documents"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PAY = (request_number, extra = {}) =>
  ({ action: "mark_paid", request_number, payment_reference: "FT2625883RYN", payment_date: "2026-11-17", ...extra });
const UNKNOWN_ACTION = 'Unknown action. The only action is "mark_paid"; leave action out to create a payment request';

test("list: the guide's fields in its order, newest first, documents as names only, totals and paging", async () => {
  const { call, get } = await setup();
  const a = await call({ ...MIN, external_reference: "l-1", vendor_name: "Supplier A", vendor_bank_account: "86029038",
    preferred_payment_date: "2026-11-20", documents: [{ file_name: "delivery-note.pdf", file_type: "application/pdf", base64: B64 }] });
  const b = await call({ ...MIN, external_reference: "l-2" }, { token: "tok-pending" });
  const c = await call({ ...MIN, external_reference: "l-3", total_amount: 99.5 });

  const r = await get("");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ["success", "total", "limit", "offset", "requests"]);
  assert.equal(r.body.success, true);
  assert.equal(r.body.total, 3);
  assert.equal(r.body.limit, 100);
  assert.equal(r.body.offset, 0);
  assert.deepEqual(r.body.requests.map((x) => x.request_number), [c, b, a].map((x) => x.body.request_number));
  const one = r.body.requests[2];
  assert.deepEqual(Object.keys(one), LIST_KEYS);
  assert.equal(one.id, a.body.request_id);
  assert.equal(one.amount, 1500);
  assert.equal(one.total_amount, 1500);
  assert.equal(one.vat_amount, 0);
  assert.equal(r.body.requests[0].total_amount, 99.5);
  assert.equal(one.preferred_payment_date, "2026-11-20");
  assert.equal(one.vendor_bank_account, "86029038");
  assert.equal(one.vendor_bank_branch, null);
  assert.deepEqual(one.documents, ["delivery-note.pdf"]);
  assert.equal(one.external_source, "zeami-test");
  assert.equal(one.requester_first_name, "External");
  assert.equal(one.requester_last_name, "System");
  assert.equal(one.requester_email, null);
  assert.match(one.created_at, ISO);
  assert.equal(one.submitted_at, one.created_at);
  assert.equal(one.approved_at, one.created_at, "auto-approved at creation");
  assert.equal(r.body.requests[1].approved_at, null, "pending");
  for (const k of ["paid_at", "payment_reference", "actual_payment_date", "rejection_reason", "rejected_at"]) assert.equal(one[k], null, k);

  const page = await get("?limit=2&offset=2");
  assert.equal(page.body.total, 3);
  assert.equal(page.body.limit, 2);
  assert.equal(page.body.offset, 2);
  assert.deepEqual(page.body.requests.map((x) => x.request_number), [a.body.request_number]);
  assert.deepEqual((await get("?offset=10")).body.requests, []);
});

test("list: limit is clamped to 1-500 and offset to 0 or more, never refused", async () => {
  const { call, get } = await setup();
  await call({ ...MIN, external_reference: "c-1" });
  await call({ ...MIN, external_reference: "c-2" });
  for (const [q, limit, offset, n] of [["?limit=0", 1, 0, 1], ["?limit=1000", 500, 0, 2], ["?limit=abc", 100, 0, 2],
    ["?limit=1.5", 100, 0, 2], ["?offset=-3", 100, 0, 2], ["?limit=&offset=", 100, 0, 2], ["?limit=500&offset=1", 500, 1, 1]]) {
    const r = await get(q);
    assert.equal(r.status, 200, q);
    assert.equal(r.body.limit, limit, q);
    assert.equal(r.body.offset, offset, q);
    assert.equal(r.body.requests.length, n, q);
    assert.equal(r.body.total, 2, q);
  }
});

test("list: status filter; pending covers pending_approval, pending and submitted", async () => {
  const { pg, call, get, decide } = await setup();
  const ap = await call({ ...MIN, external_reference: "s-ap" });
  const pe = await call({ ...MIN, external_reference: "s-pe" }, { token: "tok-pending" });
  const rj = await call({ ...MIN, external_reference: "s-rj" }, { token: "tok-pending" });
  const pd = await call({ ...MIN, external_reference: "s-pd" });
  await decide(rj.body.request_number, "rejected", "No invoice");
  assert.equal((await call(PAY(pd.body.request_number))).status, 200);
  // Waiting statuses the real ERP uses besides "pending" (made in its UI, never by this API).
  await pg.query("insert into erp_payment_requests (external_source, status, title, amount, total_amount) values "
    + "('erp-ui', 'pending_approval', 'UI request', 10, 10), ('erp-ui', 'submitted', 'UI request 2', 10, 10)");

  const nums = async (status) => (await get("?status=" + status)).body.requests.map((x) => x.request_number).sort();
  assert.deepEqual(await nums("approved"), [ap.body.request_number]);
  assert.deepEqual(await nums("paid"), [pd.body.request_number]);
  assert.deepEqual(await nums("rejected"), [rj.body.request_number]);
  const pending = (await get("?status=pending")).body;
  assert.equal(pending.total, 3);
  assert.deepEqual(pending.requests.map((x) => x.status).sort(), ["pending", "pending_approval", "submitted"]);
  assert.ok(pending.requests.some((x) => x.request_number === pe.body.request_number));
  assert.equal((await get("?status=")).body.total, 6, "an empty status is no filter");
});

test("list: from / to filter the creation date (UTC), both inclusive, and combine with status", async () => {
  const { pg, call, get } = await setup();
  const mk = async (ref, at, token = "tok-auto") => {
    const r = await call({ ...MIN, external_reference: ref }, { token });
    await pg.query("update erp_payment_requests set created_at = $1 where request_number = $2", [at, r.body.request_number]);
    return r.body.request_number;
  };
  const oct31 = await mk("d-1", "2026-10-31T23:59:59.999Z");
  const nov1 = await mk("d-2", "2026-11-01T00:00:00Z");
  const nov17 = await mk("d-3", "2026-11-17T23:59:59Z", "tok-pending");
  const nov18 = await mk("d-4", "2026-11-18T00:00:00Z");
  const nums = async (q) => (await get(q)).body.requests.map((x) => x.request_number);
  assert.deepEqual(await nums("?from=2026-11-01&to=2026-11-17"), [nov17, nov1]);
  assert.deepEqual(await nums("?from=2026-11-18"), [nov18]);
  assert.deepEqual(await nums("?to=2026-10-31"), [oct31]);
  assert.deepEqual(await nums("?status=pending&from=2026-11-01&to=2026-11-17"), [nov17]);
  assert.deepEqual(await nums("?from=2026-11-18&to=2026-11-01"), []);
  assert.equal((await get("?from=2026-11-01&to=2026-11-17")).body.total, 2);
});

test("list: 400 for a bad status filter or a bad date; 401 without a valid token", async () => {
  const { call, get, rows } = await setup();
  await call({ ...MIN, external_reference: "e-1" });
  const BAD_STATUS = "Invalid status filter. Use one of: pending, approved, paid, rejected";
  for (const [q, error] of [
    ["?status=open", BAD_STATUS],
    ["?status=APPROVED", BAD_STATUS],
    ["?status=pending_approval", BAD_STATUS],
    ["?from=17-11-2026", "from must be a date YYYY-MM-DD"],
    ["?from=2026-02-30", "from must be a date YYYY-MM-DD"],
    ["?to=2026/11/17", "to must be a date YYYY-MM-DD"],
    ["?to=yesterday", "to must be a date YYYY-MM-DD"],
  ]) {
    const r = await get(q);
    assert.equal(r.status, 400, q);
    assert.deepEqual(r.body, { success: false, error }, q);
  }
  for (const [token, error] of [[null, "Missing API token"], ["nope", "Invalid API token"],
    ["tok-revoked", "API token has been revoked"], ["tok-expired", "API token has expired"]]) {
    const r = await get("?status=approved", { token });
    assert.equal(r.status, 401, String(token));
    assert.deepEqual(r.body, { success: false, error });
  }
  assert.equal((await rows()).length, 1);
});

test("get one: the request with three more fields, no approvals for an auto-approved one, its history", async () => {
  const { call, get } = await setup();
  const c = await call({ ...MIN, external_reference: "g-1", requester_first_name: "Test", requester_last_name: "Person",
    requester_email: "test@example.com" });
  const n = c.body.request_number;
  const r = await get("?request_number=" + n);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ["success", "request", "approvals", "history"]);
  assert.deepEqual(Object.keys(r.body.request), [...LIST_KEYS, "current_approval_level", "paid_by", "rejected_by"]);
  assert.equal(r.body.request.request_number, n);
  assert.equal(r.body.request.requester_first_name, "Test");
  assert.equal(r.body.request.requester_email, "test@example.com");
  assert.equal(r.body.request.current_approval_level, null);
  assert.deepEqual(r.body.approvals, []);
  const at = r.body.request.created_at;
  assert.deepEqual(r.body.history, [{ event: "submitted", at }, { event: "approved", at }]);

  // request_number wins over the list's filters; a number that does not exist is 404; an empty one is 400.
  assert.equal((await get("?status=paid&request_number=" + n)).body.request.id, c.body.request_id);
  const missing = await get("?request_number=PR-2026-01970");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { success: false, error: "Payment request not found" });
  const empty = await get("?request_number=");
  assert.equal(empty.status, 400);
  assert.deepEqual(empty.body, { success: false, error: "request_number must not be empty" });
  assert.equal((await get("?request_number=" + n, { token: null })).status, 401);
});

test("get one: a pending request approved through the chain, then paid: approvals and the whole history", async () => {
  const { call, get, decide } = await setup();
  const n = (await call({ ...MIN, external_reference: "g-2" }, { token: "tok-pending" })).body.request_number;
  const before = (await get("?request_number=" + n)).body;
  assert.equal(before.request.status, "pending");
  assert.equal(before.request.current_approval_level, 1);
  assert.deepEqual(before.history.map((e) => e.event), ["submitted"]);

  assert.deepEqual(await decide(n, "approved", "OK to pay"), { outcome: "approved" });
  assert.deepEqual(await decide(n, "rejected", "too late"), { outcome: "not_pending", status: "approved" });
  const paid = await call(PAY(n, { payment_reference: "FT26203ABC" }), { token: "tok-auto" });
  assert.equal(paid.status, 200);

  const r = (await get("?request_number=" + n)).body;
  assert.equal(r.request.status, "paid");
  assert.equal(r.request.paid_by, "zeami-test");
  assert.equal(r.request.payment_reference, "FT26203ABC");
  assert.equal(r.request.actual_payment_date, "2026-11-17");
  assert.match(r.request.paid_at, ISO);
  assert.equal(r.approvals.length, 1);
  const [ap] = r.approvals;
  assert.deepEqual(Object.keys(ap), ["approver_id", "approver_name", "approval_level", "status", "comments", "approved_at"]);
  assert.match(ap.approver_id, /^[0-9a-f-]{36}$/);
  assert.equal(ap.approver_name, "Sandbox approver");
  assert.equal(ap.approval_level, 1);
  assert.equal(ap.status, "approved");
  assert.equal(ap.comments, "OK to pay");
  assert.equal(ap.approved_at, r.request.approved_at);
  assert.deepEqual(r.history, [
    { event: "submitted", at: r.request.submitted_at },
    { event: "level_1_approved", at: ap.approved_at, by: "Sandbox approver", comments: "OK to pay" },
    { event: "approved", at: r.request.approved_at },
    { event: "paid", at: r.request.paid_at, by: "zeami-test", reference: "FT26203ABC" },
  ]);
});

test("get one: a rejected request carries its reason, who rejected it, and when", async () => {
  const { call, get, decide } = await setup();
  const n = (await call({ ...MIN, external_reference: "g-3" }, { token: "tok-pending" })).body.request_number;
  await decide(n, "rejected", "Duplicate of PR-2026-01964");
  const r = (await get("?request_number=" + n)).body;
  assert.equal(r.request.status, "rejected");
  assert.equal(r.request.rejection_reason, "Duplicate of PR-2026-01964");
  assert.equal(r.request.rejected_by, "Sandbox approver");
  assert.match(r.request.rejected_at, ISO);
  assert.equal(r.request.approved_at, null);
  assert.equal(r.approvals[0].status, "rejected");
  assert.equal(r.approvals[0].approved_at, null);
  assert.deepEqual(r.history.map((e) => e.event), ["submitted", "level_1_rejected", "rejected"]);
  assert.deepEqual(r.history[2], { event: "rejected", at: r.request.rejected_at, by: "Sandbox approver",
    reason: "Duplicate of PR-2026-01964" });
  assert.equal(r.history[1].at, r.request.rejected_at);
});

test("mark_paid: 200 with the expense number; the row is paid; the list moves it from approved to paid", async () => {
  const { pg, call, get, rows } = await setup();
  const c = await call({ ...MIN, external_reference: "p-1", vat_applicable: true, vat_amount: 150,
    allocations: [{ business_unit: "chipchip", percentage: 100 }] });
  const n = c.body.request_number;
  const bank = "6B863514-0000-4000-8000-00000000AAAA";
  const r = await call(PAY(n, { bank_account_id: bank }), { token: "tok-pending" });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ["success", "request_number", "status", "payment_reference", "payment_date", "expense_number"]);
  const year = (await pg.query("select to_char(now() at time zone 'Africa/Addis_Ababa', 'YYYY') as y")).rows[0].y;
  assert.deepEqual(r.body, { success: true, request_number: n, status: "paid", payment_reference: "FT2625883RYN",
    payment_date: "2026-11-17", expense_number: "EXP-" + year + "-90001" });
  const [row] = await rows();
  assert.equal(row.status, "paid");
  assert.equal(row.paid_by, "zeami-pending", "the paying token's System Name");
  assert.equal(row.bank_account_id, bank.toLowerCase());
  assert.equal(row.expense_number, "EXP-" + year + "-90001");
  assert.ok(row.paid_at instanceof Date);
  assert.deepEqual((await get("?status=approved")).body.requests, []);
  const listed = (await get("?status=paid")).body.requests;
  assert.deepEqual(listed.map((x) => [x.request_number, x.status, x.payment_reference, x.actual_payment_date]),
    [[n, "paid", "FT2625883RYN", "2026-11-17"]]);
  assert.equal(listed[0].vat_amount, 150);

  // A second request gets the next expense number.
  const n2 = (await call({ ...MIN, external_reference: "p-2" })).body.request_number;
  assert.equal((await call(PAY(n2))).body.expense_number, "EXP-" + year + "-90002");
});

test("mark_paid twice is safe: 200 already_paid with the FIRST payment, nothing changes", async () => {
  const { call, rows } = await setup();
  const n = (await call({ ...MIN, external_reference: "p-3" })).body.request_number;
  const first = await call(PAY(n));
  const again = await call(PAY(n, { payment_reference: "FT-OTHER", payment_date: "2026-11-20" }));
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { success: true, already_paid: true, request_number: n, status: "paid",
    payment_reference: "FT2625883RYN", payment_date: "2026-11-17", expense_number: first.body.expense_number });
  const [row] = await rows();
  assert.equal(row.payment_reference, "FT2625883RYN");
  assert.equal(row.expense_number, first.body.expense_number);
  // The create's duplicate answer then says paid.
  assert.equal((await call({ ...MIN, external_reference: "p-3" })).body.status, "paid");
});

test("mark_paid: 409 unless approved (pending, rejected); 404 for an unknown number; nothing changes", async () => {
  const { call, rows, decide } = await setup();
  const pend = (await call({ ...MIN, external_reference: "x-1" }, { token: "tok-pending" })).body.request_number;
  const rej = (await call({ ...MIN, external_reference: "x-2" }, { token: "tok-pending" })).body.request_number;
  await decide(rej, "rejected", "no");
  for (const [n, status] of [[pend, "pending"], [rej, "rejected"]]) {
    const r = await call(PAY(n));
    assert.equal(r.status, 409, status);
    assert.deepEqual(r.body, { success: false, error: "Only approved requests can be marked paid. " + n + " is " + status });
  }
  const missing = await call(PAY("PR-2026-01970"));
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { success: false, error: "Payment request not found" });
  assert.deepEqual((await rows()).map((r) => [r.status, r.paid_at, r.expense_number]),
    [["pending", null, null], ["rejected", null, null]]);
});

test("mark_paid: 400 for a missing or wrong field, or an unknown action; payment_date defaults to today (UTC)", async () => {
  const { call, rows } = await setup();
  const n = (await call({ ...MIN, external_reference: "v-1" })).body.request_number;
  for (const [body, error] of [
    [{ action: "mark_paid", payment_reference: "FT1" }, "request_number is required"],
    [{ action: "mark_paid", request_number: "  ", payment_reference: "FT1" }, "request_number is required"],
    [{ action: "mark_paid", request_number: n }, "payment_reference is required"],
    [{ action: "mark_paid", request_number: n, payment_reference: " " }, "payment_reference is required"],
    [{ action: "mark_paid", request_number: n, payment_reference: "F".repeat(201) }, "payment_reference must be at most 200 characters"],
    [PAY(n, { payment_date: "17/11/2026" }), "payment_date must be a date YYYY-MM-DD"],
    [PAY(n, { payment_date: "2026-11-31" }), "payment_date must be a date YYYY-MM-DD"],
    [PAY(n, { bank_account_id: "CBE-main" }), "bank_account_id must be a uuid"],
    [{ ...PAY(n), action: "pay" }, UNKNOWN_ACTION],
    [{ ...MIN, action: "create" }, UNKNOWN_ACTION],
  ]) {
    const r = await call(body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.deepEqual(r.body, { success: false, error });
  }
  assert.equal((await rows())[0].status, "approved");
  assert.equal((await rows()).length, 1);

  const r = await call({ action: "mark_paid", request_number: n, payment_reference: "F".repeat(200) });
  assert.equal(r.status, 200);
  assert.equal(r.body.payment_date, "2026-11-17", "today, from the clock (2026-11-17T09:00Z in this file)");
});

test("mark_paid FAIL500-: paid AND answers 500; the retry answers 200 already_paid", async () => {
  const { call, rows, logs } = await setup();
  const n = (await call({ ...MIN, external_reference: "f-1" })).body.request_number;
  const r = await call(PAY(n, { payment_reference: "FAIL500-ft1" }));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { success: false, error: "Internal server error" });
  assert.equal((await rows())[0].status, "paid");
  assert.ok(logs.some((l) => l.includes(n) && l.includes("marked paid")));
  const retry = await call(PAY(n, { payment_reference: "FAIL500-ft1" }));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.already_paid, true);
});

test("a database error on list, get one or mark_paid answers 500 and logs no token", async () => {
  const logs = [];
  const boom = async () => { throw new Error("connection refused"); };
  const deps = { store: { findByReference: boom, insert: boom, list: boom, get: boom, markPaid: boom },
    tokens: () => TOKENS, log: (l) => logs.push(l) };
  const send = (method, query, body) => handleExternalPaymentRequest(new Request(URL_ + query, { method,
    headers: { authorization: "Bearer tok-auto" }, ...(body ? { body: JSON.stringify(body) } : {}) }), deps);
  for (const res of [await send("GET", "?status=approved"), await send("GET", "?request_number=PR-2026-90001"),
    await send("POST", "", PAY("PR-2026-90001"))]) {
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { success: false, error: "Internal server error" });
  }
  assert.deepEqual(logs, Array(3).fill("erp mock: database error: connection refused"));
});

test("items: stored as line items; a wrong shape is 400", async () => {
  const { call, rows } = await setup();
  const items = [{ description: "Cotton shirts", quantity: 10, unit_price: 100, amount: 1000, notes: "size M" },
    { description: "Delivery", amount: 500 }];
  assert.equal((await call({ ...MIN, external_reference: "i-1", items })).status, 200);
  assert.deepEqual((await rows())[0].items, [items[0],
    { description: "Delivery", quantity: null, unit_price: null, amount: 500, notes: null }]);
  for (const [bad, error] of [[{}, "items must be a list"],
    [["x"], "items[0] must be an object {description, quantity, unit_price, amount, notes}"],
    [[{ quantity: "10" }], "items[0].quantity must be a number"], [[{ description: 5 }], "items[0].description must be a string"]]) {
    const r = await call({ ...MIN, items: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.deepEqual(r.body, { success: false, error });
  }
  assert.equal((await rows()).length, 1);
});

test("the v2 SQL over a first-version table keeps its requests and dates them", async () => {
  const pg = await freshDb();
  await pg.exec("drop table if exists erp_payment_requests cascade; drop sequence if exists erp_payment_request_seq cascade; "
    + "drop sequence if exists erp_expense_seq cascade;");
  await pg.exec(SQL.slice(0, SQL.indexOf("-- ---------- v2")));
  await pg.query("insert into erp_payment_requests (external_source, external_reference, status, title, amount, total_amount) "
    + "values ('zeami-test', 'old-1', 'approved', 'Old', 5, 5), ('zeami-test', 'old-2', 'pending', 'Old 2', 5, 5)");
  await pg.exec(SQL);
  await pg.exec(SQL);
  const r = (await pg.query("select * from erp_payment_requests order by external_reference")).rows;
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => [x.submitted_at?.getTime(), x.approved_at?.getTime() ?? null, x.current_approval_level]),
    [[r[0].created_at.getTime(), r[0].created_at.getTime(), null], [r[1].created_at.getTime(), null, 1]]);
  assert.deepEqual(r[0].items, []);
});

test("OpenAPI: GET and POST under /erp/functions/v1, Bearer auth, every answer documented, both POST shapes", () => {
  const spec = erpSpec("https://b2b-mock.vercel.app");
  assert.deepEqual(spec.servers, [{ url: "https://b2b-mock.vercel.app/erp/functions/v1" }]);
  assert.deepEqual(Object.keys(spec.paths), ["/external-payment-requests"]);
  const op = spec.paths["/external-payment-requests"];
  assert.deepEqual(Object.keys(op), ["get", "post"]);
  assert.deepEqual(Object.keys(op.get.responses).sort(), ["200", "400", "401", "404", "405", "500"]);
  assert.deepEqual(op.get.parameters.map((p) => p.name), ["request_number", "status", "from", "to", "limit", "offset"]);
  assert.deepEqual(Object.keys(op.post.responses).sort(), ["200", "400", "401", "404", "405", "409", "500"]);
  const body = op.post.requestBody.content["application/json"].schema;
  for (const k of ["title", "total_amount", "items", "documents", "allocations", "action", "request_number",
    "payment_reference", "payment_date", "bank_account_id"]) assert.ok(body.properties[k], k);
  assert.ok(Object.keys(body.properties).length < 40, "under the importer's 40-field cap");
  assert.equal(body.required, undefined, "two shapes: what each needs is in the descriptions");
  const listItem = op.get.responses["200"].content["application/json"].schema.properties.requests.items.properties;
  assert.deepEqual(Object.keys(listItem), LIST_KEYS);
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, "bearer");
});

/* ---------- departments and categories (lib/erpDepartments.json, the ERP staging form's list) ---------- */

const DEPTS = JSON.parse(readFileSync(new URL("../lib/erpDepartments.json", import.meta.url), "utf8"));
const SOURCING = "6b863514-6646-4a6e-aca4-d53d40ef0862";
const GARMENT = "39e52256-6829-4183-88c1-979f96d9b3f9";
const B2B_REPAY = "b1134780-e645-4d07-b7f5-c5f0da451781";

test("lib/erpDepartments.json: 15 departments, ids are uuids, SOURCING and its two categories match the ERP guide", () => {
  assert.equal(DEPTS.length, 15);
  assert.deepEqual(DEPTS.map((d) => d.name), ["Administration", "CUSTOMER SERVICE", "Export", "Finance", "GRANT", "LEGAL",
    "LOGISTICS", "MARKETING", "Operations", "Procurement", "Quality", "Sales", "SOURCING", "Technology", "Warehouse"]);
  const U = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const d of DEPTS) {
    assert.match(d.id, U, d.name);
    for (const c of d.categories) assert.match(c.id, U, `${d.name} / ${c.name}`);
  }
  assert.equal(DEPTS.reduce((n, d) => n + d.categories.length, 0), 100);
  const src = DEPTS.find((d) => d.name === "SOURCING");
  assert.equal(src.id, SOURCING);
  assert.equal(src.categories.find((c) => c.id === GARMENT).name, "Direct Garment Sales");
  assert.equal(src.categories.find((c) => c.id === B2B_REPAY).name, "B2B Purchase Repayment");
});

test("departmentCategory: names when known, and a category outside its department is flagged", () => {
  assert.deepEqual(departmentCategory(DEPTS, SOURCING.toUpperCase(), GARMENT),
    { department: "SOURCING", category: "Direct Garment Sales", category_code: "COGS-SO-P005", category_not_in_department: false });
  const admin = DEPTS.find((d) => d.name === "Administration");
  const r = departmentCategory(DEPTS, admin.id, B2B_REPAY);
  assert.equal(r.department, "Administration");
  assert.equal(r.category, "B2B Purchase Repayment", "named from its own department");
  assert.equal(r.category_not_in_department, true);
  // "Salary" is under both Administration and Operations: in either, not flagged.
  const salary = admin.categories.find((c) => c.name === "Salary").id;
  assert.equal(departmentCategory(DEPTS, DEPTS.find((d) => d.name === "Operations").id, salary).category_not_in_department, false);
  // Unknown ids: no names; a category is flagged only against a known department.
  const unknown = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(departmentCategory(DEPTS, unknown, GARMENT),
    { department: null, category: "Direct Garment Sales", category_code: "COGS-SO-P005", category_not_in_department: false });
  assert.equal(departmentCategory(DEPTS, SOURCING, unknown).category_not_in_department, true);
  assert.deepEqual(departmentCategory(DEPTS, null, null),
    { department: null, category: null, category_code: null, category_not_in_department: false });
  assert.equal(departmentCategory(DEPTS, SOURCING, null).category_not_in_department, false);
});

test("create accepts a category outside its department (the guide documents no refusal) and stores both ids", async () => {
  const { call, rows } = await setup();
  const admin = DEPTS.find((d) => d.name === "Administration").id;
  const r = await call({ ...MIN, external_reference: "dc-1", department_id: admin, category_id: B2B_REPAY });
  assert.equal(r.status, 200);
  const [row] = await rows();
  assert.equal(row.department_id, admin);
  assert.equal(row.category_id, B2B_REPAY);
});
