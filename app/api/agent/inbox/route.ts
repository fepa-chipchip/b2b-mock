import { db, must, BUCKET } from "@/lib/db";
import { agentOnly, ok } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** An order is ready once its sender has been quiet this long (they often send a list, then a photo, then a note). */
const QUIET_SECONDS = 90;

/**
 * GET /api/agent/inbox            orders customers sent that are ready to prepare (read-only)
 * GET /api/agent/inbox?status=all the latest 30 in any state
 * Each comes with its messages; a photo or file has a link valid for one hour (`file_url`) the agent can read.
 */
export async function GET(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const all = new URL(req.url).searchParams.get("status") === "all";
  let q = db().from("inbox").select("*, staff(name,phone), companies(id,name)").order("id", { ascending: false }).limit(30);
  if (!all) q = q.eq("status", "collecting").not("company_id", "is", null)
    .lte("last_message_at", new Date(Date.now() - QUIET_SECONDS * 1000).toISOString());
  const rows = must(await q) as any[];
  const out = [];
  for (const r of rows) {
    const msgs = must(await db().from("inbox_messages").select("*").eq("inbox_id", r.id).order("id")) as any[];
    const messages = [];
    for (const m of msgs) {
      let file_url: string | null = null;
      if (m.file_path) {
        const s = await db().storage.from(BUCKET).createSignedUrl(m.file_path, 3600);
        file_url = s.data?.signedUrl || null;
      }
      messages.push({ kind: m.kind, text: m.text, file_name: m.file_name, file_url, at: m.created_at });
    }
    out.push({ inbox_id: r.id, status: r.status, sent_by: r.staff?.name || r.sender_name, company: r.companies,
      received_at: r.created_at, last_message_at: r.last_message_at, note: r.agent_note, messages });
  }
  return ok({ orders: out, ready_after_quiet_seconds: QUIET_SECONDS });
}
