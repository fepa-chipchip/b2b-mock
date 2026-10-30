import { NextResponse, NextRequest } from "next/server";

/** The pages ask for UI_PASSWORD (any user name). The bot's webhook and the agent's API have their own checks. */
export function middleware(req: NextRequest) {
  const want = process.env.UI_PASSWORD;
  const auth = req.headers.get("authorization") || "";
  if (want && auth.startsWith("Basic ")) {
    const [, pass] = atob(auth.slice(6)).split(":");
    if (pass === want) return NextResponse.next();
  }
  return new NextResponse("Password needed", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="B2B orders test"' } });
}

export const config = { matcher: ["/((?!api/|_next/|favicon).*)"] };
