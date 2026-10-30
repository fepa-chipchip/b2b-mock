import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * GET /api/health: which settings are present (never their values) and whether the database answers.
 * Production builds hide a page's error, so this is where a broken setup says why.
 */
export async function GET() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const present = Object.fromEntries(
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "AGENT_TOKEN", "UI_PASSWORD"]
      .map((n) => [n, !!process.env[n]]));
  const checks: Record<string, unknown> = {
    url_shape: /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) ? "ok" : "should be https://<ref>.supabase.co with nothing after",
    key_kind: key.startsWith("sb_secret_") ? "secret key" : key.startsWith("eyJ") ? "service_role (JWT)" : key ? "unknown kind" : "missing",
    bot_token_shape: /^\d+:[\w-]{30,}$/.test(process.env.TELEGRAM_BOT_TOKEN || "") ? "ok" : "check for spaces or a missing part",
  };
  if (url && key) {
    try {
      const r = await createClient(url, key, { auth: { persistSession: false } }).from("settings").select("key").limit(1);
      checks.database = r.error ? `error: ${r.error.message}` : `ok (${r.data?.length ?? 0} row read)`;
    } catch (e) {
      checks.database = `error: ${(e as Error).message}`;
    }
  }
  return NextResponse.json({ present, checks });
}
