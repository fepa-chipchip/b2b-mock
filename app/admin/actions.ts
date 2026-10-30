"use server";
import { revalidatePath } from "next/cache";
import * as A from "@/lib/admin";

/**
 * The fake Admin's pages run the same server logic as its API (lib/admin.ts). The Place Order page acts as the chosen
 * linked user, the way the real page acts with that user's shopper token.
 */

type R<T> = { ok: true; data: T } | { ok: false; error: string };
async function wrap<T>(f: () => Promise<T>): Promise<R<T>> {
  try { return { ok: true, data: await f() }; }
  catch (e) { return { ok: false, error: e instanceof A.AdminError ? e.message : (e as Error).message || "Something went wrong" }; }
}

export async function linkUserAction(form: FormData) {
  const companyId = String(form.get("company_id"));
  const pickedRaw = String(form.get("user") || "");
  const role = String(form.get("role") || "MEMBER");
  // The picker shows "Name · +2519…"; take the phone back out of it.
  const phone = (pickedRaw.match(/\+?(\d{9,})/) || [])[1];
  if (!phone) return;
  try {
    const { user } = await A.findUser(phone);
    await A.linkUser(companyId, user.id, role);
  } catch { /* unknown user: nothing linked, as the real "Please select a user" */ }
  revalidatePath(`/admin/dashboard/b2b/${companyId}`);
}

export async function unlinkUserAction(form: FormData) {
  const companyId = String(form.get("company_id"));
  await A.unlinkUser(companyId, String(form.get("user_id")));
  revalidatePath(`/admin/dashboard/b2b/${companyId}`);
}

export async function loadPlaceOrder(userId: string, companyId: string) {
  return wrap(async () => {
    const { user } = await A.findUser(userId);
    const company = await A.getCompany(companyId);
    const [products, cart, locations, methods, statement, orders] = await Promise.all([
      A.listProducts({ activeOnly: true, perPage: 1000 }), A.cartOf(user.id), A.locationsOf(user.id), A.paymentMethods(),
      A.statement(companyId), A.ordersOf(user.id, 1, 10),
    ]);
    return { shopper: { id: user.id, name: user.name, phone: user.phone }, company, products: products.rows, cart, locations, methods, statement, orders: orders.rows };
  });
}

export async function refreshCart(userId: string, companyId: string) {
  return wrap(async () => ({ cart: await A.cartOf(userId), statement: await A.statement(companyId), orders: (await A.ordersOf(userId, 1, 10)).rows }));
}

export async function addToCart(userId: string, dealId: string, quantity: number) {
  return wrap(() => A.createGroup(userId, dealId, quantity));
}

export async function changeCart(userId: string, groupId: string, delta: number) {
  return wrap(() => A.updateGroupCart(userId, groupId, delta));
}

export async function billFor(userId: string, items: { cart_id: string; group_id: string }[], locationId: string, withPackaging: boolean) {
  return wrap(() => A.bill(userId, items.map((i) => ({ ...i, location_id: locationId, deliver_by_admin: false, pickup_from_admin: false, with_packaging: withPackaging }))));
}

export async function placeOrderAction(userId: string, body: A.CheckoutBody) {
  const r = await wrap(() => A.checkout(userId, body));
  if (r.ok) revalidatePath("/admin/dashboard/b2b", "layout");
  return r;
}
