import { NextResponse } from "next/server";
import { B2B_SCHEMA } from "@/lib/b2b";
import { b2bAuth, pgFail, pgJson } from "@/lib/b2bHttp";
import { insertRows, readTable } from "@/lib/pgrest";

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

/**
 * POST /b2b/rest/v1/customers: insert a customer, as the real Add Customer form and Telegram sign-up do
 * (supabase-js `.from('customers').insert([...]).select().single()`). Body: object or array.
 * `Prefer: return=representation` -> 201 with the rows (an object with `Accept: application/vnd.pgrst.object+json`);
 * otherwise 201 with no body. Every other table keeps the 403 below.
 */
export async function POST(req: Request, { params }: { params: { table: string } }) {
  if (params.table !== "customers") return notCopied(req);
  const auth = await b2bAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const r = await insertRows(B2B_SCHEMA, params.table, new URL(req.url), req.headers, await req.text());
    if (r.body === null) return new NextResponse(null, { status: 201, headers: { "Content-Range": r.contentRange } });
    return pgJson(r.body, 201, { "Content-Range": r.contentRange });
  } catch (e) {
    return pgFail(e);
  }
}

/** Other writes go through the RPCs, as in the real order flow; direct table writes are not copied. */
async function notCopied(req: Request) {
  const auth = await b2bAuth(req);
  if ("denied" in auth) return auth.denied;
  return pgJson({ code: "42501", details: null, hint: "The mock copies reads, the order RPCs and inserts into customers only.",
    message: "permission denied (direct table writes are not copied in the mock)" }, 403);
}
export const PATCH = notCopied;
export const DELETE = notCopied;
