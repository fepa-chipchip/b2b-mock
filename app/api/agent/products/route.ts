import { db, must } from "@/lib/db";
import { agentOnly, ok } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/products?q=tomato   products whose name or other names contain q (English or Amharic); no q = all.
 * B2B price and Admin deal price, unit and minimum quantity per product.
 */
export async function GET(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const q = (new URL(req.url).searchParams.get("q") || "").trim().replace(/[%,()]/g, " ");
  let query = db().from("products").select("id,name,other_names,unit,b2b_price,admin_price,min_qty").eq("active", true).order("name");
  if (q) query = query.or(`name.ilike.%${q}%,other_names.ilike.%${q}%`);
  return ok({ products: must(await query) });
}
