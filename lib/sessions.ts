import { createHash, randomBytes } from "crypto";
import { db, must } from "./db";

/** The two fake systems' logins: test accounts in `mock_accounts`, passwords compared by sha256. */
export type System = "b2b" | "admin";
export type Session = { token: string; system: System; kind: "user" | "shopper"; user_id: string; expires_at: string };

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The account's user id when login + password match, else null. */
export async function checkPassword(system: System, login: string, password: string): Promise<string | null> {
  const row = must(await db().from("mock_accounts").select("password_sha256,user_id")
    .eq("system", system).eq("login", login).maybeSingle()) as { password_sha256: string; user_id: string } | null;
  if (!row || !password || row.password_sha256 !== sha256(password)) return null;
  return row.user_id;
}

export async function issue(system: System, kind: Session["kind"], user_id: string, seconds: number): Promise<Session> {
  const prefix = system === "b2b" ? "mockb2b" : "mockadm";
  const s: Session = {
    token: `${prefix}.${randomBytes(24).toString("base64url")}`,
    system, kind, user_id,
    expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
  };
  must(await db().from("mock_sessions").insert(s).select("token"));
  return s;
}

/** A shopper token for a user: the live one if there is one, else a new one (Admin hands these out on lookups). */
export async function shopperToken(user_id: string): Promise<string> {
  const live = must(await db().from("mock_sessions").select("token").eq("system", "admin").eq("kind", "shopper")
    .eq("user_id", user_id).gt("expires_at", new Date(Date.now() + 3600_000).toISOString()).limit(1)) as { token: string }[];
  if (live[0]) return live[0].token;
  return (await issue("admin", "shopper", user_id, 7 * 24 * 3600)).token;
}

/** The session behind `Authorization: Bearer <token>` for this system, or null. */
export async function sessionFrom(req: Request, system: System): Promise<Session | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const s = must(await db().from("mock_sessions").select("*").eq("token", token).eq("system", system).maybeSingle()) as Session | null;
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  return s;
}
