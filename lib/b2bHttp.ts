import { NextResponse } from "next/server";
import { PgError } from "./pgrest";
import { sessionFrom, Session } from "./sessions";

/**
 * The fake B2B's publishable ("anon") key. Like the real one (hardcoded in b2bchip's supabase client) it is public:
 * it only says which project is called; the user's access_token is what grants access.
 */
export const MOCK_B2B_ANON_KEY = "mock-b2b-publishable-key";

export const pgJson = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers });

export function pgFail(e: unknown) {
  if (e instanceof PgError) return pgJson(e.body, e.status);
  console.log("b2b mock error", (e as Error).message);
  return pgJson({ code: "XX000", details: null, hint: null, message: (e as Error).message }, 500);
}

/** apikey + Bearer <access_token from /auth/v1/token>, as PostgREST behind Supabase requires. */
export async function b2bAuth(req: Request): Promise<{ session: Session } | { denied: NextResponse }> {
  const key = req.headers.get("apikey") || new URL(req.url).searchParams.get("apikey");
  if (!key) {
    return { denied: pgJson({ message: "No API key found in request", hint: "No `apikey` request header or url param was found." }, 401) };
  }
  if (key !== MOCK_B2B_ANON_KEY) {
    return { denied: pgJson({ message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." }, 401) };
  }
  if (!/^Bearer\s+\S/i.test(req.headers.get("authorization") || "") ||
      (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim() === key) {
    // Only the anon key: the anon role. Real B2B's row-level security gives it nothing.
    return { denied: pgJson({ code: "42501", details: null, hint: null, message: "permission denied for schema public" }, 401) };
  }
  const session = await sessionFrom(req, "b2b");
  if (!session) {
    return { denied: pgJson({ code: "PGRST301", details: null, hint: null, message: "JWT expired" }, 401) };
  }
  return { session };
}
