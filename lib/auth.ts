import { NextResponse } from "next/server";

/** The agent's routes: `Authorization: Bearer <AGENT_TOKEN>`. Returns a 401 response, or null when allowed. */
export function agentOnly(req: Request): NextResponse | null {
  const want = process.env.AGENT_TOKEN;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!want || got !== want) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return null;
}

export const ok = (data: unknown, status = 200) => NextResponse.json({ ok: true, ...(data as object) }, { status });
export const fail = (error: string, status = 400, extra: object = {}) =>
  NextResponse.json({ ok: false, error, ...extra }, { status });
