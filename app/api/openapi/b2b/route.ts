import { NextResponse } from "next/server";
import { b2bSpec } from "@/lib/openapi";

export const dynamic = "force-dynamic";

/** GET /api/openapi/b2b: the OpenAPI document an agent platform imports its endpoints from. No secrets in it. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  return NextResponse.json(b2bSpec(`${u.protocol}//${u.host}`));
}
