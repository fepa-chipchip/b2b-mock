/* ---------- Telling Zeami that the order agent has work ----------
 * Zeami gives each agent an event link, `POST https://<zeami-host>/hooks/<token>`, that starts the agent with the JSON
 * body as its input. It dedupes by `event_id` for 24 h and queues an event while the agent's previous run still waits.
 * The full link (token included) is the env var ZEAMI_HOOK_URL. Unset: nothing is sent, so local runs and any copy of
 * the app without it behave as before.
 *
 * Fire-and-forget: 5 s per try, one retry, never throws. A failure is logged with the event id only; the link holds the
 * token, so neither it nor the error text (which can quote it) reaches the log. The body carries ids, never a name,
 * phone or message.
 *
 * No imports on purpose: tests/zeami.test.mjs loads this file straight into Node.
 */

export type ZeamiEvent =
  | { event: "signup_completed"; signup_id: number; inbox_id?: number; event_id: string }
  | { event: "order_ready"; inbox_id: number; event_id: string };

export type NotifyResult = "sent" | "failed" | "off";

export const TIMEOUT_MS = 5000;

/** The sign-up's answers are all in and it now waits for Simenesh. Sent once per sign-up. */
export function signupCompletedEvent(signupId: number, inboxId?: number | null): ZeamiEvent {
  return {
    event: "signup_completed", signup_id: signupId,
    ...(inboxId != null ? { inbox_id: inboxId } : {}),
    event_id: `signup-${signupId}-completed`,
  };
}

/**
 * The order's sender has been quiet long enough: the order is ready to prepare. `round` counts the times this order
 * became ready: 1 the first time, 2 after the customer wrote again (answered the agent's question, added an item), and
 * so on. Each round has its own event_id, so Zeami's dedupe drops a repeat of the same round but not a new one.
 */
export function orderReadyEvent(inboxId: number, round = 1): ZeamiEvent {
  return {
    event: "order_ready", inbox_id: inboxId,
    event_id: round <= 1 ? `order-${inboxId}-ready` : `order-${inboxId}-ready-${round}`,
  };
}

export const zeamiOn = (): boolean => !!process.env.ZEAMI_HOOK_URL?.trim();

type Options = { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number; log?: (line: string) => void };

/** A 4xx other than 408/429 is Zeami's answer (unknown token, agent switched off): trying again changes nothing. */
const worthRetry = (status: number) => status >= 500 || status === 408 || status === 429;

/** Posts one event to Zeami. Never throws; answers what happened. */
export async function notifyZeami(ev: ZeamiEvent, opts: Options = {}): Promise<NotifyResult> {
  const url = (opts.url ?? process.env.ZEAMI_HOOK_URL ?? "").trim();
  if (!url) return "off";
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log ?? ((line: string) => console.log(line));
  const body = JSON.stringify(ev);
  let why = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        method: "POST", headers: { "content-type": "application/json" }, body, signal: ctrl.signal,
      });
      if (res.ok) return "sent";
      why = `HTTP ${res.status}`;
      if (!worthRetry(res.status)) break;
    } catch (e) {
      // Only the error's kind: its message and cause can quote the URL, and the URL is the token.
      const err = e as { name?: string; cause?: { code?: string } };
      why = ctrl.signal.aborted ? "timeout" : err?.cause?.code || err?.name || "error";
    } finally {
      clearTimeout(timer);
    }
  }
  log(`zeami notify failed: ${ev.event_id} (${why})`);
  return "failed";
}
