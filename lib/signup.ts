import { db, must } from "@/lib/db";
import { send, SAY } from "@/lib/tg";
import { notifyZeami, signupCompletedEvent, zeamiOn } from "@/lib/zeami";

/* ---------- New-customer sign-up (shared by the order bot and the agent API) ----------
 * The order agent decides a sender is not a customer yet and starts a sign-up (POST /api/agent/inbox/{id}/signup).
 * The person then answers four questions, one at a time (business name, business type, TIN, delivery place), into one
 * bot_signups row. Then it waits for Simenesh (status waiting_approval).
 */

export type Signup = {
  id: number; telegram_id: number; telegram_chat_id: number; phone: string; telegram_name: string | null;
  step: string; business_name: string | null; business_type: string | null; tin: string | null; address: string | null;
  status: string;
};

/** The person's sign-up still in progress (answering, or answered and waiting for Simenesh), if any. */
export async function openSignup(telegramId: number): Promise<Signup | null> {
  return must(await db().from("bot_signups").select("*").eq("telegram_id", telegramId).in("status", ["collecting", "waiting_approval"])
    .order("id", { ascending: false }).limit(1).maybeSingle()) as Signup | null;
}

export async function saveSignup(id: number, fields: Partial<Signup> & { latitude?: number | null; longitude?: number | null }) {
  must(await db().from("bot_signups").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select("id"));
}

/**
 * The sign-up just moved from collecting to waiting_approval (its last answer is in): tells Zeami, so the agent asks
 * Simenesh now rather than on its next look (`signup_completed`, lib/zeami.ts). The order kept for it is the sender's
 * latest waiting_signup row (POST /api/agent/inbox/{id}/signup set it), sent as inbox_id when there is one.
 * Call it after the bot's own reply to the customer. Never throws; ZEAMI_HOOK_URL unset: does nothing.
 */
export async function notifySignupCompleted(s: Signup) {
  if (!zeamiOn()) return;
  let inboxId: number | null = null;
  try {
    const row = must(await db().from("inbox").select("id").eq("telegram_chat_id", s.telegram_chat_id).eq("status", "waiting_signup")
      .order("id", { ascending: false }).limit(1).maybeSingle()) as { id: number } | null;
    inboxId = row?.id ?? null;
  } catch (e) {
    console.log("sign-up order lookup failed", (e as Error).message);
  }
  await notifyZeami(signupCompletedEvent(s.id, inboxId));
}

/** Asks the sign-up's current question (or, once all are answered, says it is waiting for Simenesh). */
export async function askStep(chat: number, s: Signup) {
  if (s.status !== "collecting") return send(chat, SAY.signup_done, { reply_markup: { remove_keyboard: true } });
  switch (s.step) {
    case "business_name":
      return send(chat, SAY.ask_business_name, { reply_markup: { remove_keyboard: true } });
    case "business_type":
      // "Other" pressed: they now say it in their own words.
      if (s.business_type === "Other") return send(chat, SAY.ask_type_other);
      return send(chat, SAY.ask_business_type, {
        reply_markup: { inline_keyboard: SAY.business_types.map((t) => [{ text: t.label, callback_data: `st:${s.id}:${t.value}` }]) },
      });
    case "tin":
      return send(chat, SAY.ask_tin, { reply_markup: { inline_keyboard: [[{ text: SAY.no_tin_button, callback_data: `nt:${s.id}` }]] } });
    default:
      return send(chat, SAY.ask_location, {
        reply_markup: { keyboard: [[{ text: SAY.location_button, request_location: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
  }
}
