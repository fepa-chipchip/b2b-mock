import { randomUUID } from "crypto";
import { db, must, normPhone } from "./db";

/**
 * The fake ChipChip Admin (Go API at ccapi.chipchip.social /v1 and /v2). Shapes copied from chipadminreact
 * (origin/HEAD, 2026-10-28): docs/B2B.md, src/services/B2BServices.ts, src/components/pages/b2b/{shopper.ts,types.ts,queries/*}.
 * Everything here takes plain ids; the HTTP layer (app/admin-api) checks tokens, the mock's pages call it directly.
 */

export class AdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string) => new AdminError(status, message);

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => String(r2(n));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What staging's bill/groups returned when observed: 15% on the subtotal, reported in no field (see bill.ts in Admin). */
export const UNNAMED_CHARGE_RATE = 0.15;

// ------------------------------------------------------------------ companies (system)
export type CompanyJson = {
  id: string; business_name: string; tin: string | null; phone: string | null; status: string; credit_limit: string;
  payment_terms_days: number; credit_status: string; charge_vat: boolean | null; customer_type_id: string | null;
  wallet_account_id: string | null; created_at: string;
};
export function companyJson(c: any): CompanyJson {
  return {
    id: c.id, business_name: c.business_name, tin: c.tin, phone: c.phone, status: c.status,
    credit_limit: String(Number(c.credit_limit)), payment_terms_days: c.payment_terms_days, credit_status: c.credit_status,
    charge_vat: c.charge_vat, customer_type_id: c.customer_type_id, wallet_account_id: c.wallet_account_id, created_at: c.created_at,
  };
}

export async function listCompanies(page = 1, perPage = 20) {
  const rows = must(await db().from("adm_b2b_customers").select("*").is("deleted_at", null).order("created_at", { ascending: false })) as any[];
  const p = Math.max(1, page), pp = Math.max(1, perPage);
  return { rows: rows.slice((p - 1) * pp, p * pp).map(companyJson), total: rows.length, page: p, per_page: pp };
}

async function companyRow(id: string) {
  if (!UUID.test(id)) throw fail(404, "b2b customer not found");
  const c = must(await db().from("adm_b2b_customers").select("*").eq("id", id).is("deleted_at", null).maybeSingle()) as any;
  if (!c) throw fail(404, "b2b customer not found");
  return c;
}
export const getCompany = async (id: string) => companyJson(await companyRow(id));

export type StatementJson = {
  b2b_customer_id: string; business_name: string; wallet_account_id: string | null; credit_status: string; payment_terms_days: number;
  credit_limit: string; balance: string; amount_owed: string; available_credit: string;
};
export async function statement(id: string): Promise<StatementJson> {
  const c = await companyRow(id);
  const balance = Number(c.wallet_balance);
  const owed = Math.max(0, -balance);
  return {
    b2b_customer_id: c.id, business_name: c.business_name, wallet_account_id: c.wallet_account_id, credit_status: c.credit_status,
    payment_terms_days: c.payment_terms_days, credit_limit: String(Number(c.credit_limit)), balance: money(balance),
    amount_owed: money(owed), available_credit: money(Math.max(0, Number(c.credit_limit) - owed)),
  };
}

export type LinkJson = {
  id: string; b2b_customer_id: string; user_id: string; role: string; created_at: string;
  user: { id: string; name: string; phone: string } | null;
};
export async function linkedUsers(companyId: string): Promise<LinkJson[]> {
  await companyRow(companyId);
  const links = must(await db().from("adm_b2b_customer_users").select("id,b2b_customer_id,user_id,role,created_at, adm_users(id,name,phone)")
    .eq("b2b_customer_id", companyId).order("created_at")) as any[];
  return links.map((l) => ({
    id: l.id, b2b_customer_id: l.b2b_customer_id, user_id: l.user_id, role: l.role, created_at: l.created_at,
    user: l.adm_users ? { id: l.adm_users.id, name: l.adm_users.name, phone: l.adm_users.phone } : null,
  }));
}

