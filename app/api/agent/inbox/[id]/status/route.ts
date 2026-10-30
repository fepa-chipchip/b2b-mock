import { db, must } from "@/lib/db";
import { agentOnly, ok, fail } from "@/lib/auth";
import { send } from "@/lib/tg";

export const dynamic = "force-dynamic";

const ALLOWED = ["proposed", "rejected", "collecting", "asked", "created"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/agent/inbox/{id}/status
 *   { "status": "proposed" | "rejected" | "collecting" | "asked" | "created", "note": "...", "tell_customer": "...",
 *     "b2b_order_number": "ORD-...", "admin_bill_id": "<uuid>", "company_id": "<uuid>", "admin_user_id": "<uuid>" }
 * proposed: the card is with Simenesh (so the next run does not prepare it again);
 * rejected: Simenesh said no;
 * created: the agent placed the order in B2B and/or Admin (through their own APIs) and records the references here.
 * company_id / admin_user_id: the Admin company the order is for and the sender as an Admin user, as the agent found
 * them (the bot never looks them up). `status` may be left out when only these are recorded; the status then stays.
 * tell_customer, when given, is sent to the customer by the order bot (e.g. the confirmation).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as {
    status?: string; note?: string; tell_customer?: string; b2b_order_number?: string; admin_bill_id?: string;
    company_id?: string; admin_user_id?: string;
  };
  const onlyIds = !b.status && (b.company_id != null || b.admin_user_id != null);
  if (!onlyIds && (!b.status || !ALLOWED.includes(b.status))) return fail(`status must be one of ${ALLOWED.join(", ")}`);
  for (const k of ["company_id", "admin_user_id"] as const)
    if (b[k] != null && !UUID.test(String(b[k]))) return fail(`${k} must be a uuid`);
  const inbox = must(await db().from("inbox").select("*").eq("id", Number(params.id)).maybeSingle()) as any;
  if (!inbox) return fail("inbox_not_found", 404);
  if (inbox.status === "created") return fail("already_created", 409, { b2b_order_number: inbox.b2b_order_number, admin_bill_id: inbox.admin_bill_id });
  const status = b.status || inbox.status;
  must(await db().from("inbox").update({
    status, agent_note: b.note || inbox.agent_note,
    b2b_order_number: b.b2b_order_number ?? inbox.b2b_order_number, admin_bill_id: b.admin_bill_id ?? inbox.admin_bill_id,
    company_id: b.company_id ?? inbox.company_id, admin_user_id: b.admin_user_id ?? inbox.admin_user_id,
  }).eq("id", inbox.id).select("id"));
  if (b.tell_customer?.trim()) await send(inbox.telegram_chat_id, b.tell_customer.slice(0, 4000));
  return ok({ status, company_id: b.company_id ?? inbox.company_id, admin_user_id: b.admin_user_id ?? inbox.admin_user_id });
}
