import { NextResponse } from "next/server";
import { db, must, getSettings, normPhone, BUCKET } from "@/lib/db";
import { send, tg, download, SAY } from "@/lib/tg";

export const dynamic = "force-dynamic";

/** Messages a customer sends within this many minutes of the previous one belong to the same order. */
const SAME_ORDER_MINUTES = 10;

type Staff = { id: number; name: string; telegram_id: number | null; usual_company_id: number | null };

const askPhone = (chat: number, text: string) =>
  send(chat, text, {
    reply_markup: { keyboard: [[{ text: SAY.share_button, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  });

async function companiesOf(staffId: number) {
  const links = must(await db().from("staff_companies").select("company_id, companies(id,name)").eq("staff_id", staffId)) as any[];
  return links.map((l) => l.companies as { id: number; name: string });
}

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
  if (m.text && m.text.startsWith("/start")) return askPhone(chat, SAY.welcome);

  if (m.contact) {
    if (m.contact.user_id && m.contact.user_id !== m.from.id) return askPhone(chat, SAY.need_phone);
    const phone = normPhone(m.contact.phone_number);
    const staff = must(await db().from("staff").select("*").eq("phone", phone).maybeSingle()) as Staff | null;
    if (!staff) {
      must(await db().from("inbox").insert({ telegram_chat_id: chat, sender_name: senderName(m), status: "unknown_sender",
        agent_note: `Shared phone ${phone}; not a known business customer.` }).select("id"));
      return send(chat, SAY.unknown_phone, { reply_markup: { remove_keyboard: true } });
    }
    must(await db().from("staff").update({ telegram_id: m.from.id, telegram_name: senderName(m) }).eq("id", staff.id).select("id"));
    const cos = await companiesOf(staff.id);
    return send(chat, SAY.linked(cos.map((c) => c.name).join(", ") || "-"), { reply_markup: { remove_keyboard: true } });
  }

  const staff = must(await db().from("staff").select("*").eq("telegram_id", m.from.id).maybeSingle()) as Staff | null;
  if (!staff) return askPhone(chat, SAY.need_phone);

  // The order this message belongs to: the sender's open one if recent, one we asked them about today
  // (this is their answer), else a new one.
  const since = new Date(Date.now() - SAME_ORDER_MINUTES * 60_000).toISOString();
  const today = new Date(Date.now() - 24 * 3600_000).toISOString();
  let inbox = must(await db().from("inbox").select("*").eq("telegram_chat_id", chat)
    .or(`and(status.in.(collecting,waiting_company),last_message_at.gte.${since}),and(status.eq.asked,last_message_at.gte.${today})`)
    .order("id", { ascending: false }).limit(1).maybeSingle()) as any;
  const isNew = !inbox;
  if (inbox?.status === "asked")
    must(await db().from("inbox").update({ status: "collecting" }).eq("id", inbox.id).select("id"));
  if (isNew) {
    const cos = await companiesOf(staff.id);
    const s = await getSettings();
    let company_id: number | null = null;
    let status = "collecting";
    if (cos.length === 1) company_id = cos[0].id;
    else if (cos.length > 1 && s.q4_several === "usual" && staff.usual_company_id) company_id = staff.usual_company_id;
    else if (cos.length > 1) status = "waiting_company";
    inbox = must(await db().from("inbox").insert({ telegram_chat_id: chat, staff_id: staff.id, sender_name: staff.name,
      company_id, status }).select("*").single());
    if (status === "waiting_company")
      await send(chat, SAY.which_company, { reply_markup: { inline_keyboard: cos.map((c) => [{ text: c.name, callback_data: `co:${inbox.id}:${c.id}` }]) } });
  }

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

async function onButton(q: any) {
  const [tag, inboxId, companyId] = String(q.data || "").split(":");
  if (tag !== "co") return tg("answerCallbackQuery", { callback_query_id: q.id });
  const co = must(await db().from("companies").select("name").eq("id", Number(companyId)).maybeSingle()) as { name: string } | null;
  must(await db().from("inbox").update({ company_id: Number(companyId), status: "collecting", last_message_at: new Date().toISOString() })
    .eq("id", Number(inboxId)).eq("status", "waiting_company").select("id"));
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: co?.name || "" });
  if (q.message) await tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: SAY.company_set(co?.name || "") });
}

const senderName = (m: any) => [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "";
const contentType = (ext: string) =>
  ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
     xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv" } as Record<string, string>)[ext]
  || "application/octet-stream";
