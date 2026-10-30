import { db, must, BUCKET } from "@/lib/db";
import { agentOnly, ok } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** An order is ready once its sender has been quiet this long (they often send a list, then a photo, then a note). */
const QUIET_SECONDS = 90;

/**
 * GET /api/agent/inbox            orders customers sent that are ready to prepare (read-only)
 * GET /api/agent/inbox?status=all the latest 30 in any state
 * Each comes with its messages; a photo or file has a link valid for one hour (`file_url`) the agent can read.
 * The bot knows only the sender's phone and Telegram name: `sender {name, phone, telegram_name}`. Who they are in
 * ChipChip Admin, and which company the order is for, is the agent's to find out (Admin: /system/users/<phone>);
 * it records them with POST /api/agent/inbox/{id}/status `{company_id, admin_user_id}` (null until then).
 * Not a customer yet: POST /api/agent/inbox/{id}/signup.
 */
export async function GET(req: Request) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const all = new URL(req.url).searchParams.get("status") === "all";
  // waiting_signup: kept while the sender's sign-up waits for Simenesh; see /api/agent/signups.
  let q = db().from("inbox").select("*").neq("status", "waiting_signup").order("id", { ascending: false }).limit(30);
  if (!all) q = q.eq("status", "collecting").lte("last_message_at", new Date(Date.now() - QUIET_SECONDS * 1000).toISOString());
  const rows = must(await q) as any[];
  const phones = Array.from(new Set(rows.map((r) => r.sender_phone).filter(Boolean)));
  const contacts = phones.length
    ? (must(await db().from("bot_contacts").select("phone,telegram_name,linked_at").in("phone", phones)
        .order("linked_at", { ascending: false })) as { phone: string; telegram_name: string | null }[])
    : [];
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
    out.push({
      inbox_id: r.id, status: r.status,
      sender: { name: r.sender_name, phone: r.sender_phone,
        telegram_name: contacts.find((c) => c.phone === r.sender_phone)?.telegram_name ?? null },
      company_id: r.company_id, admin_user_id: r.admin_user_id,
      received_at: r.created_at, last_message_at: r.last_message_at, note: r.agent_note,
      b2b_order_number: r.b2b_order_number, admin_bill_id: r.admin_bill_id, messages,
    });
  }
  return ok({ orders: out, ready_after_quiet_seconds: QUIET_SECONDS });
}
