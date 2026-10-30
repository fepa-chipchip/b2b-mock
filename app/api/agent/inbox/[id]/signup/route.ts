import { db, must } from "@/lib/db";
import { agentOnly, ok, fail } from "@/lib/auth";
import { send, SAY } from "@/lib/tg";
import { Signup, openSignup, saveSignup, askStep } from "@/lib/signup";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/inbox/{id}/signup  { "intro": "..." }   (intro optional)
 * The agent found that this order's sender is not a ChipChip business customer: the bot signs them up. It opens a
 * sign-up for the sender (or reuses the one still open), sets this order to waiting_signup (kept, out of the inbox
 * list, until the sign-up is registered or declined through /api/agent/signups/{id}/status) and sends the intro
 * (default: a short English + Amharic line) followed by the first question still unanswered (business name for a new one).
 * Only from collecting or asked (else 409). Answers { ok, signup_id }.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = agentOnly(req);
  if (denied) return denied;
  const { intro } = (await req.json().catch(() => ({}))) as { intro?: string };
  const inbox = must(await db().from("inbox").select("*").eq("id", Number(params.id)).maybeSingle()) as any;
  if (!inbox) return fail("inbox_not_found", 404);
  if (inbox.status !== "collecting" && inbox.status !== "asked") return fail("not_collecting", 409, { status: inbox.status });

  // Guarded on the status, so two calls at once cannot both start a sign-up for the same order.
  const moved = must(await db().from("inbox").update({ status: "waiting_signup" })
    .eq("id", inbox.id).in("status", ["collecting", "asked"]).select("id")) as any[];
  if (!moved.length) return fail("not_collecting", 409);

  const chat = inbox.telegram_chat_id as number;
  // The person's Telegram account: the one that shared this chat's contact, else the one with this phone. In a private
  // chat the chat id is the person's Telegram id, which is the fallback.
  const contacts = must(await db().from("bot_contacts").select("telegram_id,phone,telegram_name")
    .or(`telegram_id.eq.${chat}${inbox.sender_phone ? `,phone.eq.${inbox.sender_phone}` : ""}`)) as
    { telegram_id: number; phone: string; telegram_name: string | null }[];
  const contact = contacts.find((c) => Number(c.telegram_id) === Number(chat)) || contacts[0] || null;
  const telegramId = contact ? Number(contact.telegram_id) : chat;
  const phone = inbox.sender_phone || contact?.phone || "";
  const telegramName = contact?.telegram_name || inbox.sender_name || null;

  let s = await openSignup(telegramId);
  if (s) {
    await saveSignup(s.id, { phone: phone || s.phone, telegram_chat_id: chat, telegram_name: telegramName || s.telegram_name });
    s = { ...s, phone: phone || s.phone, telegram_chat_id: chat };
  } else {
    s = must(await db().from("bot_signups").insert({ telegram_id: telegramId, telegram_chat_id: chat, phone, telegram_name: telegramName,
      step: "business_name", status: "collecting" }).select("*").single()) as Signup;
  }
  must(await db().from("inbox").update({ agent_note: `Sign-up #${s.id} started.` }).eq("id", inbox.id).select("id"));

  // A sign-up already answered and waiting for Simenesh only gets "we will confirm shortly" again.
  if (s.status === "collecting")
    await send(chat, (intro?.trim() || SAY.signup_start).slice(0, 4000), { reply_markup: { remove_keyboard: true } });
  await askStep(chat, s);
  return ok({ signup_id: s.id });
}
