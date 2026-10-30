import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** The server's own client (service role). Never sent to a browser. */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

/** Throws the Supabase error so a route answers 500 instead of carrying on with nothing. */
export function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const BUCKET = "order-files";

export type Settings = {
  q1_where: "both" | "b2b" | "admin";
  q2_credit: "admin_wallet" | "b2b_status" | "both";
  q3_placed_as: "simenesh" | "staff";
  q4_several: "ask" | "usual";
};

export async function getSettings(): Promise<Settings> {
  const rows = must(await db().from("settings").select("key,value")) as { key: string; value: string }[];
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    q1_where: (s.q1_where as Settings["q1_where"]) || "both",
    q2_credit: (s.q2_credit as Settings["q2_credit"]) || "admin_wallet",
    q3_placed_as: (s.q3_placed_as as Settings["q3_placed_as"]) || "simenesh",
    q4_several: (s.q4_several as Settings["q4_several"]) || "ask",
  };
}

/** Phone digits only, Ethiopian numbers with country code: "+251 91 …" and "091…" both become "2519…". */
export function normPhone(p: string | null | undefined): string {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "251" + d.slice(1);
  if (d.length === 9 && d.startsWith("9")) d = "251" + d;
  return d;
}