export async function linkUser(companyId: string, userId: string, role: string) {
  await companyRow(companyId);
  if (!["ADMIN", "MEMBER"].includes(role)) throw fail(400, "role must be ADMIN or MEMBER");
  await userRow(userId);
  const row = must(await db().from("adm_b2b_customer_users").upsert({ b2b_customer_id: companyId, user_id: userId, role },
    { onConflict: "b2b_customer_id,user_id" }).select("id,b2b_customer_id,user_id,role").single());
  return row;
}

export async function unlinkUser(companyId: string, userId: string) {
  must(await db().from("adm_b2b_customer_users").delete().eq("b2b_customer_id", companyId).eq("user_id", userId).select("id"));
  return { b2b_customer_id: companyId, user_id: userId };
}

/** GET /b2b-customers/user/:user_id: the company a user belongs to (the first, when there are several). */
export async function companyOfUser(userId: string) {
  const l = must(await db().from("adm_b2b_customer_users").select("b2b_customer_id").eq("user_id", userId).order("created_at").limit(1)) as any[];
  if (!l[0]) throw fail(404, "user is not linked to any b2b customer");
  return getCompany(l[0].b2b_customer_id);
}

export async function customerTypes() {
  return must(await db().from("adm_customer_types").select("*").order("name"));
}

// ------------------------------------------------------------------ users (system)
async function userRow(id: string) {
  if (!UUID.test(id)) throw fail(404, "user not found");
  const u = must(await db().from("adm_users").select("*").eq("id", id).maybeSingle()) as any;
  if (!u) throw fail(404, "user not found");
  return u;
}
export const userJson = (u: any, token = "") => ({
  id: u.id, name: u.name, phone: u.phone, email: u.email ?? "", telegram_id: u.telegram_id, status: u.status, country: "ETH",
  created_at: u.created_at, token,
});

export async function findUser(idOrPhone: string): Promise<{ user: any; byId: boolean }> {
  if (UUID.test(idOrPhone)) return { user: await userRow(idOrPhone), byId: true };
  const phone = normPhone(idOrPhone);
  const u = must(await db().from("adm_users").select("*").eq("phone", phone).maybeSingle()) as any;
  if (!u) throw fail(404, "user not found");
  return { user: u, byId: false };
}

export async function userByTelegram(tid: string) {
  const u = must(await db().from("adm_users").select("*").eq("telegram_id", Number(tid) || -1).maybeSingle()) as any;
  if (!u) throw fail(404, "user not found");
  return u;
}

export async function searchUsers(term: string, page = 1, perPage = 20) {
  const all = must(await db().from("adm_users").select("*").order("name")) as any[];
  const t = term.trim().toLowerCase().replace(/^\+/, "");
  const hits = t ? all.filter((u) => [u.name, u.phone, u.email].some((v) => String(v || "").toLowerCase().includes(t))) : all;
  return { rows: hits.slice((page - 1) * perPage, page * perPage).map((u) => userJson(u)), total: hits.length };
}

// ------------------------------------------------------------------ products
export type DealJson = {
  id: string; deal_type: string; group_price: string; min_quantity_per_order: number; max_quantity_per_order: number;
  max_group_member: number; expiration_time: number; lead_time: string; reorder_wait_time: string;
};
export type ProductJson = {
  id: string; name: string; measuring_unit: string; primary_image: string; product_status: string; current_unit_price: string;
  remaining_stock: string; stock_alert: string; vendor_id: string | null; vendor_name: string; single_deal: null;
  group_deal: DealJson | null; group_deals: DealJson[];
};
function dealJson(d: any): DealJson {
  return {
    id: d.id, deal_type: d.deal_type, group_price: money(Number(d.group_price)), min_quantity_per_order: Number(d.min_quantity_per_order),
    max_quantity_per_order: Number(d.max_quantity_per_order), max_group_member: d.max_group_member, expiration_time: d.expiration_time,
    lead_time: d.lead_time, reorder_wait_time: d.reorder_wait_time,
  };
}

