import { NextResponse } from "next/server";
import { db, must, normPhone, BUCKET } from "@/lib/db";
import { send, tg, download, SAY } from "@/lib/tg";
import { Signup, openSignup, saveSignup, askStep } from "@/lib/signup";

export const dynamic = "force-dynamic";

/** Messages a customer sends within this many minutes of the previous one belong to the same order. */
const SAME_ORDER_MINUTES = 10;

/**
 * The order bot plays Simenesh's personal Telegram, nothing more: it learns a person's phone number, groups what they
 * send into one inbox row per order, and asks the sign-up questions once the order agent has started a sign-up for them.
 * It never looks up ChipChip Admin. Who the sender is, which company the order is for and whether to sign them up is
 * the order agent's call (in Zeami, with its own access to Admin and B2B), through /api/agent/*.
 */

const askPhone = (chat: number, text: string) =>
  send(chat, text, {
    reply_markup: { keyboard: [[{ text: SAY.share_button, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  });

export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET)
    return NextResponse.json({ ok: false }, { status: 401 });
  const update = await req.json();
  try {
    if (update.callback_query) await onButton(update.callback_query);
    else if (update.message && update.message.chat?.type === "private") await onMessage(update.message);
  } catch (e) {
    console.log("telegram update failed", (e as Error).message);
  }
  return NextResponse.json({ ok: true });  // always 200, or Telegram re-sends the same update
}

async function onMessage(m: any) {
  const chat = m.chat.id as number;
  if (m.text && m.text.startsWith("/start")) {
    // A sign-up in progress picks up where it stopped: the question they have not answered yet.
    const open = await openSignup(m.from.id);
    if (open) return askStep(chat, open);
    return askPhone(chat, SAY.welcome);
  }

  if (m.contact) {
    // Only their own contact: the phone number is how the agent finds them in Admin.
    if (m.contact.user_id && m.contact.user_id !== m.from.id) return askPhone(chat, SAY.need_phone);
    const phone = normPhone(m.contact.phone_number);
    must(await db().from("bot_contacts").upsert({ telegram_id: m.from.id, phone, telegram_name: senderName(m), linked_at: new Date().toISOString() })
      .select("telegram_id"));
    const open = await openSignup(m.from.id);
    if (open?.status === "collecting") {
      await saveSignup(open.id, { phone, telegram_chat_id: chat });
      await send(chat, SAY.thanks, { reply_markup: { remove_keyboard: true } });
      return askStep(chat, { ...open, telegram_chat_id: chat, phone });
    }
    return send(chat, SAY.thanks, { reply_markup: { remove_keyboard: true } });
  }

  // A sign-up the agent started takes the message: as an answer while collecting, as an order once answered.
  const open = await openSignup(m.from.id);
  if (open?.status === "collecting") return onSignupAnswer(chat, m, open);
  if (open?.status === "waiting_approval") return onSignupOrder(chat, m, open);

  const contact = must(await db().from("bot_contacts").select("*").eq("telegram_id", m.from.id).maybeSingle()) as
    { phone: string; telegram_name: string | null } | null;
  if (!contact) return askPhone(chat, SAY.need_phone);

  // The order this message belongs to: the sender's open one if recent, one we asked them about today
  // (this is their answer), else a new one. The company stays unknown until the agent sets it.
  const since = new Date(Date.now() - SAME_ORDER_MINUTES * 60_000).toISOString();
  const today = new Date(Date.now() - 24 * 3600_000).toISOString();
  let inbox = must(await db().from("inbox").select("*").eq("telegram_chat_id", chat)
    .or(`and(status.eq.collecting,last_message_at.gte.${since}),and(status.eq.asked,last_message_at.gte.${today})`)
    .order("id", { ascending: false }).limit(1).maybeSingle()) as any;
  const isNew = !inbox;
  if (inbox?.status === "asked")
    must(await db().from("inbox").update({ status: "collecting" }).eq("id", inbox.id).select("id"));
  if (isNew)
    inbox = must(await db().from("inbox").insert({ telegram_chat_id: chat, sender_phone: contact.phone,
      sender_name: senderName(m) || contact.telegram_name, status: "collecting" }).select("*").single());

  await saveMessage(inbox.id, m);
  must(await db().from("inbox").update({ last_message_at: new Date().toISOString() }).eq("id", inbox.id).select("id"));
  if (isNew) await send(chat, SAY.received);
}

async function saveMessage(inboxId: number, m: any) {
  const text = m.text || m.caption || null;
  let kind = "text", file_id: string | null = null, file_name: string | null = null;
  if (m.photo?.length) { kind = "photo"; file_id = m.photo[m.photo.length - 1].file_id; file_name = "photo.jpg"; }
  else if (m.document) { kind = "document"; file_id = m.document.file_id; file_name = m.document.file_name || "file"; }
  else if (!text) return;  // stickers, voice and the like are not an order

  let file_path: string | null = null;
  if (file_id) {
    const f = await download(file_id);
    if (f) {
      const ext = (f.path.split(".").pop() || "bin").toLowerCase();
      file_path = `${inboxId}/${m.message_id}.${ext}`;
      const up = await db().storage.from(BUCKET).upload(file_path, f.bytes, { upsert: true, contentType: contentType(ext) });
      if (up.error) { console.log("upload failed", up.error.message); file_path = null; }
    }
  }
  must(await db().from("inbox_messages").insert({ inbox_id: inboxId, kind, text, file_path, file_name }).select("id"));
}

/** Only the sign-up buttons remain; the agent settles the company in free text through /reply. */
async function onButton(q: any) {
  const [tag, id, value] = String(q.data || "").split(":");
  if (tag === "st" || tag === "nt") return onSignupButton(q, tag, Number(id), value);
  return tg("answerCallbackQuery", { callback_query_id: q.id });
}

/* ---------- New-customer sign-up ----------
 * Started by the agent (POST /api/agent/inbox/{id}/signup, see lib/signup.ts). Answers are free-form: whatever they
 * write is stored as they wrote it. What they send while it waits for Simenesh is kept as an order on an inbox row with
 * status waiting_signup, which the agent API moves to collecting once the customer is registered.
 */

/** A message while the sign-up is collecting: the answer to the current question. Anything without words re-asks. */
async function onSignupAnswer(chat: number, m: any, s: Signup) {
  const text = String(m.text || "").trim();
  let next: Partial<Signup> & { latitude?: number | null; longitude?: number | null };
  if (s.step === "business_name") {
    if (!text) return askStep(chat, s);
    next = { business_name: text, step: "business_type" };
  } else if (s.step === "business_type") {
    if (!text) return askStep(chat, s);
    next = { business_type: text, step: "tin" };
  } else if (s.step === "tin") {
    if (!text) return askStep(chat, s);
    next = { tin: text, step: "location" };
  } else {
    if (m.venue) {
      next = { address: [m.venue.title, m.venue.address].filter(Boolean).join(", ") || null,
        latitude: m.venue.location?.latitude ?? null, longitude: m.venue.location?.longitude ?? null };
    } else if (m.location) {
      next = { latitude: m.location.latitude, longitude: m.location.longitude };
    } else if (text) {
      next = { address: text };
    } else return askStep(chat, s);
    next = { ...next, step: "done", status: "waiting_approval" };
  }
  await saveSignup(s.id, next);
  return askStep(chat, { ...s, ...next } as Signup);
}

/** The business-type and "No TIN yet" buttons. Only the sign-up's own person, and only at that step. */
async function onSignupButton(q: any, tag: string, id: number, value: string | undefined) {
  const s = must(await db().from("bot_signups").select("*").eq("id", id).maybeSingle()) as Signup | null;
  const chat = q.message?.chat?.id as number | undefined;
  const fits = s && chat && s.telegram_id === q.from?.id && s.status === "collecting" &&
    (tag === "st" ? s.step === "business_type" && SAY.business_types.some((t) => t.value === value) : s.step === "tin");
  if (!fits) return tg("answerCallbackQuery", { callback_query_id: q.id });
  const label = tag === "st" ? SAY.business_types.find((t) => t.value === value)!.label : SAY.no_tin_button;
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: label });
  await tg("editMessageText", { chat_id: chat, message_id: q.message.message_id, text: SAY.company_set(label) });
  // "Other" keeps the step: their own words come next and replace it.
  const next: Partial<Signup> = tag === "nt" ? { tin: null, step: "location" }
    : value === "Other" ? { business_type: "Other" } : { business_type: value, step: "tin" };
  await saveSignup(s.id, next);
  return askStep(chat, { ...s, ...next });
}

/** A message while the sign-up waits for Simenesh: kept as an order (status waiting_signup) for when they are registered. */
async function onSignupOrder(chat: number, m: any, s: Signup) {
  const since = new Date(Date.now() - SAME_ORDER_MINUTES * 60_000).toISOString();
  let inbox = must(await db().from("inbox").select("id").eq("telegram_chat_id", chat).eq("status", "waiting_signup")
    .gte("last_message_at", since).order("id", { ascending: false }).limit(1).maybeSingle()) as { id: number } | null;
  const isNew = !inbox;
  if (!inbox)
    inbox = must(await db().from("inbox").insert({ telegram_chat_id: chat, sender_phone: s.phone, sender_name: s.telegram_name,
      status: "waiting_signup", agent_note: `Sign-up #${s.id} (${s.business_name || "?"}) waiting for approval.` })
      .select("id").single()) as { id: number };
  await saveMessage(inbox.id, m);
  must(await db().from("inbox").update({ last_message_at: new Date().toISOString() }).eq("id", inbox.id).select("id"));
  if (isNew) await send(chat, SAY.received);
}

const senderName = (m: any) => [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "";
const contentType = (ext: string) =>
  ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
     xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv" } as Record<string, string>)[ext]
  || "application/octet-stream";
