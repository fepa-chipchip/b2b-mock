import { randomUUID } from "crypto";
import { db, must } from "./db";
import { InsertDef, Schema, pgError } from "./pgrest";

/**
 * The fake ChipChip B2B. Real B2B is a Supabase project: PostgREST tables + three RPCs the order flow uses.
 * Logic below is copied from b2bchip (origin/HEAD, 2026-10-28):
 *   check_customer_credit_status  supabase/migrations/20260626193051_*.sql
 *   create_order_with_items       supabase/migrations/20260316233113_*.sql
 *   get_orders_page               supabase/migrations/20260805081737_*.sql
 *   the New Order dialog's own steps (credit check, tax, notes) src/services/order/createOrderWithTax.ts
 */

/**
 * POST /rest/v1/customers: the one direct table write copied. The real app inserts customers from the Add Customer
 * form (src/services/customers/addCustomer.ts) and the Telegram sign-up (src/services/telegram/registration/
 * customerRegistration.ts, source 'telegram'). Real columns and constraints from src/integrations/supabase/types.ts
 * (customers.Insert: name, email, customer_type_id required; FK customers_customer_type_id_fkey).
 */
const CUSTOMERS_INSERT: InsertDef = {
  columns: {
    id: "uuid", name: "text", phone: "text", email: "text", address: "text", customer_type_id: "uuid", type: "text",
    is_active: "boolean", approval_status: "text", credit_limit: "numeric", credit_status: "text", agreement_url: "text",
    agreement_date: "text", tin_number: "text", tax_exempt_override: "boolean", tax_exempt_reason: "text",
    legal_process_initiated: "boolean", legal_process_date: "timestamptz", assigned_sales_agent_id: "uuid",
    telegram_id: "bigint", latitude: "numeric", longitude: "numeric", location_accuracy: "numeric", source: "text",
    created_at: "timestamptz",
  },
  notNull: ["id", "name", "email", "customer_type_id", "is_active", "credit_limit", "credit_status", "created_at"],
  // No default on the real table. (The mock's email column defaults to '' only for its old seed rows.)
  noDefault: ["name", "email", "customer_type_id"],
  // Real columns of customers the mock table does not have. addCustomer.ts sends password, license_url and
  // parent_customer_id (null for a new customer); the real table takes them, so the mock accepts and drops them
  // rather than answering PGRST204. Anything else unknown is PGRST204, as on the real API.
  dropped: [
    "password", "license_url", "parent_customer_id", "account_restricted", "account_restriction_date", "acquisition_date",
    "acquisition_source", "active_credit_orders_count", "business_type", "conversation_count", "last_conversation_date",
    "last_payment_date", "preferred_payment", "products_sold", "restock_cycle", "sms_notifications_enabled",
    "sms_opt_out_date", "updated_by",
  ],
  generated: { id: () => randomUUID() },  // the real id defaults to gen_random_uuid(); the mock column has no default
  // Constraint name as the real table is expected to carry it (email unique; name not seen in b2bchip's migrations).
  unique: [{ column: "email", constraint: "customers_email_key" }],
  fks: [{ column: "customer_type_id", constraint: "customers_customer_type_id_fkey", table: "customer_types", foreign: "id" }],
};

/** Exposed table name -> mock table, and the foreign keys PostgREST would embed on. */
export const B2B_SCHEMA: Schema = {
  customers: {
    real: "b2b_customers",
    rels: {
      customer_types: { table: "customer_types", kind: "one", local: "customer_type_id", foreign: "id" },
      orders: { table: "orders", kind: "many", local: "id", foreign: "customer_id" },
    },
    insert: CUSTOMERS_INSERT,
  },
  customer_types: { real: "b2b_customer_types", rels: { customers: { table: "customers", kind: "many", local: "id", foreign: "customer_type_id" } } },
  products: { real: "b2b_products", rels: { product_prices: { table: "product_prices", kind: "many", local: "id", foreign: "product_id" } } },
  product_prices: { real: "b2b_product_prices", rels: { products: { table: "products", kind: "one", local: "product_id", foreign: "id" } } },
  orders: {
    real: "b2b_orders",
    rels: {
      customers: { table: "customers", kind: "one", local: "customer_id", foreign: "id" },
      order_items: { table: "order_items", kind: "many", local: "id", foreign: "order_id" },
    },
  },
  order_items: {
    real: "b2b_order_items",
    rels: {
      orders: { table: "orders", kind: "one", local: "order_id", foreign: "id" },
      products: { table: "products", kind: "one", local: "product_id", foreign: "id" },
    },
  },
  payment_types: { real: "b2b_payment_types", rels: {} },
  pricing_settings: { real: "b2b_pricing_settings", rels: {} },
  profiles: { real: "b2b_profiles", rels: {} },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayUTC = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400_000);

