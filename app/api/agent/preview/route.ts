import { agentOnly, ok, fail } from "@/lib/auth";
import { placeOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/preview?company_id=1&location_id=2&delivery_date=2026-11-02&items=2:30,3:10&notes=...
 * The order priced and checked the way the settings say, without creating anything (read-only).
 * items = product_id:quantity pairs, comma separated. Use it to build the card Simenesh approves.
 */
export async function GET(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  const items = (p.get("items") || "").split(",").filter(Boolean).map((pair) => {
    const [id, qty] = pair.split(":");
    return { product_id: Number(id), quantity: Number(qty) };
  });
  const r = await placeOrder({
    company_id: Number(p.get("company_id")), location_id: p.get("location_id") ? Number(p.get("location_id")) : null,
    delivery_date: p.get("delivery_date") || "", notes: p.get("notes") || "", items, dry_run: true,
  });
  return r.status === 200 ? ok(r.body) : fail((r.body as any).error, r.status, r.body);
}
