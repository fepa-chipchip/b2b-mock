import { NextResponse } from "next/server";
import { db, must, normPhone } from "@/lib/db";
import * as A from "@/lib/admin";
import { checkPassword, issue, sessionFrom, shopperToken, Session } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/**
 * The fake ChipChip Admin API. Real base URLs: https://ccapi.chipchip.social/v1/ and /v2/ ; here /admin-api/v1/ and /admin-api/v2/.
 * Envelope as the Admin front end reads it: { ok: true, data, meta_data? } or { ok: false, error: { message } }.
 * Tokens: POST v1/users/login gives the user's own token: /system/* only for a back-office user (is_system), the shopper
 * calls for anyone, acting as that user (as the real Admin does for a logged-in app user). /system/users lookups by phone
 * or Telegram id hand out a shopper token (by id the token is "", as on the real API). Checkout charges the company in
 * b2b_customer_id only when the token's user is linked to it.
 */

const okJson = (data: unknown, meta?: Record<string, unknown>, status = 200) =>
  NextResponse.json(meta ? { ok: true, data, meta_data: meta } : { ok: true, data }, { status });
const errJson = (status: number, message: string) => NextResponse.json({ ok: false, error: { message } }, { status });
const notFound = () => new NextResponse("404 page not found", { status: 404, headers: { "Content-Type": "text/plain" } });

type Ctx = { req: Request; url: URL; session: Session | null; body: any };
type Handler = (ctx: Ctx, m: string[]) => Promise<Response>;
type Route = { method: string; pattern: RegExp; auth: "none" | "system" | "shopper"; run: Handler };

const ID = "([^/]+)";
const R = (method: string, path: string, auth: Route["auth"], run: Handler): Route =>
  ({ method, pattern: new RegExp(`^${path.replace(/:id/g, ID)}$`), auth, run });

/** The real filter param: JSON array of {columnField, operatorValue, value}; the mock reads the name/search value. */
function filterTerm(url: URL): { term: string; badColumn: string | null } {
  try {
    const f = JSON.parse(url.searchParams.get("filter") || "[]") as { columnField: string; value: string }[];
    const named = f.find((x) => ["name", "pn.name", "u.name", "u.phone", "u.email", "phone"].includes(x.columnField));
    return { term: named?.value ?? "", badColumn: null };
  } catch {
    return { term: "", badColumn: null };
  }
}
const pageOf = (url: URL, dflt = 20) => ({
  page: Number(url.searchParams.get("page") || 1), perPage: Number(url.searchParams.get("per_page") || dflt),
});