export type CreditStatus = {
  customer_id: string; credit_limit: number; credit_status: string; total_unpaid: number; has_overdue: boolean;
  can_place_order: boolean; overdue_orders_count: number; maximum_unpaid_threshold: number; is_legal_stage: boolean;
  stage_6_orders: number;
};

/**
 * RPC check_customer_credit_status(customer_uuid). Like the real one it is not read-only: a customer with nothing
 * unpaid but a stale bad status is reset to 'good'.
 */
export async function checkCustomerCreditStatus(customerUuid: unknown): Promise<CreditStatus | { error: string }> {
  if (typeof customerUuid !== "string" || !UUID.test(customerUuid))
    throw pgError(400, "22P02", `invalid input syntax for type uuid: "${String(customerUuid)}"`);
  const c = must(await db().from("b2b_customers").select("*").eq("id", customerUuid).eq("is_active", true).maybeSingle()) as any;
  if (!c) return { error: "Customer not found or inactive" };

  const grace = 7, legalDays = 15;  // credit_settings defaults when the table is empty (the mock has no such table)
  const orders = must(await db().from("b2b_orders").select("amount,payment_status,status,date").eq("customer_id", customerUuid)) as any[];
  const open = orders.filter((o) => ["credit", "pending"].includes(String(o.payment_status || "").toLowerCase())
    && !["Cancelled", "Voided"].includes(o.status) && Number(o.amount || 0) > 0);
  const today = dayUTC(new Date());
  const totalUnpaid = r2(open.reduce((a, o) => a + Number(o.amount), 0));
  const overdue = open.filter((o) => daysBetween(today, dayUTC(o.date)) - grace > 0).length;
  const stage6 = open.filter((o) => daysBetween(today, dayUTC(o.date)) - 7 >= legalDays).length;

  if (totalUnpaid === 0 && (c.legal_process_initiated || ["overdue", "legal_process", "suspended", "credit_limit_exceeded"].includes(c.credit_status))) {
    must(await db().from("b2b_customers").update({ legal_process_initiated: false, legal_process_date: null, credit_status: "good" })
      .eq("id", customerUuid).select("id"));
    c.legal_process_initiated = false;
    c.credit_status = "good";
  }

  const legal = stage6 > 0 || !!c.legal_process_initiated;
  let status = "good", can = true;
  if (c.credit_status === "approved_override") { status = "approved_override"; can = true; }
  else if (c.legal_process_initiated) { status = "legal_process"; can = false; }
  else if (stage6 > 0) { status = "legal_process"; can = false; }
  else if (overdue > 0) { status = "overdue"; can = false; }
  else if (c.credit_status === "suspended") { status = "suspended"; can = false; }
  if (totalUnpaid > Number(c.credit_limit) && !["approved_override", "legal_process"].includes(status)) {
    can = false;
    if (overdue === 0) status = "credit_limit_exceeded";
  }
  return {
    customer_id: customerUuid, credit_limit: Number(c.credit_limit), credit_status: status, total_unpaid: totalUnpaid,
    has_overdue: overdue > 0, can_place_order: can, overdue_orders_count: overdue,
    maximum_unpaid_threshold: Number(c.credit_limit) * 2, is_legal_stage: legal, stage_6_orders: stage6,
  };
}

const CREATE_ARGS = ["p_customer_id", "p_subtotal", "p_discount", "p_discount_reason", "p_tax_amount", "p_tax_rate", "p_delivery_fee",
  "p_amount", "p_delivery_date", "p_payment_type", "p_payment_status", "p_total_quantity", "p_source", "p_notes", "p_items"];
const PAYMENT_STATUSES = ["pending", "credit", "paid", "cancelled", "unpaid", "partial"];

