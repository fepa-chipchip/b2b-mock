import { db, must, getSettings, Settings } from "./db";

export type Company = {
  id: number; name: string; customer_type: string; tax_rate: number; credit_limit: number;
  payment_terms_days: number; b2b_unpaid: number; b2b_credit_status: string; admin_wallet_balance: number;
};
type Product = { id: number; name: string; unit: string; b2b_price: number; admin_price: number; min_qty: number; active: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Both systems' view of a company's credit, and what the current setting makes of it for `amount`. */
export function creditCheck(c: Company, amount: number, s: Settings) {
  const owedAdmin = Math.max(0, -Number(c.admin_wallet_balance));
  const admin = {
    system: "Admin wallet",
    owed: r2(owedAdmin),
    available: r2(Math.max(0, Number(c.credit_limit) - owedAdmin)),
    allows: Number(c.admin_wallet_balance) - amount >= -Number(c.credit_limit),
  };
  const b2b = {
    system: "B2B credit status",
    status: c.b2b_credit_status,
    unpaid: r2(Number(c.b2b_unpaid)),
    available: r2(Math.max(0, Number(c.credit_limit) - Number(c.b2b_unpaid))),
    allows: c.b2b_credit_status === "good" && Number(c.b2b_unpaid) + amount <= Number(c.credit_limit),
  };
  const used = s.q2_credit;
  const allowed = used === "admin_wallet" ? admin.allows : used === "b2b_status" ? b2b.allows : admin.allows && b2b.allows;
  return { setting: used, allowed, admin, b2b, amount: r2(amount) };
}

export type OrderInput = {
  inbox_id?: number | null;
  company_id: number;
  location_id?: number | null;
  delivery_date: string;
  notes?: string;
  items: { product_id: number; quantity: number }[];
  dry_run?: boolean;
};

/**
 * Prices an order and, unless dry_run, creates it where the settings say (question 1), checks credit the way
 * they say (question 2) and records who placed the Admin copy (question 3). Idempotent on inbox_id.
 */
export async function placeOrder(input: OrderInput) {
  const s = await getSettings();
  if (input.inbox_id) {
    const prior = must(await db().from("orders").select("*").eq("inbox_id", input.inbox_id).maybeSingle());
    if (prior) return { status: 200, body: { already_created: true, order: prior } };
  }
  const company = must(await db().from("companies").select("*").eq("id", input.company_id).maybeSingle()) as Company | null;
  if (!company) return { status: 404, body: { error: "company_not_found" } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.delivery_date || "")) return { status: 400, body: { error: "delivery_date must be YYYY-MM-DD" } };
  if (!Array.isArray(input.items) || input.items.length === 0) return { status: 400, body: { error: "items is empty" } };

  let location = null;
  if (input.location_id) {
    location = must(await db().from("locations").select("*").eq("id", input.location_id).maybeSingle()) as { id: number; company_id: number; label: string } | null;
    if (!location || location.company_id !== company.id)
      return { status: 400, body: { error: "location_not_of_this_company", hint: "GET /api/agent/companies/{id} lists its locations" } };
  }

  const ids = input.items.map((i) => Number(i.product_id));
  const prods = must(await db().from("products").select("*").in("id", ids)) as Product[];
  const byId = new Map(prods.map((p) => [p.id, p]));
  const problems: string[] = [];
  const lines = input.items.map((i) => {
    const p = byId.get(Number(i.product_id));
    const q = Number(i.quantity);
    if (!p || !p.active) problems.push(`product ${i.product_id} not found`);
    else if (!(q > 0)) problems.push(`${p.name}: quantity must be above 0`);
    else if (q < Number(p.min_qty)) problems.push(`${p.name}: minimum is ${p.min_qty} ${p.unit}`);
    return { p, q };
  });
  if (problems.length) return { status: 400, body: { error: "items_invalid", problems } };

  const items = lines.map(({ p, q }) => ({
    product_id: p!.id, name: p!.name, unit: p!.unit, quantity: q,
    price: Number(p!.b2b_price), total: r2(q * Number(p!.b2b_price)),
    admin_price: Number(p!.admin_price), admin_total: r2(q * Number(p!.admin_price)),
  }));
  const subtotal = r2(items.reduce((a, i) => a + i.total, 0));
  const tax = r2(subtotal * Number(company.tax_rate));
  const total = r2(subtotal + tax);
  const adminSubtotal = r2(items.reduce((a, i) => a + i.admin_total, 0));
  const adminTotal = r2(adminSubtotal * (1 + Number(company.tax_rate)));

  const credit = creditCheck(company, total, s);
  const wantB2B = s.q1_where !== "admin";
  const wantAdmin = s.q1_where !== "b2b";
  const placedAs = s.q3_placed_as === "simenesh" ? "Simenesh (her own Admin account, linked to every company)" : "the customer's own staff account";

  const b2b_copy = wantB2B ? {
    system: "ChipChip B2B",
    order_number: null as string | null,
    status: "Processing",
    payment_type: "credit",
    notes: input.notes || "",
    lines: items.map((i) => ({ name: i.name, unit: i.unit, quantity: i.quantity, price: i.price, total: i.total })),
    subtotal, tax, total,
    triggers: [
      "appears on the Warehouse list for the delivery date",
      "invoice (FS number) is added after delivery",
      `credit follow-up: due ${company.payment_terms_days} days after delivery`,
    ],
  } : null;
  const admin_copy = wantAdmin ? {
    system: "ChipChip Admin",
    status: "PENDING",
    payment_method: "ChipChip Wallet (company credit)",
    placed_as: placedAs,
    delivery_location: location?.label || null,
    rows: items.map((i) => ({ item: `${i.name} x${i.quantity}`, total: r2(i.admin_total * (1 + Number(company.tax_rate))) })),
    total: adminTotal,
    notes_kept: false,
    triggers: [
      "goes to ChipChip delivery like any group order",
      `company wallet debited ${adminTotal} ETB`,
      "one row per product, as Admin shows them today",
    ],
  } : null;

  const preview = { company: company.name, location: location?.label || null, delivery_date: input.delivery_date,
    notes: input.notes || "", items, subtotal, tax, total, settings: s, credit, b2b_copy, admin_copy };
  if (input.dry_run) return { status: 200, body: { dry_run: true, preview } };
  if (!credit.allowed) return { status: 409, body: { error: "credit_refused", preview } };

  const row = must(await db().from("orders").insert({
    inbox_id: input.inbox_id || null, company_id: company.id, location_id: location?.id || null,
    delivery_date: input.delivery_date, notes: input.notes || "", items, subtotal, tax, total,
    b2b_copy, admin_copy, credit_check: credit, placed_as: wantAdmin ? placedAs : null,
  }).select("*").single()) as { id: number; b2b_copy: typeof b2b_copy };

  if (b2b_copy) {
    b2b_copy.order_number = `ORD-MOCK-${row.id}`;
    must(await db().from("orders").update({ b2b_copy }).eq("id", row.id).select("id"));
  }
  must(await db().from("companies").update({
    b2b_unpaid: wantB2B ? r2(Number(company.b2b_unpaid) + total) : company.b2b_unpaid,
    admin_wallet_balance: wantAdmin ? r2(Number(company.admin_wallet_balance) - adminTotal) : company.admin_wallet_balance,
  }).eq("id", company.id).select("id"));
  if (input.inbox_id) must(await db().from("inbox").update({ status: "created", company_id: company.id }).eq("id", input.inbox_id).select("id"));
  return { status: 201, body: { order_id: row.id, preview } };
}
