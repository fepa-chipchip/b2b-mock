import { db, must, getSettings } from "@/lib/db";
import { agentOnly, ok, fail } from "@/lib/auth";
import { creditCheck, Company } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** GET /api/agent/companies/{id}: the company, its delivery locations, its people and its credit in both systems. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const c = must(await db().from("companies").select("*").eq("id", Number(params.id)).maybeSingle()) as Company | null;
  if (!c) return fail("company_not_found", 404);
  const locations = must(await db().from("locations").select("id,label").eq("company_id", c.id));
  const people = must(await db().from("staff_companies").select("staff(name)").eq("company_id", c.id)) as any[];
  return ok({ company: c, locations, people: people.map((p) => p.staff?.name), credit: creditCheck(c, 0, await getSettings()) });
}
