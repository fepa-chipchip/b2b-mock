"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, ShoppingCart, Loader } from "lucide-react";
import { loadPlaceOrder, refreshCart, addToCart, changeCart, billFor, placeOrderAction } from "../../../../actions";
import { StatusBadge } from "../../../../Badges";

/**
 * Copy of ChipChip Admin's Place Order screen (src/components/pages/b2b/B2BPlaceOrder.tsx): "Place Order — <user>",
 * "1. Choose Products" (search, Add / − / +), "2. Review & Order" (CAN SPEND, Limit, Owed; QTY / UNIT / TOTAL ETB with ×;
 * Subtotal, server bill lines, Total to pay; Delivery Location; Include packaging; Payment Method; Place Order),
 * "Order placed" dialog and "Placed Orders". Each action is the same call the real page makes (groups, carts, bill, checkout).
 */

type Loaded = Extract<Awaited<ReturnType<typeof loadPlaceOrder>>, { ok: true }>["data"];
type Bill = Record<string, string | boolean>;

const fmt = (v: unknown) => { const n = Number(v); return isNaN(n) ? "—" : n.toLocaleString(); };
const b2bDeal = (p: Loaded["products"][number]) => p.group_deals.find((d) => d.deal_type === "B2B") || null;

export default function PlaceOrder({ companyId, userId }: { companyId: string; userId: string }) {
  const [d, setD] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [addQty, setAddQty] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [withPackaging, setWithPackaging] = useState(true);
  const [bill, setBill] = useState<Bill | null>(null);
  const [placing, setPlacing] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; text?: string; icon: "success" | "error" | "warning"; confirm?: () => void } | null>(null);
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    if (!userId) { setLoadError("No user chosen. Open Place Order from a company's Linked Users."); return; }
    loadPlaceOrder(userId, companyId).then((r) => {
      if (!r.ok) { setLoadError(r.error); return; }
      setD(r.data);
      if (r.data.locations[0]) setLocationId(r.data.locations[0].id);
    });
  }, [userId, companyId]);

  const cart = d?.cart || [];
  const cartSig = cart.map((c) => `${c.id}:${c.quantity}`).join(",");
  useEffect(() => {
    if (!d || cart.length === 0 || !locationId) { setBill(null); return; }
    billFor(d.shopper.id, cart.map((c) => ({ cart_id: c.id, group_id: c.group_id })), locationId, withPackaging)
      .then((r) => setBill(r.ok ? (r.data as unknown as Bill) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSig, locationId, withPackaging]);

  const reload = async () => {
    if (!d) return;
    const r = await refreshCart(d.shopper.id, companyId);
    if (r.ok) setD({ ...d, ...r.data });
  };

  const setQuantity = async (productId: string, dealId: string, target: number) => {
    if (!d) return;
    const existing = cart.find((c) => c.product_id === productId);
    setBusyId(productId);
    const r = existing
      ? await changeCart(d.shopper.id, existing.group_id, target - existing.quantity)
      : await addToCart(d.shopper.id, dealId, target);
    setBusyId(null);
    if (!r.ok) setDialog({ title: existing ? "Could not change the quantity" : "Could not add this product", text: r.error, icon: "error" });
    await reload();
  };

  const products = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.products || []).filter((p) => b2bDeal(p) && (!t || p.name.toLowerCase().includes(t)));
  }, [d, q]);

  const cartTotal = cart.reduce((s, c) => s + Number(c.item_total_price), 0);
  const billTotal = Number(bill?.total);
  const hasBill = Number.isFinite(billTotal);
  const totalToPay = hasBill ? billTotal : cartTotal;
  const billLines = (() => {
    if (!bill) return [] as { label: string; amount: number }[];
    const c = [
      { label: "Delivery charge", amount: Number(bill.delivery_charge) }, { label: "Packaging fee", amount: Number(bill.packaging_fee) },
      { label: "Plastic bag fee", amount: Number(bill.plastic_bag_fee) },
      { label: Number(bill.tax_rate) ? `Tax (${Number(bill.tax_rate)}%)` : "Tax", amount: Number(bill.tax) },
      { label: "Discount", amount: -Number(bill.discount) },
    ].filter((l) => Number.isFinite(l.amount) && l.amount !== 0);
    const residual = Number((Number(bill.total) - Number(bill.subtotal) - c.reduce((s, l) => s + l.amount, 0)).toFixed(2));
    if (residual !== 0) c.push({ label: "Other charges", amount: residual });
    return c;
  })();
  const st = d?.statement;
  const spendingPower = st ? Number(st.balance) + Number(st.credit_limit) : null;
  const exceedsCredit = spendingPower !== null && cart.length > 0 && totalToPay > spendingPower;

  const doPlace = async () => {
    if (!d) return;
    setPlacing(true);
    const r = await placeOrderAction(d.shopper.id, {
      account_number: "", b2b_customer_id: companyId, delivery_note: "", device: "", group_cart_ids: cart.map((c) => c.id),
      location_id: locationId, payment_method_id: methodId, platform: "web", willingness: true, with_packaging: withPackaging,
    });
    setPlacing(false);
    if (r.ok) { setPlaced(true); setDialog({ title: "Order placed", icon: "success" }); }
    else setDialog({ title: r.error || "Failed to place the order", icon: "error" });
    await reload();
  };
  const placeOrder = () => {
    if (cart.length === 0) return setDialog({ title: "The cart is empty", icon: "error" });
    if (!locationId) return setDialog({ title: "Select a delivery location", icon: "error" });
    if (!methodId) return setDialog({ title: "Select a payment method", icon: "error" });
    if (exceedsCredit) {
      return setDialog({
        title: "Exceeds available credit", icon: "warning",
        text: `This order (${totalToPay.toFixed(2)} ETB) is more than the company can spend (${fmt(spendingPower)} ETB, being its balance plus its credit limit). The checkout will likely be rejected. Continue anyway?`,
        confirm: () => { setDialog(null); doPlace(); },
      });
    }
    doPlace();
  };

  if (loadError) return (
    <div className="rounded-xl border bg-white p-6 text-sm">
      <div className="font-semibold text-gray-900">Failed to load the selected user</div>
      <div className="text-gray-600 mt-1">{loadError}</div>
      <a className="btn-outline mt-3" href={`/admin/dashboard/b2b/${companyId}`}>OK</a>
    </div>
  );

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="rounded-xl border bg-white shadow-sm p-4 flex items-center gap-3">
        <a href={`/admin/dashboard/b2b/${companyId}`} className="btn-outline h-8 text-[12px]"><ArrowLeft size={14} /> Back</a>
        <div className="flex flex-col gap-1">
          <span className="font-bold text-[18px] text-gray-900">Place Order{d ? ` — ${d.shopper.name}` : ""}</span>
          <span className="text-[11px] text-gray-500">{d?.shopper.phone && `+${d.shopper.phone}`}{d?.company && ` • ${d.company.business_name}`}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="rounded-xl border bg-white shadow-sm p-4 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="font-bold text-[15px] text-gray-900">1. Choose Products</span>
            <span className="text-[11px] text-gray-500">Only products with a B2B deal are listed. Search for an item and click &quot;Add&quot; to put it in the cart. Use − / + to adjust the quantity.</span>
          </div>
          <div className="relative w-full">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" className="field w-full pl-9" placeholder="Search products by name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[55vh] overflow-auto flex flex-col gap-2 pr-1">
            {!d && <div className="text-[12px] text-gray-500 p-2">Loading…</div>}
            {d && products.length === 0 && <span className="text-[12px] text-gray-500 p-2">No B2B-deal products found.</span>}
            {products.map((p) => {
              const deal = b2bDeal(p)!;
              const minQty = Math.max(1, Number(deal.min_quantity_per_order) || 1);
              const inCart = cart.find((c) => c.product_id === p.id)?.quantity || 0;
              const busy = busyId === p.id;
              return (
                <div key={p.id} className="flex items-center gap-3 border border-gray-100 rounded-lg p-2 hover:border-gray-200">
                  <div className="h-10 w-10 rounded-lg bg-gray-100 shrink-0" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[13px] font-semibold text-gray-900 truncate">{p.name}</span>
                    <span className="text-[11px] text-gray-500"><span className="text-[12px] font-bold text-gray-700">{Number(deal.group_price)} ETB{p.measuring_unit && ` / ${p.measuring_unit}`}</span>{minQty > 1 && ` • min ${minQty}`}</span>
                  </div>
                  {inCart === 0 ? (
                    <div className="flex items-center gap-2">
                      <input type="number" min={minQty} value={addQty[p.id] ?? String(minQty)} onChange={(e) => setAddQty({ ...addQty, [p.id]: e.target.value })}
                        className="border border-gray-300 rounded-lg w-14 h-8 px-1 text-[12px] text-center" title={`Quantity (min ${minQty})`} />
                      <button type="button" disabled={busy} onClick={() => setQuantity(p.id, deal.id, Math.max(0, Number(addQty[p.id] ?? minQty) || 0))}
                        className="h-8 px-3 rounded-lg bg-green-600 text-white text-[12px] font-medium hover:bg-green-700 disabled:opacity-50">{busy ? "…" : "Add"}</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button type="button" disabled={busy || inCart <= minQty} onClick={() => setQuantity(p.id, deal.id, inCart - 1)}
                        className="h-7 w-7 rounded-lg border border-gray-300 text-gray-700 text-[15px] leading-none disabled:opacity-40" aria-label="Decrease quantity">−</button>
                      <span className="w-12 h-7 inline-flex items-center justify-center border border-gray-300 rounded-lg text-[12px]">{inCart}</span>
                      <button type="button" disabled={busy} onClick={() => setQuantity(p.id, deal.id, inCart + 1)}
                        className="h-7 w-7 rounded-lg border border-gray-300 text-gray-700 text-[15px] leading-none disabled:opacity-40" aria-label="Increase quantity">+</button>
                      <span className="w-4">{busy && <Loader className="h-3 w-3 animate-spin text-red-600" />}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border bg-white shadow-sm p-4 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="font-bold text-[15px] text-gray-900">2. Review &amp; Order</span>
            <span className="text-[11px] text-gray-500">Check the items, pick the delivery location and payment method, then place the order.</span>
          </div>
          {st && (
            <div className={`rounded-xl border p-3 flex items-center justify-between ${exceedsCredit ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
              <div className="flex flex-col">
                <span className="text-[11px] text-gray-500 uppercase tracking-wide">Can Spend</span>
                <span className={`font-bold text-[16px] tabular-nums ${exceedsCredit ? "text-red-600" : "text-gray-900"}`}>{fmt(spendingPower)} ETB</span>
              </div>
              <div className="flex flex-col text-right text-[11px] text-gray-500">
                <span>Limit {fmt(st.credit_limit)}</span>
                {Number(st.balance) > 0 ? <span>Balance +{fmt(st.balance)}</span> : <span>Owed {fmt(st.amount_owed)}</span>}
              </div>
            </div>
          )}
          {exceedsCredit && <span className="text-[11px] text-red-600">This order ({totalToPay.toFixed(2)} ETB) is more than the company can spend ({fmt(spendingPower)} ETB) — checkout may be rejected.</span>}

          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50/60 py-8 px-4 text-center">
              <ShoppingCart size={28} className="text-gray-300" />
              <span className="text-[13px] font-semibold text-gray-700">Your cart is empty</span>
              <span className="text-[12px] text-gray-500 max-w-[15rem]">Pick products from the list on the left and set a quantity to start this order.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200 pb-1">
                <span className="flex-1">Item</span><span className="w-10 text-center shrink-0">Qty</span><span className="w-20 shrink-0">Unit</span>
                <span className="w-20 text-right shrink-0">Total ETB</span><span className="w-6 shrink-0" />
              </div>
              <div className="max-h-[15rem] overflow-y-auto">
                {cart.map((c) => (
                  <div key={c.id} className="flex items-center gap-1 text-[12px] border-b border-gray-100 py-1.5">
                    <span className="truncate flex-1 text-gray-800">{c.name}</span>
                    <span className="w-10 shrink-0 text-center text-[13px] font-bold text-gray-800 tabular-nums">{c.quantity}</span>
                    <span className="w-20 shrink-0 text-[11px] font-semibold text-gray-600">{c.measuring_unit || "—"}</span>
                    <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{Number(c.item_total_price).toFixed(2)}</span>
                    <button type="button" title="Remove from cart" aria-label={`Remove ${c.name} from cart`} disabled={busyId === c.product_id}
                      onClick={() => setQuantity(c.product_id, c.group_deal.id, 0)}
                      className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded bg-red-600 text-white text-[14px] font-bold hover:bg-red-700 disabled:opacity-40">×</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[12px] py-1">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-semibold tabular-nums">{(hasBill ? Number(bill?.subtotal) : cartTotal).toFixed(2)} ETB</span>
              </div>
              {hasBill ? (
                <>
                  {billLines.map((l) => (
                    <div key={l.label} className="flex items-center justify-between text-[12px] py-1">
                      <span className="text-gray-500">{l.label}</span>
                      <span className={`font-semibold tabular-nums ${l.amount < 0 ? "text-green-600" : ""}`}>{l.amount.toFixed(2)} ETB</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-[14px] py-2 border-t border-gray-200">
                    <span className="font-bold">Total to pay</span><span className="font-bold tabular-nums">{totalToPay.toFixed(2)} ETB</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between text-[14px] py-2 border-t border-gray-200">
                  <span className="font-bold">Estimated total</span><span className="font-bold tabular-nums">{cartTotal.toFixed(2)} ETB</span>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-semibold text-gray-700">Delivery Location</label>
            {d && d.locations.length === 0 ? (
              <span className="text-[11px] text-red-600">This user has no saved delivery locations. Ask them to add one in the app first.</span>
            ) : (
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="field w-full">
                {(d?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.location_title && !l.name.toLowerCase().includes(String(l.location_title).toLowerCase()) ? `${l.name} (${l.location_title})` : l.name}</option>)}
              </select>
            )}
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={withPackaging} onChange={(e) => setWithPackaging(e.target.checked)} />
            <span className="flex flex-col">
              <span className="text-[12px] font-semibold text-gray-700">Include packaging</span>
              <span className="text-[11px] text-gray-500">Adds a packaging fee unless the product is exempt.</span>
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-semibold text-gray-700">Payment Method</label>
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className="field w-full">
              <option value="">Select payment method</option>
              {(d?.methods || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {!placed ? (
            cart.length > 0 && locationId && methodId ? (
              <button type="button" onClick={placeOrder} disabled={placing} className="btn w-full h-11 text-[14px] bg-red-600 hover:bg-red-700">
                {placing && <Loader className="h-4 w-4 animate-spin" />}Place Order
              </button>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 flex flex-col gap-3">
                <span className="text-[13px] font-semibold text-gray-900">Complete these to place the order</span>
                {[[cart.length > 0, "Add at least one product to the cart"], [!!locationId, "Choose a delivery location"], [!!methodId, "Choose a payment method"]].map(([done, label]) => (
                  <div key={String(label)} className="flex items-center gap-2.5">
                    <span className={`flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold ${done ? "bg-green-600 text-white" : "bg-white border-2 border-gray-300 text-transparent"}`}>✓</span>
                    <span className={`text-[12px] ${done ? "text-gray-900 font-medium" : "text-gray-500"}`}>{label}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-gray-900">Order placed</span>
              <span className="text-[11px] text-gray-500">Its status is in Placed Orders below - use Refresh there for the latest.</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-white shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-bold text-[15px] text-gray-900">Placed Orders</span>
            <span className="text-[11px] text-gray-500">The most recent orders on this account, newest first.</span>
          </div>
          <button type="button" className="btn-outline h-8 text-[12px]" onClick={reload}>Refresh</button>
        </div>
        <div className="max-h-[40vh] overflow-auto w-full">
          {(d?.orders || []).length === 0 ? <div className="text-[12px] text-gray-500 p-3">No orders placed yet.</div> : (
            <table className="tbl text-[13px]">
              <thead><tr><th>Date</th><th>Items</th><th>Delivery Location</th><th className="num">Total</th><th className="!text-center">Status</th></tr></thead>
              <tbody>
                {d!.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="text-gray-600 whitespace-nowrap">{new Date(o.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}</td>
                    <td>{o.item.name} x{o.item.quantity}</td>
                    <td>{o.delivery_address.delivery_location.name || "—"}</td>
                    <td className="num font-medium tabular-nums">{o.total_amount} ETB</td>
                    <td className="text-center"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg text-center">
            <div className={`mx-auto mb-3 h-14 w-14 rounded-full border-4 flex items-center justify-center text-2xl ${dialog.icon === "success" ? "border-green-300 text-green-600" : dialog.icon === "warning" ? "border-amber-300 text-amber-500" : "border-red-300 text-red-600"}`}>
              {dialog.icon === "success" ? "✓" : dialog.icon === "warning" ? "!" : "×"}
            </div>
            <div className="text-lg font-semibold text-gray-900">{dialog.title}</div>
            {dialog.text && <div className="text-sm text-gray-600 mt-2">{dialog.text}</div>}
            <div className="mt-5 flex justify-center gap-2">
              {dialog.confirm ? (
                <>
                  <button type="button" className="btn" onClick={dialog.confirm}>Continue</button>
                  <button type="button" className="btn-outline" onClick={() => setDialog(null)}>Cancel</button>
                </>
              ) : <button type="button" className="btn" onClick={() => setDialog(null)}>OK</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
