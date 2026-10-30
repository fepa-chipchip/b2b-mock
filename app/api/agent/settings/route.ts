import { getSettings } from "@/lib/db";
import { agentOnly, ok } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/agent/settings: how Simenesh answered the four questions (where orders go, which credit, who places, several companies). */
export async function GET(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  return ok({ settings: await getSettings() });
}
