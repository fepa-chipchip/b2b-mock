import { NextResponse } from "next/server";
import { notifyReadyOrders } from "@/lib/readyOrders";

export const dynamic = "force-dynamic";
export const maxDuration = 30;  // up to 20 orders at once, 5 s a try and one retry each

/**
 * GET /api/cron/order-ready   (POST works too)   `Authorization: Bearer <CRON_SECRET>`
 * Tells Zeami about the orders that became ready since the last call (lib/readyOrders.ts). Called every minute by
 * Supabase's pg_cron (supabase/order_ready_cron.sql); a Vercel Cron job on a paid plan sends the same header by itself.
 * Answers { ok, notify: "on"|"off", sent, failed }. CRON_SECRET unset: every call is refused.
 */
async function run(req: Request) {
  const want = process.env.CRON_SECRET;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!want || got !== want) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await notifyReadyOrders()) });
}

export const GET = run;
export const POST = run;
