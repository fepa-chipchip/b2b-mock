import { db, must } from "@/lib/db";
import { agentOnly, ok, fail } from "@/lib/auth";
import { send, SAY } from "@/lib/tg";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/inbox lists an order once its sender has been quiet 90 s. Orders kept during the sign-up get a
 * last_message_at this far back, so they are ready the moment the customer is registered.
 */
const READY_NOW_SECONDS = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/agent/signups/{id}/status
 *   { "status": "registered" | "declined", "note": "...", "tell_customer": "...",
 *     "b2b_customer_id": "<uuid>", "admin_company_id": "<uuid>", "admin_user_id": "<uuid>" }
 * Only from waiting_approval (else 409).
 * registered (admin_company_id and admin_user_id required): the agent created the customer in B2B and the company,
 *   user and link in Admin. The bot now knows this Telegram account by its phone, and the orders it sent while waiting
 *   become ordinary orders for that company, ready in GET /api/agent/inbox at once.
 * declined: Simenesh said no; the orders sent while waiting are marked rejected.
 * tell_customer is sent to the customer; without it the bot sends a short default in English and Amharic.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as {
    status?: string; note?: string; tell_customer?: string;
    b2b_customer_id?: string; admin_company_id?: string; admin_user_id?: string;
  };
  if (b.status !== "registered" && b.status !== "declined") return fail("status must be one of registered, declined");
  for (const k of ["b2b_customer_id", "admin_company_id", "admin_user_id"] as const)
    if (b[k] != null && !UUID.test(String(b[k]))) return fail(`${k} must be a uuid`);
  if (b.status === "registered" && (!b.admin_company_id || !b.admin_user_id))
    return fail("registered needs admin_company_id and admin_user_id");

  const s = must(await db().from("bot_signups").select("*").eq("id", Number(params.id)).maybeSingle()) as any;
  if (!s) return fail("signup_not_found", 404);
  if (s.status !== "waiting_approval") return fail("not_waiting_approval", 409, { status: s.status });

  const now = new Date().toISOString();
  // Guarded on the status, so two calls at once cannot both act.
  const changed = must(await db().from("bot_signups").update({
    status: b.status, agent_note: b.note || s.agent_note, updated_at: now,
    ...(b.status === "registered"
      ? { b2b_customer_id: b.b2b_customer_id ?? s.b2b_customer_id, admin_company_id: b.admin_company_id, admin_user_id: b.admin_user_id }
      : {}),
  }).eq("id", s.id).eq("status", "waiting_approval").select("id")) as any[];
  if (!changed.length) return fail("not_waiting_approval", 409);

  let orders: { id: number }[];
  if (b.status === "registered") {
    must(await db().from("bot_contacts").upsert({ telegram_id: s.telegram_id, phone: s.phone, telegram_name: s.telegram_name, linked_at: now })
      .select("telegram_id"));
    orders = must(await db().from("inbox").update({
      status: "collecting", company_id: b.admin_company_id, admin_user_id: b.admin_user_id,
      last_message_at: new Date(Date.now() - READY_NOW_SECONDS * 1000).toISOString(),
      agent_note: `Sign-up #${s.id} registered.`,
    }).eq("sender_phone", s.phone).eq("status", "waiting_signup").select("id")) as { id: number }[];
  } else {
    orders = must(await db().from("inbox").update({ status: "rejected", agent_note: `Sign-up #${s.id} declined.` })
      .eq("sender_phone", s.phone).eq("status", "waiting_signup").select("id")) as { id: number }[];
  }

  const text = b.tell_customer?.trim()
    || (b.status === "registered" ? SAY.registered(s.business_name || "your business", orders.length > 0) : SAY.signup_declined);
  const sent = await send(s.telegram_chat_id, text.slice(0, 4000), { reply_markup: { remove_keyboard: true } });
  return ok({ status: b.status, orders: orders.map((o) => o.id), told_customer: !!sent.ok });
}