/** RPC create_order_with_items(...). Writes the order as 'Processing'; it does NOT check credit (the caller does). */
export async function createOrderWithItems(a: Record<string, any>): Promise<{ success: true; order_id: string; order_number: string }> {
  const given = Object.keys(a).sort();
  const missing = CREATE_ARGS.filter((k) => !(k in a));
  const unknown = given.filter((k) => !CREATE_ARGS.includes(k) && k !== "p_warehouse_id");
  if (missing.length || unknown.length) {
    throw pgError(404, "PGRST202",
      `Could not find the function public.create_order_with_items(${given.join(", ")}) in the schema cache`,
      `Searched for the function public.create_order_with_items with parameters ${given.join(", ")} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
      `Perhaps you meant to call the function public.create_order_with_items(${[...CREATE_ARGS, "p_warehouse_id"].sort().join(", ")})`);
  }
  if (typeof a.p_customer_id !== "string" || !UUID.test(a.p_customer_id))
    throw pgError(400, "22P02", `invalid input syntax for type uuid: "${a.p_customer_id}"`);
  if (typeof a.p_delivery_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.p_delivery_date) || isNaN(Date.parse(a.p_delivery_date)))
    throw pgError(400, "22007", `invalid input syntax for type date: "${a.p_delivery_date}"`);
  for (const k of ["p_subtotal", "p_discount", "p_tax_amount", "p_tax_rate", "p_delivery_fee", "p_amount", "p_total_quantity"]) {
    if (a[k] !== null && !isFinite(Number(a[k]))) throw pgError(400, "22P02", `invalid input syntax for type numeric: "${a[k]}"`);
  }
  const fail = (msg: string) => pgError(400, "P0001", `Order creation failed: ${msg}`);
  if (!Array.isArray(a.p_items)) throw fail("cannot get array length of a scalar");
  if (a.p_items.length === 0) throw fail("Cannot create order without items");

  const customer = must(await db().from("b2b_customers").select("id").eq("id", a.p_customer_id).maybeSingle());
  if (!customer) throw fail(`insert or update on table "orders" violates foreign key constraint "orders_customer_id_fkey"`);
  for (const it of a.p_items) {
    if (!it || typeof it.product_id !== "string" || !UUID.test(it.product_id)) throw fail(`invalid input syntax for type uuid: "${it?.product_id}"`);
    if (!it.product_name) throw fail(`null value in column "product_name" of relation "order_items" violates not-null constraint`);
    for (const k of ["quantity", "price", "total"]) if (!isFinite(Number(it[k])) || it[k] === null || it[k] === "") throw fail(`null value in column "${k}" of relation "order_items" violates not-null constraint`);
  }
  const ids = Array.from(new Set(a.p_items.map((i: any) => i.product_id)));
  const found = must(await db().from("b2b_products").select("id").in("id", ids)) as { id: string }[];
  if (found.length !== ids.length) throw fail(`insert or update on table "order_items" violates foreign key constraint "order_items_product_id_fkey"`);
  if (!PAYMENT_STATUSES.includes(String(a.p_payment_status)))
    throw fail(`new row for relation "orders" violates check constraint "orders_payment_status_check"`);
  const types = (must(await db().from("b2b_payment_types").select("name")) as { name: string }[]).map((t) => t.name);
  if (!types.includes(String(a.p_payment_type)))
    throw fail(`new row for relation "orders" violates check constraint "orders_payment_type_check"`);

  const orderNumber = `ORD-${Math.floor(Date.now() / 1000) * 1000}-${Math.floor(Math.random() * 10000)}`;
  const n = (v: any) => (v === null || v === undefined ? 0 : Number(v));
  // The orders trigger recomputes amount = subtotal - discount + tax + delivery_fee.
  const amount = r2(n(a.p_subtotal) - n(a.p_discount) + n(a.p_tax_amount) + n(a.p_delivery_fee));
  const order = must(await db().from("b2b_orders").insert({
    order_number: orderNumber, customer_id: a.p_customer_id, subtotal: n(a.p_subtotal), discount: n(a.p_discount),
    discount_reason: a.p_discount_reason ?? "", tax_amount: n(a.p_tax_amount), tax_rate: n(a.p_tax_rate), delivery_fee: n(a.p_delivery_fee),
    amount, delivery_date: a.p_delivery_date, payment_type: a.p_payment_type, payment_status: a.p_payment_status,
    total_quantity: n(a.p_total_quantity), source: a.p_source ?? "web", status: "Processing", notes: a.p_notes ?? null,
    warehouse_id: a.p_warehouse_id ?? null,
  }).select("id").single()) as { id: string };
  const ins = await db().from("b2b_order_items").insert(a.p_items.map((i: any) => ({
    order_id: order.id, product_id: i.product_id, product_name: i.product_name,
    quantity: Number(i.quantity), price: Number(i.price), total: Number(i.total),
  })));
  if (ins.error) {
    await db().from("b2b_orders").delete().eq("id", order.id);
    throw fail(ins.error.message);
  }
  return { success: true, order_id: order.id, order_number: orderNumber };
}

/** RPC get_orders_page(p_page, p_page_size, p_search, p_status, p_payment_status): one page + totals. */
export async function getOrdersPage(a: Record<string, any>) {
  const page = Math.max(Number(a.p_page) || 1, 1);
  const size = Math.min(Math.max(Number(a.p_page_size) || 20, 1), 100);
  const term = (a.p_search ?? "").toString().trim().toLowerCase() || null;
  const status = (a.p_status ?? "").toString().trim().toLowerCase() || null;
  const pay = (a.p_payment_status ?? "").toString().trim().toLowerCase() || null;

  const all = (must(await db().from("b2b_orders").select("*")) as any[])
    .filter((o) => !["cancelled", "voided"].includes(String(o.status || "").toLowerCase()));
  const customers = new Map((must(await db().from("b2b_customers").select("id,name,phone,address")) as any[]).map((c) => [c.id, c]));
  const items = must(await db().from("b2b_order_items").select("order_id,product_name,quantity")) as any[];
  const itemsOf = (id: string) => items.filter((i) => i.order_id === id);

  const base = all.filter((o) => {
    const ps = String(o.payment_status || "").toLowerCase();
    if (status && String(o.status || "").toLowerCase() !== status) return false;
    if (pay && !(pay === "unpaid" ? ["pending", "credit", "partial", "unpaid"].includes(ps) : ps === pay)) return false;
    if (term) {
      const c = customers.get(o.customer_id);
      const hay = [o.order_number, c?.name, c?.phone, c?.address, ...itemsOf(o.id).map((i) => i.product_name)]
        .filter(Boolean).map((s) => String(s).toLowerCase());
      if (!hay.some((h) => h.includes(term))) return false;
    }
    return true;
  }).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));

  const fmtQty = (q: number) => String(Number(q));
  const rows = base.slice((page - 1) * size, page * size).map((o) => {
    const c = customers.get(o.customer_id);
    const its = itemsOf(o.id).sort((x, y) => x.product_name.localeCompare(y.product_name));
    return {
      id: o.id, order_number: o.order_number, customer_id: o.customer_id, date: o.date, amount: o.amount, subtotal: o.subtotal,
      status: o.status, payment_status: o.payment_status, payment_type: o.payment_type, delivery_date: o.delivery_date,
      discount: o.discount, discount_reason: o.discount_reason, delivery_fee: o.delivery_fee, tax_amount: o.tax_amount,
      tax_rate: o.tax_rate, customer_name: c?.name ?? "Unknown Customer", customer_phone: c?.phone ?? "",
      customer_address: c?.address ?? "",
      items_summary: its.length ? its.map((i) => `${i.product_name} (${fmtQty(i.quantity)})`).join(", ") : "0 items",
    };
  });
  const lower = (s: any) => String(s || "").toLowerCase();
  const paid = all.filter((o) => lower(o.payment_status) === "paid");
  const unpaid = all.filter((o) => lower(o.payment_status) !== "paid");
  const sum = (l: any[]) => r2(l.reduce((s, o) => s + Number(o.amount || 0), 0));
  return {
    orders: rows,
    total: base.length,
    stats: {
      totalOrders: all.length,
      processingOrders: all.filter((o) => lower(o.status) === "processing").length,
      pendingPaymentOrders: unpaid.length,
      completedOrders: all.filter((o) => ["completed", "delivered"].includes(lower(o.status))).length,
      totalRevenue: sum(paid), totalPaidAmount: sum(paid), totalUnpaidAmount: sum(unpaid),
    },
  };
}

export const RPCS: Record<string, (args: Record<string, any>) => Promise<unknown>> = {
  check_customer_credit_status: (a) => checkCustomerCreditStatus(a.customer_uuid),
  create_order_with_items: createOrderWithItems,
  get_orders_page: getOrdersPage,
};

// ------------------------------------------------------------------------------------------------
// What the real New Order dialog does in the browser before it calls the RPC (createOrderWithTax.ts).
// The mock's own New Order dialog runs it on the server; an agent calling the API has to do the same steps.
// ------------------------------------------------------------------------------------------------

/** The tax the dialog applies: customer override -> customer type exempt -> type custom rate -> pricing_settings (15). */
export async function taxFor(customerId: string): Promise<{ rate: number; exempt: boolean }> {
  const ps = must(await db().from("b2b_pricing_settings").select("tax_rate").limit(1)) as { tax_rate: number }[];
  const def = Number(ps[0]?.tax_rate ?? 15) || 15;
  const c = must(await db().from("b2b_customers").select("tax_exempt_override, b2b_customer_types(tax_exempt, custom_tax_rate)")
    .eq("id", customerId).maybeSingle()) as any;
  if (!c) return { rate: def, exempt: false };
  if (c.tax_exempt_override === true) return { rate: 0, exempt: true };
  if (c.b2b_customer_types?.tax_exempt === true) return { rate: 0, exempt: true };
  return { rate: c.b2b_customer_types?.custom_tax_rate ?? def, exempt: false };
}

export const blockReason = (s: CreditStatus) =>
  s.is_legal_stage ? "This customer's account is in legal collection stage due to unpaid orders over 15 days."
    : s.has_overdue ? "This customer has overdue credit payments. Please collect outstanding balances before placing new orders."
      : `This customer has exceeded their credit limit of ${s.credit_limit.toLocaleString()} ETB. Current unpaid: ${s.total_unpaid.toLocaleString()} ETB.`;

export type NewOrder = {
  customer: string; paymentType: string; deliveryDate: string; notes?: string;
  products: { product: { id: string; name: string; price: number; unit: string }; quantity: number }[];
};

export async function createOrderWithTax(o: NewOrder): Promise<{ success: boolean; orderNumber?: string; error?: string }> {
  const credit = await checkCustomerCreditStatus(o.customer);
  if ("can_place_order" in credit && !credit.can_place_order) return { success: false, error: blockReason(credit) };
  const subtotal = r2(o.products.reduce((s, p) => s + p.product.price * p.quantity, 0));
  const totalQty = o.products.reduce((s, p) => s + p.quantity, 0);
  const ps = (must(await db().from("b2b_pricing_settings").select("*").limit(1)) as any[])[0] || {};
  const deliveryFee = totalQty >= Number(ps.delivery_fee_threshold_kg ?? 1) ? 0 : Number(ps.delivery_fee_base ?? 0);
  const tax = await taxFor(o.customer);
  const taxAmount = tax.exempt ? 0 : r2(subtotal * tax.rate / 100);
  const pt = (o.paymentType || "").toLowerCase();
  let notes = o.notes || "";
  if (pt === "credit") {
    const c = must(await db().from("b2b_customers").select("agreement_url").eq("id", o.customer).maybeSingle()) as any;
    if (!c?.agreement_url) {
      const warning = "⚠️ Credit order placed without agreement on file";
      notes = notes ? `${notes}\n${warning}` : warning;
    }
  }
  try {
    const r = await createOrderWithItems({
      p_customer_id: o.customer, p_subtotal: subtotal, p_discount: 0, p_discount_reason: null, p_tax_amount: taxAmount,
      p_tax_rate: tax.rate, p_delivery_fee: deliveryFee, p_amount: r2(subtotal + taxAmount + deliveryFee),
      p_delivery_date: o.deliveryDate, p_payment_type: pt, p_payment_status: pt === "credit" ? "credit" : "pending",
      p_total_quantity: totalQty, p_source: "web", p_notes: notes || null,
      p_items: o.products.map((p) => ({ product_id: p.product.id, product_name: p.product.name, quantity: p.quantity,
        price: p.product.price, total: r2(p.product.price * p.quantity) })),
      p_warehouse_id: null,
    });
    return { success: true, orderNumber: r.order_number };
  } catch (e) {
    return { success: false, error: `Failed to create order: ${(e as Error).message}` };
  }
}
