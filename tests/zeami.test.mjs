// The Zeami notice helper (lib/zeami.ts): what it sends, when it retries, and that the link never reaches the log.
// Run with `npm test` (Node 22.18+ loads the .ts file directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyZeami, orderReadyEvent, signupCompletedEvent } from "../lib/zeami.ts";

const URL_ = "https://zeami.example/hooks/secret-token-123";

/** A fetch that answers from a list, one entry per call: a status number, "hang" (never answers) or an Error. */
function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a === "hang")
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    if (a instanceof Error) throw a;
    return new Response("{}", { status: a });
  };
  return { impl, calls };
}

const logs = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };

test("event bodies carry ids only, with the agreed event ids", () => {
  assert.deepEqual(signupCompletedEvent(7, 41), { event: "signup_completed", signup_id: 7, inbox_id: 41, event_id: "signup-7-completed" });
  assert.deepEqual(signupCompletedEvent(7, null), { event: "signup_completed", signup_id: 7, event_id: "signup-7-completed" });
  assert.deepEqual(orderReadyEvent(41), { event: "order_ready", inbox_id: 41, event_id: "order-41-ready" });
  assert.deepEqual(orderReadyEvent(41, 1), { event: "order_ready", inbox_id: 41, event_id: "order-41-ready" });
  assert.deepEqual(orderReadyEvent(41, 2), { event: "order_ready", inbox_id: 41, event_id: "order-41-ready-2" });
});

test("no link: nothing is sent", async () => {
  const f = fakeFetch([200]);
  const saved = process.env.ZEAMI_HOOK_URL;
  delete process.env.ZEAMI_HOOK_URL;
  try {
    assert.equal(await notifyZeami(orderReadyEvent(1), { fetchImpl: f.impl }), "off");
    assert.equal(await notifyZeami(orderReadyEvent(1), { url: "  ", fetchImpl: f.impl }), "off");
  } finally {
    if (saved !== undefined) process.env.ZEAMI_HOOK_URL = saved;
  }
  assert.equal(f.calls.length, 0);
});

test("a 2xx is sent: one POST of the JSON body", async () => {
  const f = fakeFetch([202]);
  const l = logs();
  assert.equal(await notifyZeami(orderReadyEvent(5), { url: URL_, fetchImpl: f.impl, log: l.log }), "sent");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, URL_);
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(f.calls[0].body, { event: "order_ready", inbox_id: 5, event_id: "order-5-ready" });
  assert.deepEqual(l.lines, []);
});

test("a 5xx or a network error is retried once", async () => {
  const a = fakeFetch([503, 200]);
  assert.equal(await notifyZeami(orderReadyEvent(5), { url: URL_, fetchImpl: a.impl, log: () => {} }), "sent");
  assert.equal(a.calls.length, 2);
  assert.deepEqual(a.calls[0].body, a.calls[1].body, "the retry sends the same event id");

  const b = fakeFetch([new TypeError("fetch failed"), 200]);
  assert.equal(await notifyZeami(orderReadyEvent(5), { url: URL_, fetchImpl: b.impl, log: () => {} }), "sent");
  assert.equal(b.calls.length, 2);
});

test("two failures: failed, two tries only, one log line naming the event", async () => {
  const f = fakeFetch([500, 502, 200]);
  const l = logs();
  assert.equal(await notifyZeami(signupCompletedEvent(3, 9), { url: URL_, fetchImpl: f.impl, log: l.log }), "failed");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(l.lines, ["zeami notify failed: signup-3-completed (HTTP 502)"]);
});

test("Zeami's own refusal (404 unknown token, 409 agent off) is not retried", async () => {
  for (const status of [404, 409]) {
    const f = fakeFetch([status, 200]);
    assert.equal(await notifyZeami(orderReadyEvent(5), { url: URL_, fetchImpl: f.impl, log: () => {} }), "failed");
    assert.equal(f.calls.length, 1, `HTTP ${status}`);
  }
});

test("a hanging Zeami times out per try and the whole call stays bounded", async () => {
  const f = fakeFetch(["hang"]);
  const l = logs();
  const t0 = Date.now();
  assert.equal(await notifyZeami(orderReadyEvent(5), { url: URL_, fetchImpl: f.impl, timeoutMs: 50, log: l.log }), "failed");
  assert.equal(f.calls.length, 2);
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(l.lines, ["zeami notify failed: order-5-ready (timeout)"]);
});

test("the link and its token never reach the log, even when the error quotes them", async () => {
  const err = new TypeError(`fetch failed for ${URL_}`);
  err.cause = Object.assign(new Error(`getaddrinfo ENOTFOUND ${URL_}`), { code: "ENOTFOUND" });
  const f = fakeFetch([err]);
  const l = logs();
  assert.equal(await notifyZeami(orderReadyEvent(5), { url: URL_, fetchImpl: f.impl, log: l.log }), "failed");
  assert.deepEqual(l.lines, ["zeami notify failed: order-5-ready (ENOTFOUND)"]);
  assert.ok(!l.lines.join("\n").includes("secret-token-123"));
});

test("a fetch that throws before answering never escapes", async () => {
  const impl = () => { throw new Error(URL_); };
  const l = logs();
  assert.equal(await notifyZeami(orderReadyEvent(5), { url: URL_, fetchImpl: impl, log: l.log }), "failed");
  assert.ok(!l.lines.join("\n").includes("secret-token-123"));
});
