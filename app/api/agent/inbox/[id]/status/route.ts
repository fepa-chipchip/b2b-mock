import { db, must } from "@/lib/db";
import { agentOnly, ok, fail } from "@/lib/auth";
import { send } from "@/lib/tg";

export const dynamic = "force-dynamic";

const ALLOWED = ["proposed", "rejected", "collecting", "asked"];

/**
 * POST /api/agent/inbox/{id}/status  { "status": "proposed" | "rejected" | "collecting", "note": "...", "tell_customer": "..." }
 * proposed: the card is with Simenesh (so the next run does not prepare it again);
 * rejected: Simenesh said no; tell_customer, when given, is sent to the customer by the order bot.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { status?: string; note?: string; tell_customer?: string };
  if (!b.status || !ALLOWED.includes(b.status)) return fail(`status must be one of ${ALLOWED.join(", ")}`);
  const inbox = must(await db().from("inbox").select("*").eq("id", Number(params.id)).maybeSingle()) as any;
  if (!inbox) return fail("inbox_not_found", 404);
  if (inbox.status === "created") return fail("already_created", 409);
  must(await db().from("inbox").update({ status: b.status, agent_note: b.note || inbox.agent_note }).eq("id", inbox.id).select("id"));
  if (b.tell_customer?.trim()) await send(inbox.telegram_chat_id, b.tell_customer.slice(0, 4000));
  return ok({ status: b.status });
}
