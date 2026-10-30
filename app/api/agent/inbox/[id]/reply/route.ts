import { db, must } from "@/lib/db";
import { agentOnly, ok, fail } from "@/lib/auth";
import { send } from "@/lib/tg";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/inbox/{id}/reply  { "text": "..." }
 * The order bot sends this to the customer who sent the order (a question about a line, the order to confirm...).
 * Marks the order "asked": it leaves the ready list until the customer answers, and their answer joins it.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || !text.trim()) return fail("text is empty");
  const inbox = must(await db().from("inbox").select("*").eq("id", Number(params.id)).maybeSingle()) as any;
  if (!inbox) return fail("inbox_not_found", 404);
  const sent = await send(inbox.telegram_chat_id, text.slice(0, 4000));
  if (!sent.ok) return fail("telegram_refused", 502, { detail: sent.description });
  must(await db().from("inbox").update({ status: "asked", last_message_at: new Date().toISOString(),
    agent_note: `Asked: ${text.slice(0, 300)}` }).eq("id", inbox.id).select("id"));
  return ok({ sent: true });
}
