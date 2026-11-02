import { NextResponse } from "next/server";
import { agentSpec } from "@/lib/openapi";

export const dynamic = "force-dynamic";

/** GET /api/openapi/agent: the OpenAPI document an agent platform imports its endpoints from. No secrets in it. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  return NextResponse.json(agentSpec(`${u.protocol}//${u.host}`));
}
