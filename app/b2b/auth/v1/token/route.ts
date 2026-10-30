import { NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { MOCK_B2B_ANON_KEY } from "@/lib/b2bHttp";
import { checkPassword, issue } from "@/lib/sessions";

export const dynamic = "force-dynamic";

const ONE_HOUR = 3600;

/**
 * POST /b2b/auth/v1/token?grant_type=password   { email, password }   (header apikey)
 * Copy of Supabase Auth's password login: { access_token, token_type, expires_in, expires_at, refresh_token, user }.
 * The access_token is opaque here (real: a JWT); send it back as `Authorization: Bearer`.
 */
export async function POST(req: Request) {
  if (req.headers.get("apikey") !== MOCK_B2B_ANON_KEY && new URL(req.url).searchParams.get("apikey") !== MOCK_B2B_ANON_KEY)
    return NextResponse.json({ message: "No API key found in request", hint: "No `apikey` request header or url param was found." }, { status: 401 });
  const grant = new URL(req.url).searchParams.get("grant_type");
  if (grant !== "password")
    return NextResponse.json({ code: 400, error_code: "validation_failed", msg: "Unsupported grant type (the mock copies grant_type=password only)" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(b.email || "").trim().toLowerCase();
  const userId = await checkPassword("b2b", email, String(b.password || ""));
  if (!userId) return NextResponse.json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400 });
  const profile = must(await db().from("b2b_profiles").select("*").eq("id", userId).maybeSingle()) as any;
  const s = await issue("b2b", "user", userId, ONE_HOUR);
  return NextResponse.json({
    access_token: s.token,
    token_type: "bearer",
    expires_in: ONE_HOUR,
    expires_at: Math.floor(Date.parse(s.expires_at) / 1000),
    refresh_token: "mock-refresh-not-supported",
    user: {
      id: userId, aud: "authenticated", role: "authenticated", email,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { full_name: profile?.full_name ?? null },
      created_at: profile?.created_at ?? null,
    },
  });
}