/** /system/products and /products: products carrying a B2B deal, filtered by name like the real filter param. */
export async function listProducts(opts: { term?: string; page?: number; perPage?: number; activeOnly?: boolean }) {
  const products = must(await db().from("adm_products").select("*, adm_group_deals(*)").order("name")) as any[];
  const t = (opts.term || "").trim().toLowerCase();
  const rows: ProductJson[] = products
    .filter((p) => (p.adm_group_deals || []).some((d: any) => d.deal_type === "B2B"))
    .filter((p) => !opts.activeOnly || p.product_status === "ACTIVE")
    .filter((p) => !t || p.name.toLowerCase().includes(t))
    .map((p) => {
      const deals = (p.adm_group_deals || []).map(dealJson);
      return {
        id: p.id, name: p.name, measuring_unit: p.measuring_unit, primary_image: p.primary_image, product_status: p.product_status,
        current_unit_price: money(Number(p.current_unit_price)), remaining_stock: String(Number(p.remaining_stock)), stock_alert: "0",
        vendor_id: p.vendor_id, vendor_name: "", single_deal: null, group_deal: deals[0] ?? null, group_deals: deals,
      };
    });
  const page = Math.max(1, opts.page || 1), pp = Math.max(1, opts.perPage || 20);
  return { rows: rows.slice((page - 1) * pp, page * pp), total: rows.length };
}

// ------------------------------------------------------------------ shopper: cart, bill, checkout, history
export async function createGroup(userId: string, dealId: string, quantity: number) {
  if (!UUID.test(String(dealId))) throw fail(400, "invalid group_deals_id");
  const deal = must(await db().from("adm_group_deals").select("*, adm_products(name, product_status, remaining_stock)").eq("id", dealId).maybeSingle()) as any;
  if (!deal) throw fail(404, "group deal not found");
  const q = Number(quantity);
  if (!(q > 0)) throw fail(400, "quantity must be greater than 0");
  if (q < Number(deal.min_quantity_per_order)) throw fail(400, `minimum quantity for this deal is ${Number(deal.min_quantity_per_order)}`);
  if (q > Number(deal.max_quantity_per_order)) throw fail(400, `maximum quantity per order for this deal is ${Number(deal.max_quantity_per_order)}`);
  if (deal.adm_products?.product_status !== "ACTIVE") throw fail(400, "product is not active");
  if (q > Number(deal.adm_products?.remaining_stock ?? 0)) throw fail(400, "insufficient stock");
  const g = must(await db().from("adm_groups").insert({ group_deals_id: dealId, user_id: userId }).select("*").single()) as any;
  const cart = must(await db().from("adm_group_carts").insert({ group_id: g.id, user_id: userId, quantity: q }).select("*").single()) as any;
  return { id: g.id, group_cart_id: cart.id, deal_type: deal.deal_type, status: g.status, quantity: q };
}

/** PATCH /carts/groups/:group_id — `quantity` is a DELTA added to the current one; at 0 or below the line goes. */
export async function updateGroupCart(userId: string, groupId: string, delta: number) {
  if (!UUID.test(groupId)) throw fail(404, "group not found");
  const cart = must(await db().from("adm_group_carts").select("*, adm_groups(group_deals_id, adm_group_deals(max_quantity_per_order, min_quantity_per_order))")
    .eq("group_id", groupId).eq("user_id", userId).eq("ordered", false).maybeSingle()) as any;
  if (!cart) throw fail(404, "group cart not found");
  const next = Number(cart.quantity) + Number(delta || 0);
  const deal = cart.adm_groups?.adm_group_deals;
  if (next <= 0) {
    must(await db().from("adm_groups").delete().eq("id", groupId).select("id"));
    return { group_id: groupId, quantity: 0 };
  }
  if (deal && next < Number(deal.min_quantity_per_order)) throw fail(400, `minimum quantity for this deal is ${Number(deal.min_quantity_per_order)}`);
  if (deal && next > Number(deal.max_quantity_per_order)) throw fail(400, `maximum quantity per order for this deal is ${Number(deal.max_quantity_per_order)}`);
  must(await db().from("adm_group_carts").update({ quantity: next }).eq("id", cart.id).select("id"));
  return { group_id: groupId, quantity: next };
}

type CartLine = {
  id: string; group_id: string; product_id: string; quantity: number; item_total_price: string; name: string;
  measuring_unit: string; primary_image: string; group_status: string;
  group_deal: { id: string; deal_type: string; group_price: string };
};

