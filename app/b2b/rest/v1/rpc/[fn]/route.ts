import { RPCS } from "@/lib/b2b";
import { b2bAuth, pgFail, pgJson } from "@/lib/b2bHttp";
import { pgError } from "@/lib/pgrest";

export const dynamic = "force-dynamic";

/**
 * POST /b2b/rest/v1/rpc/<fn>   body = the named parameters   (headers apikey + Bearer)
 *   check_customer_credit_status {customer_uuid}
 *   create_order_with_items      {p_customer_id, p_subtotal, ..., p_items, p_warehouse_id}
 *   get_orders_page              {p_page, p_page_size, p_search, p_status, p_payment_status}
 */
export async function POST(req: Request, { params }: { params: { fn: string } }) {
  const auth = await b2bAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const fn = RPCS[params.fn];
    const args = (await req.json().catch(() => ({}))) ?? {};
    if (!fn) {
      throw pgError(404, "PGRST202", `Could not find the function public.${params.fn}(${Object.keys(args).sort().join(", ")}) in the schema cache`);
    }
    return pgJson(await fn(args));
  } catch (e) {
    return pgFail(e);
  }
}
