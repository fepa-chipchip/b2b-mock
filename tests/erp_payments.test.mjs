// The fake ChipChip ERP's POST /erp/functions/v1/external-payment-requests (lib/erpPayments.ts), run against a real
// Postgres (PGlite, in-process) built from supabase/erp_payment_requests.sql, standing in for Supabase.
// Run with `npm test` (Node 22.18+ loads the .ts files directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { handleExternalPaymentRequest, loadTokens, loadHashedTokens, allTokens, base64Size } from "../lib/erpPayments.ts";
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
  "requester_last_name", "requester_email", "documents", "allocations"];

/** What supabase-js does for lib/erpStore.ts: select by (source, reference), insert returning; 23505 = conflict. */
function pgStore(pg) {
  return {
    async findByReference(source, ref) {
      const r = await pg.query("select id, request_number, status from erp_payment_requests where external_source = $1 and external_reference = $2", [source, ref]);
      return r.rows[0] || null;
    },
    async insert(row) {
      const vals = COLS.map((c) => (c === "documents" || c === "allocations" ? JSON.stringify(row[c]) : row[c]));
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
  };
}

// One in-process Postgres for the file (starting one takes seconds); each test starts from a fresh table.
let shared = null;
async function freshDb() {
  if (!shared) { shared = new PGlite(); await shared.exec(ROLES); }
  await shared.exec(`drop table if exists erp_payment_requests; drop function if exists erp_next_request_number();
    drop sequence if exists erp_payment_request_seq;`);
  await shared.exec(SQL);
  return shared;
}

async function setup(tokens = TOKENS) {
  const pg = await freshDb();
  const logs = [];
  const deps = { store: pgStore(pg), tokens: () => tokens, now: () => new Date("2026-11-17T09:00:00Z"), log: (l) => logs.push(l) };
  const call = async (body, { token = "tok-auto", method = "POST", raw } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (method !== "GET" && method !== "DELETE") init.body = raw !== undefined ? raw : JSON.stringify(body);
    const res = await handleExternalPaymentRequest(new Request(URL_, init), deps);
    return { status: res.status, body: await res.json() };
  };
  const rows = async () => (await pg.query("select * from erp_payment_requests order by created_at, request_number")).rows;
  return { pg, call, rows, logs };
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

test("405: any method but POST, before the token is looked at", async () => {
  const { call } = await setup();
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const r = await call(MIN, { method, token: null });
    assert.equal(r.status, 405, method);
    assert.deepEqual(r.body, { success: false, error: "Method not allowed" });
  }
});

test("201 auto-approve: approved, mock number PR-<year>-9xxxx, defaults filled, source = the token's System Name", async () => {
  const { call, rows } = await setup();
  const r = await call({ ...MIN, external_reference: "order-1" });
  assert.equal(r.status, 201);
  assert.equal(r.body.success, true);
  assert.equal(r.body.status, "approved");
  assert.equal(r.body.message, "Payment request created");
  assert.match(r.body.request_id, /^[0-9a-f-]{36}$/);
  assert.match(r.body.request_number, /^PR-\d{4}-9\d{4}$/);
  assert.deepEqual(Object.keys(r.body).sort(), ["message", "request_id", "request_number", "status", "success"]);
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
  assert.equal(second.status, 201);
  assert.notEqual(second.body.request_number, r.body.request_number);
});

test("201 without auto-approve: pending", async () => {
  const { call, rows } = await setup();
  const r = await call({ ...MIN, external_reference: "order-p" }, { token: "tok-pending" });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "pending");
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
  assert.equal(a.status, 201);
  assert.equal(a.body.status, "approved");
  assert.match(a.body.request_number, /^PR-\d{4}-9\d{4}$/);
  const p = await call({ ...MIN, external_reference: "h-2" }, { token: "hash-pending" });
  assert.equal(p.status, 201);
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
  assert.equal((await call({ ...MIN, external_reference: "e-1" }, { token: "env-tok" })).status, 201);
  assert.equal((await call({ ...MIN, external_reference: "e-2" }, { token: "hash-auto" })).status, 201);
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
  assert.equal(first.status, 201);
  const again = await call({ title: "changed title", total_amount: 99, external_reference: "inv-77" }, { token: "tok-pending" });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { success: true, duplicate: true, request_id: first.body.request_id,
    request_number: first.body.request_number, status: "pending" });
  assert.equal((await rows()).length, 1);

  // Another System Name may use the same reference; requests without a reference are never deduped.
  assert.equal((await call({ ...MIN, external_reference: "inv-77" }, { token: "tok-auto" })).status, 201);
  assert.equal((await call(MIN)).status, 201);
  assert.equal((await call(MIN)).status, 201);
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
  assert.equal(ten.status, 201);
});

test("documents: only name, type and size are stored, never the base64", async () => {
  const { pg, call } = await setup();
  const big = Buffer.alloc(3000, 7).toString("base64");
  const r = await call({ ...MIN, external_reference: "docs-1", documents: [
    { file_name: "invoice.pdf", file_type: "application/pdf", base64: B64 },
    { file_name: "receipt.jpg", file_type: "image/jpeg", base64: big.replace(/(.{76})/g, "$1\n") },
  ] });
  assert.equal(r.status, 201);
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
  assert.equal((await call(body)).status, 201);
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

test("OpenAPI: one POST under /erp/functions/v1, Bearer auth, every answer documented", () => {
  const spec = erpSpec("https://b2b-mock.vercel.app");
  assert.deepEqual(spec.servers, [{ url: "https://b2b-mock.vercel.app/erp/functions/v1" }]);
  assert.deepEqual(Object.keys(spec.paths), ["/external-payment-requests"]);
  const op = spec.paths["/external-payment-requests"];
  assert.deepEqual(Object.keys(op), ["post"]);
  assert.deepEqual(Object.keys(op.post.responses).sort(), ["200", "201", "400", "401", "405", "500"]);
  assert.deepEqual(op.post.requestBody.content["application/json"].schema.required, ["title", "total_amount"]);
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, "bearer");
});
