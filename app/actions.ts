"use server";
import { revalidatePath } from "next/cache";
import { db, must, normPhone } from "@/lib/db";

/** ✅ / ❌ and a comment from Simenesh, on an order, a question or the whole test. */
export async function giveFeedback(form: FormData) {
  const about = String(form.get("about") || "general");
  const okRaw = String(form.get("ok") || "");
  const comment = String(form.get("comment") || "").trim();
  if (!okRaw && !comment) return;
  must(await db().from("feedback").insert({ about, ok: okRaw === "" ? null : okRaw === "yes", comment }).select("id"));
  revalidatePath("/", "layout");
}

/** One of the four questions answered (and optionally commented). */
export async function saveAnswer(form: FormData) {
  const key = String(form.get("key"));
  const value = String(form.get("value") || "");
  const comment = String(form.get("comment") || "").trim();
  if (!["q1_where", "q2_credit", "q3_placed_as", "q4_several"].includes(key) || !value) return;
  must(await db().from("settings").update({ value, comment: comment || null, answered_by: "Simenesh", updated_at: new Date().toISOString() })
    .eq("key", key).select("key"));
  revalidatePath("/", "layout");
}

/** A test person who may order for one or more companies (their phone links their Telegram the first time). */
export async function addPerson(form: FormData) {
  const name = String(form.get("name") || "").trim();
  const phone = normPhone(String(form.get("phone") || ""));
  const companies = form.getAll("company").map(Number).filter(Boolean);
  if (!name || phone.length < 12 || companies.length === 0) return;
  const staff = must(await db().from("staff").upsert({ name, phone, usual_company_id: companies[0] }, { onConflict: "phone" })
    .select("id").single()) as { id: number };
  must(await db().from("staff_companies").delete().eq("staff_id", staff.id).select("staff_id"));
  must(await db().from("staff_companies").insert(companies.map((company_id) => ({ staff_id: staff.id, company_id }))).select("staff_id"));
  revalidatePath("/customers");
}

/** Points the order bot at this site (run once after deploy, and after the bot token changes). */
export async function connectBot(form: FormData) {
  const host = String(form.get("host") || "");
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://${host}/api/telegram`, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"] }),
  });
  const j = await r.json().catch(() => ({}));
  must(await db().from("feedback").insert({ about: "setup", ok: !!j.ok, comment: `setWebhook: ${j.description || r.status}` }).select("id"));
  revalidatePath("/customers");
}
