import { db, must } from "@/lib/db";
import { agentOnly, ok } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/signups             new customers who answered the order bot's questions and wait for Simenesh
 * GET /api/agent/signups?status=all  the latest 30 in any state
 * Each: { id, telegram_id, telegram_chat_id, phone, telegram_name, step, business_name, business_type, tin, address,
 *         latitude, longitude, status, agent_note, b2b_customer_id, admin_company_id, admin_user_id, created_at,
 *         updated_at, waiting_orders }
 * waiting_orders: how many orders this phone sent meanwhile (inbox rows with status waiting_signup). They reach
 * GET /api/agent/inbox once the sign-up is set registered.
 */
export async function GET(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const all = new URL(req.url).searchParams.get("status") === "all";
  let q = db().from("bot_signups").select("*").order("id", { ascending: false }).limit(30);
  if (!all) q = q.eq("status", "waiting_approval");
  const rows = must(await q) as any[];
  const phones = Array.from(new Set(rows.map((r) => r.phone)));
  const waiting = phones.length
    ? (must(await db().from("inbox").select("sender_phone").eq("status", "waiting_signup").in("sender_phone", phones)) as { sender_phone: string }[])
    : [];
  const signups = rows.map((r) => ({ ...r, waiting_orders: waiting.filter((w) => w.sender_phone === r.phone).length }));
  return ok({ signups });
}
