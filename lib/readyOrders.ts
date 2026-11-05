import { db } from "@/lib/db";
import { notifyZeami, orderReadyEvent, zeamiOn } from "@/lib/zeami";

/** An order is ready once its sender has been quiet this long (they often send a list, then a photo, then a note). */
export const QUIET_SECONDS = 90;

/**
 * Tells Zeami about every order that became ready and is not announced yet (`order_ready`, see lib/zeami.ts).
 * Called every minute by GET /api/cron/order-ready and, cheaply, by the bot's webhook on each incoming message.
 * claim_ready_orders() (supabase/add_zeami_notify.sql) gives each order to one caller only, so the two never send the
 * same one at once; an order Zeami did not take is freed and tried again on the next call.
 * Never throws. ZEAMI_HOOK_URL unset: does nothing and touches no row.
 */
export async function notifyReadyOrders(limit = 20): Promise<{ notify: "on" | "off"; sent: number; failed: number }> {
  const out = { notify: "on" as "on" | "off", sent: 0, failed: 0 };
  if (!zeamiOn()) return { ...out, notify: "off" };
  try {
    const claim = await db().rpc("claim_ready_orders", { p_quiet_seconds: QUIET_SECONDS, p_limit: limit });
    if (claim.error) throw new Error(claim.error.message);
    const rows = (claim.data || []) as { inbox_id: number; round: number }[];
    await Promise.all(rows.map(async (r) => {
      const res = await notifyZeami(orderReadyEvent(r.inbox_id, r.round));
      const sent = res === "sent";
      if (sent) out.sent++; else out.failed++;
      const done = await db().rpc("finish_ready_order", { p_inbox_id: r.inbox_id, p_round: r.round, p_sent: sent });
      if (done.error) console.log("finish_ready_order failed", r.inbox_id, done.error.message);
    }));
  } catch (e) {
    console.log("ready orders check failed", (e as Error).message);
  }
  return out;
}
