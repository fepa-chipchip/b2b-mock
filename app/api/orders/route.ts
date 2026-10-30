import { db, must } from "@/lib/db";
import { agentOnly, ok, fail } from "@/lib/auth";
import { placeOrder, OrderInput } from "@/lib/orders";
import { send, SAY } from "@/lib/tg";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders   creates the order (after Simenesh's yes). Body:
 * { inbox_id, company_id, location_id, delivery_date: "YYYY-MM-DD", notes, items: [{product_id, quantity}] }
 * Created in B2B, Admin or both as the settings say; refused with 409 credit_refused when credit does not allow it.
 * Sending the same inbox_id twice returns the first order (already_created) and creates nothing.
 * The customer gets the confirmation from the order bot.
 */
export async function POST(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as OrderInput | null;
  if (!body) return fail("body must be JSON");
  const r = await placeOrder({ ...body, dry_run: false });
  if (r.status !== 201) return r.status === 200 ? ok(r.body) : fail((r.body as any).error, r.status, r.body);

  const b = r.body as any;
  if (body.inbox_id) {
    const inbox = must(await db().from("inbox").select("telegram_chat_id").eq("id", body.inbox_id).maybeSingle()) as any;
    if (inbox) await send(inbox.telegram_chat_id, SAY.created(b.order_id, String(b.preview.total), body.delivery_date));
  }
  return ok(b, 201);
}