const ROUTES: Route[] = [
  // ---- auth
  R("POST", "v1/users/login", "none", async ({ body }) => {
    const phone = normPhone(String(body?.phone || ""));
    const userId = await checkPassword("admin", phone, String(body?.password || ""));
    if (!userId) return errJson(401, "invalid phone number or password");
    const s = await issue("admin", "user", userId, 7 * 24 * 3600);
    const u = must(await db().from("adm_users").select("*").eq("id", userId).single());
    return okJson({ token: s.token, user_id: userId, user: A.userJson(u) });
  }),

  // ---- system: companies
  R("GET", "v1/system/b2b-customers", "system", async ({ url }) => {
    const { page, perPage } = pageOf(url);
    const r = await A.listCompanies(page, perPage);
    return okJson(r.rows, { total: r.total, page: r.page, per_page: r.per_page });
  }),
  // Register a company + wallet (docs/B2B.md step 2: answers 201 with the company).
  R("POST", "v1/system/b2b-customers", "system", async ({ body }) => okJson(await A.createCompany(body || {}), undefined, 201)),
  R("GET", "v1/system/b2b-customers/user/:id", "system", async (_c, [uid]) => okJson(await A.companyOfUser(uid))),
  R("GET", "v1/system/b2b-customers/:id", "system", async (_c, [id]) => okJson(await A.getCompany(id))),
  R("GET", "v1/system/b2b-customers/:id/statement", "system", async (_c, [id]) => okJson(await A.statement(id))),
  R("GET", "v1/system/b2b-customers/:id/users", "system", async (_c, [id]) => okJson(await A.linkedUsers(id))),
  R("POST", "v1/system/b2b-customers/:id/users", "system", async ({ body }, [id]) =>
    okJson(await A.linkUser(id, String(body?.user_id || ""), String(body?.role || "MEMBER")))),
  R("DELETE", "v1/system/b2b-customers/:id/users/:id", "system", async (_c, [id, uid]) => okJson(await A.unlinkUser(id, uid))),
  R("GET", "v1/system/customer-types", "system", async () => okJson(await A.customerTypes())),

  // ---- system: users (the lookups that hand out a shopper token)
  // STAGING-ONLY: the real Admin has no "create user" call (people sign up in the ChipChip app). It lets the test run
  // the whole new-customer sign-up; see A.createUser. Status 201 is the mock's choice.
  R("POST", "v1/system/users", "system", async ({ body }) => okJson(await A.createUser(body || {}), undefined, 201)),
  R("GET", "v1/system/users", "system", async ({ url }) => {
    const { page, perPage } = pageOf(url);
    const r = await A.searchUsers(filterTerm(url).term, page, perPage);
    return okJson(r.rows, { total: r.total, page, per_page: perPage });
  }),
  R("GET", "v1/system/users/telegram/:id", "system", async (_c, [tid]) => {
    const u = await A.userByTelegram(tid);
    return okJson(A.userJson(u, await shopperToken(u.id)));
  }),
  R("GET", "v1/system/users/:id", "system", async (_c, [key]) => {
    const { user, byId } = await A.findUser(decodeURIComponent(key));
    return okJson(A.userJson(user, byId ? "" : await shopperToken(user.id)));
  }),

  // ---- products (system catalogue and the ordering list)
  R("GET", "v1/system/products", "system", async ({ url }) => {
    const { page, perPage } = pageOf(url);
    const r = await A.listProducts({ term: filterTerm(url).term, page, perPage, activeOnly: /p\.status/.test(url.searchParams.get("filter") || "") });
    return okJson(r.rows, { total: r.total, page, per_page: perPage });
  }),
  R("GET", "v1/products", "shopper", async ({ url }) => {
    // /products refuses p.status outright (the router's 404), as observed on staging.
    if (/p\.status/.test(url.searchParams.get("filter") || "")) return notFound();
    const { page, perPage } = pageOf(url);
    const r = await A.listProducts({ term: filterTerm(url).term, page, perPage, activeOnly: true });
    return okJson(r.rows, { total: r.total, page, per_page: perPage });
  }),

  // ---- shopper: cart, bill, locations, payment methods, checkout, history
  R("POST", "v1/groups", "shopper", async ({ session, body }) =>
    okJson(await A.createGroup(session!.user_id, String(body?.group_deals_id || ""), Number(body?.quantity)))),
  R("PATCH", "v1/carts/groups/:id", "shopper", async ({ session, body }, [gid]) =>
    okJson(await A.updateGroupCart(session!.user_id, gid, Number(body?.quantity)))),
  R("GET", "v1/carts/group", "shopper", async ({ session }) => okJson(await A.cartOf(session!.user_id))),
  R("POST", "v1/bill/groups", "shopper", async ({ session, body }) => okJson(await A.bill(session!.user_id, body))),
  R("GET", "v1/locations/last_mile", "shopper", async ({ session }) => okJson(await A.locationsOf(session!.user_id))),
  // Save a delivery location for the token's user (Manual Orders' new location). Status 200 assumed: the page checks data.ok.
  R("POST", "v1/locations", "shopper", async ({ session, body }) => okJson(await A.createLocation(session!.user_id, body || {}))),
  R("GET", "v2/orders/payment_methods", "shopper", async () => okJson(await A.paymentMethods())),
  R("POST", "v2/orders/multiple-group", "shopper", async ({ session, body }) => okJson(await A.checkout(session!.user_id, body || {}))),
  R("GET", "v1/order/group", "shopper", async ({ session, url }) => {
    const { page, perPage } = pageOf(url, 10);
    const r = await A.ordersOf(session!.user_id, page, perPage);
    return okJson(r.rows, { total: r.total, page, per_page: perPage });
  }),
];

async function handle(req: Request, path: string[]) {
  const url = new URL(req.url);
  const p = path.join("/").replace(/\/+$/, "");
  const route = ROUTES.find((r) => r.method === req.method && r.pattern.test(p));
  if (!route) return notFound();
  const m = (p.match(route.pattern) || []).slice(1);
  let session: Session | null = null;
  if (route.auth !== "none") {
    session = await sessionFrom(req, "admin");
    if (!session) return errJson(401, "unauthorized");
    if (route.auth === "system") {
      const u = must(await db().from("adm_users").select("is_system").eq("id", session.user_id).maybeSingle()) as any;
      if (session.kind !== "user" || !u?.is_system) return errJson(403, "forbidden");
    }
  }
  const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await req.json().catch(() => null) : null;
  try {
    return await route.run({ req, url, session, body }, m);
  } catch (e) {
    if (e instanceof A.AdminError) return errJson(e.status, e.message);
    console.log("admin mock error", (e as Error).message);
    return errJson(500, (e as Error).message);
  }
}

type P = { params: { path: string[] } };
export const GET = (req: Request, { params }: P) => handle(req, params.path);
export const POST = (req: Request, { params }: P) => handle(req, params.path);
export const PATCH = (req: Request, { params }: P) => handle(req, params.path);
export const DELETE = (req: Request, { params }: P) => handle(req, params.path);
