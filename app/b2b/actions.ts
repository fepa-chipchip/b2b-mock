"use server";
import { revalidatePath } from "next/cache";
import { db, must } from "@/lib/db";
import { checkCustomerCreditStatus, createOrderWithTax, taxFor, NewOrder, CreditStatus } from "@/lib/b2b";

/**
 * The fake B2B's pages run the same server logic as its API (lib/b2b.ts), so what Simenesh does on the page and
 * what the agent does through /b2b/rest/v1 land in the same tables.
 */

/** What the New Order dialog loads when it opens (real: customers + customer_types, products, product_prices, payment_types). */
export async function loadNewOrderData() {
  const customers = must(await db().from("b2b_customers").select("id,name,phone,address,credit_status,agreement_url,customer_type_id, b2b_customer_types(id,name,tax_exempt,custom_tax_rate)")
    .eq("is_active", true).order("name")) as any[];
  const products = must(await db().from("b2b_products").select("id,name,price,unit,quantity,short_description")
    .eq("status", "active").eq("approval_status", "approved").order("name")) as any[];
  const prices = must(await db().from("b2b_product_prices").select("product_id,customer_type,price")) as any[];
  const paymentTypes = must(await db().from("b2b_payment_types").select("name,label").eq("is_active", true).order("name")) as any[];
  const ps = (must(await db().from("b2b_pricing_settings").select("*").limit(1)) as any[])[0] || {};
  return {
    customers: customers.map((c) => ({ ...c, type: c.b2b_customer_types?.name ?? "Unknown" })),
    products: products.map((p) => ({ ...p, price: Number(p.price) })),
    prices: prices.map((p) => ({ ...p, price: Number(p.price) })),
    paymentTypes: paymentTypes.length ? paymentTypes.map((t) => ({ value: t.name, label: t.label }))
      : [{ value: "cash", label: "Cash on Delivery" }, { value: "credit", label: "Credit (Net 30)" }, { value: "prepaid", label: "Pre-paid" }],
    pricing: { tax_rate: Number(ps.tax_rate ?? 15), delivery_fee_base: Number(ps.delivery_fee_base ?? 0), delivery_fee_threshold_kg: Number(ps.delivery_fee_threshold_kg ?? 1) },
  };
}

/** On customer select: the credit RPC (with its self-heal write, as the real dialog) and the customer's tax. */
export async function customerChecks(customerId: string): Promise<{ credit: CreditStatus | null; tax: { rate: number; exempt: boolean } }> {
  const c = await checkCustomerCreditStatus(customerId);
  return { credit: "can_place_order" in c ? c : null, tax: await taxFor(customerId) };
}

export async function createOrder(o: NewOrder) {
  const r = await createOrderWithTax(o);
  if (r.success) revalidatePath("/b2b/orders");
  return r;
}