export async function cartOf(userId: string): Promise<CartLine[]> {
  const rows = must(await db().from("adm_group_carts")
    .select("id, group_id, quantity, created_at, adm_groups(status, adm_group_deals(id, deal_type, group_price, product_id, adm_products(id, name, measuring_unit, primary_image)))")
    .eq("user_id", userId).eq("ordered", false).order("created_at")) as any[];
  return rows.map((r) => {
    const d = r.adm_groups.adm_group_deals;
    return {
      id: r.id, group_id: r.group_id, product_id: d.adm_products.id, quantity: Number(r.quantity),
      item_total_price: money(Number(r.quantity) * Number(d.group_price)), name: d.adm_products.name,
      measuring_unit: d.adm_products.measuring_unit, primary_image: d.adm_products.primary_image, group_status: r.adm_groups.status,
      group_deal: { id: d.id, deal_type: d.deal_type, group_price: money(Number(d.group_price)) },
    };
  });
}

export type LocationJson = { id: string; name: string; location_title: string | null; contact_phone: string | null };
export async function locationsOf(userId: string): Promise<LocationJson[]> {
  return must(await db().from("adm_locations").select("id,name,location_title,contact_phone").eq("user_id", userId).order("name")) as LocationJson[];
}

export async function paymentMethods() {
  return must(await db().from("adm_payment_methods").select("id,name").order("sort")) as { id: string; name: string }[];
}

async function priceLines(userId: string, cartIds: string[]) {
  const cart = await cartOf(userId);
  const lines = cartIds.map((id) => {
    const l = cart.find((c) => c.id === id);
    if (!l) throw fail(400, `group cart ${id} not found or already ordered`);
    return l;
  });
  const subtotal = r2(lines.reduce((s, l) => s + Number(l.item_total_price), 0));
  return { lines, subtotal, total: r2(subtotal * (1 + UNNAMED_CHARGE_RATE)) };
}

/** POST /bill/groups: one bill for the listed carts. Numbers come back as strings, as on staging. */
export async function bill(userId: string, body: { cart_id: string; group_id: string; location_id: string; with_packaging?: boolean }[]) {
  if (!Array.isArray(body) || body.length === 0) throw fail(400, "no cart items to bill");
  const locs = await locationsOf(userId);
  for (const b of body) if (!locs.some((l) => l.id === b.location_id)) throw fail(400, "location not found");
  const { lines, subtotal, total } = await priceLines(userId, body.map((b) => b.cart_id));
  const kg = lines.filter((l) => /kg/i.test(l.measuring_unit)).reduce((s, l) => s + l.quantity * (parseFloat(l.measuring_unit) || 1), 0);
  return {
    subtotal: money(subtotal), delivery_charge: "0", packaging_fee: "0", plastic_bag_fee: "0", tax: "0", tax_rate: "0",
    discount: "0", total: money(total), total_items: String(lines.length), total_kg: money(kg), packing_fee_exempt: false,
    delivery_type: "STANDARD", lead_time: "24h",
  };
}

export type CheckoutBody = {
  account_number?: string; b2b_customer_id?: string; delivery_note?: string; device?: string; group_cart_ids?: string[];
  location_id?: string; payment_method_id?: string; platform?: string; willingness?: boolean; with_packaging?: boolean;
};

/**
 * POST /v2/orders/multiple-group. For B2B deals the company wallet is charged on credit, refused when
 * balance - amount < -credit_limit ("order exceeds available credit limit"). One order row per cart line, PENDING.
 */
