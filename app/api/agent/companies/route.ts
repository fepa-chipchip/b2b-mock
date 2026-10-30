import { db, must } from "@/lib/db";
import { agentOnly, ok } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/agent/companies: every business customer with its locations. */
export async function GET(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const rows = must(await db().from("companies").select("id,name,customer_type,credit_limit,payment_terms_days,locations(id,label)").order("name"));
  return ok({ companies: rows });
}
