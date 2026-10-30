import { B2B_SCHEMA } from "@/lib/b2b";
import { b2bAuth, pgFail, pgJson } from "@/lib/b2bHttp";
import { readTable } from "@/lib/pgrest";

export const dynamic = "force-dynamic";

/**
 * GET /b2b/rest/v1/<table>?select=...&<col>=eq.<v>&order=...&limit=...   (headers apikey + Bearer)
 * Tables: customers, customer_types, products, product_prices, orders, order_items, payment_types, pricing_settings, profiles.
 */
export async function GET(req: Request, { params }: { params: { table: string } }) {
  const auth = await b2bAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const r = await readTable(B2B_SCHEMA, params.table, new URL(req.url), req.headers);
    return pgJson(r.body, 200, { "Content-Range": r.contentRange });
  } catch (e) {
    return pgFail(e);
  }
}

/** Writes go through the RPCs, as in the real order flow; direct table writes are not copied. */
async function notCopied(req: Request) {
  const auth = await b2bAuth(req);
  if ("denied" in auth) return auth.denied;
  return pgJson({ code: "42501", details: null, hint: "The mock copies reads and the order RPCs only.",
    message: "permission denied (direct table writes are not copied in the mock)" }, 403);
}
export const POST = notCopied;
export const PATCH = notCopied;
export const DELETE = notCopied;