export async function checkout(userId: string, b: CheckoutBody) {
  const ids = Array.isArray(b.group_cart_ids) ? b.group_cart_ids : [];
  if (ids.length === 0) throw fail(400, "group_cart_ids is required");
  if (!b.location_id) throw fail(400, "location_id is required");
  if (!b.payment_method_id) throw fail(400, "payment_method_id is required");
  const loc = (await locationsOf(userId)).find((l) => l.id === b.location_id);
  if (!loc) throw fail(400, "location not found");
  if (!(await paymentMethods()).some((m) => m.id === b.payment_method_id)) throw fail(400, "payment method not found");
  const { lines, total } = await priceLines(userId, ids);
  if (lines.some((l) => l.group_deal.deal_type !== "B2B")) throw fail(400, "only B2B group carts can be checked out on a company's credit");

  // The company: the one given, else the buyer's linked company (docs/B2B.md step 5).
  let companyId = b.b2b_customer_id;
  if (!companyId) companyId = (await companyOfUser(userId)).id;
  const company = await companyRow(companyId!);
  const link = must(await db().from("adm_b2b_customer_users").select("id").eq("b2b_customer_id", company.id).eq("user_id", userId).maybeSingle());
  if (!link) throw fail(400, "user is not linked to this b2b customer");
  if (company.status !== "ACTIVE") throw fail(400, "b2b customer is not active");
  if (!company.wallet_account_id) throw fail(400, "b2b customer has no wallet");
  const projected = Number(company.wallet_balance) - total;
  if (projected < -Number(company.credit_limit)) throw fail(400, "order exceeds available credit limit");

  const billId = randomUUID();
  const now = new Date().toISOString();
  must(await db().from("adm_orders").insert(lines.map((l) => ({
    bill_id: billId, user_id: userId, b2b_customer_id: company.id, group_cart_id: l.id, product_id: l.product_id,
    item_name: l.name, quantity: l.quantity, unit_price: Number(l.group_deal.group_price), subtotal: Number(l.item_total_price),
    total_amount: r2(Number(l.item_total_price) * (1 + UNNAMED_CHARGE_RATE)), status: "PENDING", location_id: loc.id,
    location_name: loc.name, delivery_note: b.delivery_note ?? "", payment_method_id: b.payment_method_id,
    with_packaging: b.with_packaging ?? true, created_at: now, updated_at: now,
  }))).select("id"));
  must(await db().from("adm_group_carts").update({ ordered: true }).in("id", ids).select("id"));
  must(await db().from("adm_groups").update({ status: "COMPLETED" }).in("id", lines.map((l) => l.group_id)).select("id"));
  must(await db().from("adm_b2b_customers").update({ wallet_balance: r2(projected) }).eq("id", company.id).select("id"));
  return { order_id: billId, bill_id: billId, payment_url: "", total_amount: money(total) };
}

/** GET /order/group: the shopper's placed group orders, newest first, one row per product. */
export type OrderJson = {
  id: string; groups_carts_id: string | null; bill_id: string; b2b_customer_id: string | null; created_at: string; updated_at: string;
  status: string; is_b2b_order: boolean; total_amount: string; subtotal: string; item: { name: string; quantity: number };
  delivery_address: { delivery_location: { name: string | null } };
};
export async function ordersOf(userId: string, page = 1, perPage = 10): Promise<{ total: number; rows: OrderJson[] }> {
  const rows = must(await db().from("adm_orders").select("*").eq("user_id", userId).order("updated_at", { ascending: false })) as any[];
  const p = Math.max(1, page), pp = Math.max(1, perPage);
  return {
    total: rows.length,
    rows: rows.slice((p - 1) * pp, p * pp).map((o) => ({
      id: o.id, groups_carts_id: o.group_cart_id, bill_id: o.bill_id, b2b_customer_id: o.b2b_customer_id,
      created_at: o.created_at, updated_at: o.updated_at, status: o.status, is_b2b_order: o.is_b2b_order,
      total_amount: money(Number(o.total_amount)), subtotal: money(Number(o.subtotal)),
      item: { name: o.item_name, quantity: Number(o.quantity) },
      delivery_address: { delivery_location: { name: o.location_name } },
    })),
  };
}

// ------------------------------------------------------------------ for the order bot
/** Every company a phone number is a linked user of (what the bot reads from Admin at go-live). */
export async function companiesForPhone(phone: string) {
  const u = must(await db().from("adm_users").select("id,name,phone").eq("phone", normPhone(phone)).maybeSingle()) as any;
  if (!u) return { user: null, companies: [] as { id: string; business_name: string }[] };
  const links = must(await db().from("adm_b2b_customer_users").select("adm_b2b_customers(id,business_name,deleted_at)")
    .eq("user_id", u.id)) as any[];
  const companies = links.map((l) => l.adm_b2b_customers).filter((c) => c && !c.deleted_at)
    .map((c) => ({ id: c.id as string, business_name: c.business_name as string }));
  return { user: u as { id: string; name: string; phone: string }, companies };
}
