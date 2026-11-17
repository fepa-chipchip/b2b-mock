import { NextResponse } from "next/server";
import { erpSpec } from "@/lib/openapi";

export const dynamic = "force-dynamic";

/** GET /api/openapi/erp: the OpenAPI document of the fake ERP's payment-request call. No secrets in it. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  return NextResponse.json(erpSpec(`${u.protocol}//${u.host}`));
}
