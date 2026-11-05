// Which orders the "order ready" notice picks (claim_ready_orders / finish_ready_order), run on a real Postgres
// (PGlite, in-process) from the repo's own SQL: the live-database file supabase/add_zeami_notify.sql and the full
// supabase/schema.sql must both behave the same. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("supabase/add_zeami_notify.sql");
const SCHEMA = read("supabase/schema.sql");

// Supabase's API roles, which the files revoke from and grant to.
const ROLES = "create role anon; create role authenticated; create role service_role;";

// The inbox table as it was before the notices (what a live database has when add_zeami_notify.sql runs).
const OLD_INBOX = `create table inbox (
  id serial primary key, telegram_chat_id bigint not null, sender_phone text, sender_name text, admin_user_id uuid,
  company_id uuid, status text not null default 'collecting', agent_note text, b2b_order_number text,
  admin_bill_id text, created_at timestamptz default now(), last_message_at timestamptz default now());`;

function schemaPart(start, end) {
  const i = SCHEMA.indexOf(start);
  const j = SCHEMA.indexOf(end, i);
  assert.ok(i >= 0 && j > i, `schema.sql has ${start} ... ${end}`);
  return SCHEMA.slice(i, j + end.length);
}

async function fromMigration() {
  const db = new PGlite();
  await db.exec(ROLES + OLD_INBOX);
  return db;
}

async function fromSchema() {
  const db = new PGlite();
  await db.exec(ROLES + schemaPart("create table inbox (", ");\n") +
    schemaPart("create index inbox_collecting_last_message", ";\n") +
    schemaPart("create or replace function claim_ready_orders", "notify pgrst, 'reload schema';"));
  return db;
}

/** A new order: `quiet` seconds since its last message. */
async function order(db, quiet, status = "collecting") {
  const r = await db.query(
    `insert into inbox (telegram_chat_id, status, last_message_at) values (1, $1, now() - make_interval(secs => $2)) returning id`,
    [status, quiet]);
  return r.rows[0].id;
}
const claim = async (db) => (await db.query("select * from claim_ready_orders()")).rows.map((r) => [r.inbox_id, r.round]);
const finish = (db, id, round, sent) => db.query("select finish_ready_order($1, $2, $3)", [id, round, sent]);
const customerWrites = (db, id, quiet) =>
  db.query("update inbox set status = 'collecting', last_message_at = now() - make_interval(secs => $2) where id = $1", [id, quiet]);

async function behaves(db) {
  const ready = await order(db, 100);
  const typing = await order(db, 30);          // still within the 90 s
  const asked = await order(db, 300, "asked");  // waiting for the customer's answer
  await order(db, 300, "proposed");
  await order(db, 300, "waiting_signup");
  await order(db, 2 * 86400);                   // left in collecting for two days

  assert.deepEqual(await claim(db), [[ready, 1]], "only the collecting order quiet 90 s, under a day old");
  assert.deepEqual(await claim(db), [], "a claimed order goes to one caller only");

  await finish(db, ready, 1, false);
  assert.deepEqual(await claim(db), [[ready, 1]], "not sent: freed, tried again with the same round");
  await finish(db, ready, 1, true);
  assert.deepEqual(await claim(db), [], "sent: not announced again");

  await customerWrites(db, typing, 95);
  assert.deepEqual(await claim(db), [[typing, 1]], "the second order once it too went quiet");
  await db.query("update inbox set ready_claimed_at = now() - interval '3 minutes' where id = $1", [typing]);
  assert.deepEqual(await claim(db), [[typing, 1]], "a claim left for over 2 minutes (caller died) is free again");
  await finish(db, typing, 1, true);

  await customerWrites(db, ready, 95);
  assert.deepEqual(await claim(db), [[ready, 2]], "the customer wrote again after the notice: round 2");
  await finish(db, ready, 2, true);
  assert.deepEqual(await claim(db), []);

  await customerWrites(db, asked, 91);
  assert.deepEqual(await claim(db), [[asked, 1]], "an answer to the agent's question makes that order ready");

  // A message that lands between the claim and the notice is not swallowed: the notice covers the claimed message only.
  const racing = await order(db, 120);
  await finish(db, asked, 1, true);
  assert.deepEqual(await claim(db), [[racing, 1]]);
  await customerWrites(db, racing, 100);
  await finish(db, racing, 1, true);
  assert.deepEqual(await claim(db), [[racing, 2]]);
}

test("live database: add_zeami_notify.sql leaves earlier orders unannounced and is safe to run twice", async () => {
  const db = await fromMigration();
  const before = await order(db, 100);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  assert.deepEqual(await claim(db), [], "an order from before the file is not announced");
  await customerWrites(db, before, 95);
  assert.deepEqual(await claim(db), [[before, 1]], "but it is once its customer writes again");
  await finish(db, before, 1, true);
  await behaves(db);
});

test("fresh database: schema.sql's table and functions behave the same", async () => {
  await behaves(await fromSchema());
});

test("schema.sql and add_zeami_notify.sql carry the same functions", () => {
  const fns = (sql) => sql.slice(sql.indexOf("create or replace function claim_ready_orders"))
    .split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");
  assert.equal(fns(SCHEMA), fns(MIGRATION));
});

test("only the service role may call them", async () => {
  const db = await fromSchema();
  const can = async (role, fn) =>
    (await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok;
  for (const fn of ["claim_ready_orders(int, int, int)", "finish_ready_order(int, int, boolean)"]) {
    assert.equal(await can("service_role", fn), true, fn);
    assert.equal(await can("anon", fn), false, fn);
    assert.equal(await can("authenticated", fn), false, fn);
  }
});
