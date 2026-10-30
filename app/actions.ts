"use server";
import { randomUUID } from "crypto";
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

/**
 * Mock-only: a tester with their real Telegram phone becomes a user of the fake Admin, linked to one company
 * (in reality the person registers in the ChipChip app and is linked on the company page). Also gives them a saved
 * delivery location copied from Simenesh's location for that company, so Place Order works as them.
 */
export async function addTester(form: FormData) {
  const name = String(form.get("name") || "").trim();
  const phone = normPhone(String(form.get("phone") || ""));
  const companyId = String(form.get("company") || "");
  if (!name || phone.length < 12 || !companyId) return;
  const existing = must(await db().from("adm_users").select("id").eq("phone", phone).maybeSingle()) as { id: string } | null;
  const userId = existing?.id ?? randomUUID();
  if (!existing) must(await db().from("adm_users").insert({ id: userId, name, phone }).select("id"));
  must(await db().from("adm_b2b_customer_users").upsert({ b2b_customer_id: companyId, user_id: userId, role: "MEMBER" },
    { onConflict: "b2b_customer_id,user_id" }).select("id"));
  const company = must(await db().from("adm_b2b_customers").select("phone").eq("id", companyId).single()) as { phone: string };
  const simenesh = must(await db().from("adm_users").select("id").eq("phone", "251900000009").maybeSingle()) as { id: string } | null;
  if (simenesh) {
    const locs = must(await db().from("adm_locations").select("name,location_title,contact_phone").eq("user_id", simenesh.id)
      .eq("contact_phone", company.phone)) as any[];
    const mine = must(await db().from("adm_locations").select("name").eq("user_id", userId)) as { name: string }[];
    const add = locs.filter((l) => !mine.some((m) => m.name === l.name)).map((l) => ({ ...l, user_id: userId }));
    if (add.length) must(await db().from("adm_locations").insert(add).select("id"));
  }
  revalidatePath("/", "layout");
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
  revalidatePath("/received");
}
