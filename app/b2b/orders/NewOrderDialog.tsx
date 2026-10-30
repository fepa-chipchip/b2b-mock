"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, AlertCircle, Loader, ChevronsUpDown, Check, X, Search } from "lucide-react";
import { loadNewOrderData, customerChecks, createOrder } from "../actions";

/**
 * Copy of ChipChip B2B's "Create New Order" dialog (src/components/orders/CreateOrderDialog.tsx and its parts):
 * customer combobox -> "Order Blocked" alert -> "Select products" (nested dialog) -> "Selected Products:" summary ->
 * payment type radios (first one picked) -> delivery date (native, today in UTC) -> "Order Notes (optional)" -> Create Order.
 */

type Data = Awaited<ReturnType<typeof loadNewOrderData>>;
type Credit = Awaited<ReturnType<typeof customerChecks>>["credit"];
type Line = { product: { id: string; name: string; price: number; unit: string }; quantity: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => r2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayUTC = () => new Date().toISOString().split("T")[0];

function StatusBadge({ status }: { status?: string | null }) {
  if (!status || status === "good") return <span className="badge border border-gray-200 bg-green-100 text-green-800">Good Standing</span>;
  if (status === "overdue") return <span className="badge border border-gray-200 bg-amber-100 text-amber-800"><AlertCircle className="w-3 h-3 mr-1" /> Overdue</span>;
  if (status === "suspended") return <span className="badge border border-gray-200 bg-red-100 text-red-800"><AlertCircle className="w-3 h-3 mr-1" /> Suspended</span>;
  if (status === "approved_override") return <span className="badge border border-gray-200 bg-blue-100 text-blue-800">Override Approved</span>;
  if (status === "credit_limit_exceeded") return <span className="badge border border-gray-200 bg-orange-100 text-orange-800"><AlertCircle className="w-3 h-3 mr-1" /> Credit Limit Reached</span>;
  return null;
}

export default function NewOrderDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [customer, setCustomer] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQ, setComboQ] = useState("");
  const [credit, setCredit] = useState<Credit>(null);
  const [tax, setTax] = useState<{ rate: number; exempt: boolean } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [prodOpen, setProdOpen] = useState(false);
  const [prodQ, setProdQ] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(todayUTC());
  const [originalDate] = useState(todayUTC());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    loadNewOrderData().then((d) => {
      setData(d);
      setPaymentType((v) => v || d.paymentTypes[0]?.value || "");
    }).catch((e) => setError(String(e?.message || e)));
  }, [open]);

  const reset = () => {
    setCustomer(""); setCredit(null); setTax(null); setLines([]); setNotes(""); setError(null);
    setDeliveryDate(todayUTC()); setPaymentType(data?.paymentTypes[0]?.value || "");
  };
  const close = () => { setOpen(false); reset(); };

  const selected = data?.customers.find((c) => c.id === customer);
  const customerType: string | null = selected?.type && selected.type !== "Unknown" ? selected.type : null;

  const pick = async (id: string) => {
    setCustomer(id); setComboOpen(false); setComboQ("");
    const r = await customerChecks(id);
    setCredit(r.credit); setTax(r.tax);
  };

  // Price at Add time: product_prices for the customer's type name, else products.price (useProductOperations.ts).
  const priceFor = (p: { id: string; price: number }) =>
    (customerType && data?.prices.find((x) => x.product_id === p.id && x.customer_type === customerType)?.price) ?? p.price;
  const add = (p: Data["products"][number]) => setLines((ls) => {
    const ex = ls.find((l) => l.product.id === p.id);
    if (ex) return ls.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
    return [...ls, { product: { id: p.id, name: p.name, unit: p.unit, price: priceFor(p) }, quantity: 1 }];
  });
  const remove = (id: string) => setLines((ls) => {
    const ex = ls.find((l) => l.product.id === id);
    if (ex && ex.quantity > 1) return ls.map((l) => (l.product.id === id ? { ...l, quantity: l.quantity - 1 } : l));
    return ls.filter((l) => l.product.id !== id);
  });
  const setQty = (id: string, v: string) => {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) return;
    setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, quantity: n } : l)));
  };

  const totalQty = lines.reduce((s, l) => s + Number(l.quantity), 0);
  const deliveryFee = !data || lines.length === 0 ? 0 : totalQty >= data.pricing.delivery_fee_threshold_kg ? 0 : data.pricing.delivery_fee_base;
  const subtotal = r2(lines.reduce((s, l) => s + l.product.price * l.quantity, 0));
  const taxRate = tax ? tax.rate : data?.pricing.tax_rate ?? 15;
  const taxAmount = tax?.exempt ? 0 : r2(subtotal * taxRate / 100);
  const total = r2(subtotal + taxAmount + deliveryFee);

  const creditBlocked = !!credit && !credit.can_place_order;
  const blockReason = credit && !credit.can_place_order
    ? credit.is_legal_stage ? "This customer's account is in legal collection stage. Orders are blocked."
      : credit.has_overdue ? "This customer has overdue credit payments and cannot place new orders."
        : "This customer has exceeded their credit limit and cannot place new orders on credit."
    : null;
  const hasOverride = credit?.credit_status === "approved_override" || selected?.credit_status === "approved_override";
  const agreementWarning = !!selected && !selected.agreement_url;
  const blockedByAgreement = agreementWarning && paymentType === "credit" && !hasOverride;
  const canSubmit = !!customer && lines.length > 0 && !!paymentType && !!deliveryDate && !creditBlocked && !blockedByAgreement;

  const customers = useMemo(() => {
    const q = comboQ.trim().toLowerCase();
    return (data?.customers || []).filter((c) => !q || `${c.name} ${c.address || ""} ${c.phone || ""}`.toLowerCase().includes(q));
  }, [data, comboQ]);
  const products = useMemo(() => {
    const q = prodQ.trim().toLowerCase();
    return (data?.products || []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [data, prodQ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true); setError(null);
    const r = await createOrder({ customer, paymentType, deliveryDate, notes, products: lines });
    setBusy(false);
    if (r.success) {
      setToast(`Order ${r.orderNumber} created successfully!`);
      setTimeout(() => setToast(null), 4000);
      close();
      router.refresh();
    } else setError(r.error || "Failed to create order");
  };

  const availableCredit = credit ? Math.min(credit.credit_limit - credit.total_unpaid, (credit.maximum_unpaid_threshold || 20000) - credit.total_unpaid) : 0;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn"><Plus className="h-4 w-4" /> New Order</button>
      {toast && <div className="fixed top-4 right-4 z-[200] rounded-md border bg-green-50 text-green-800 px-4 py-3 text-sm shadow">{toast}</div>}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-start sm:items-center justify-center p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="relative w-full sm:max-w-[600px] max-h-[90vh] overflow-y-auto rounded-lg border bg-white p-6 shadow-lg">
            <button type="button" onClick={close} className="absolute right-4 top-4 opacity-70 hover:opacity-100" aria-label="Close"><X className="h-4 w-4" /></button>
            <h2 className="text-lg font-semibold leading-none tracking-tight">Create New Order</h2>
            <p className="text-sm text-muted-foreground mt-1.5">Add a new order from an existing customer</p>

            {error && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                <div className="font-medium flex items-center gap-2"><AlertCircle className="h-4 w-4" />Error</div>
                <div>{error}</div>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4 py-2 mt-2">
              {/* Customer combobox */}
              <div className="relative">
                <button type="button" role="combobox" aria-expanded={comboOpen} disabled={!data}
                  onClick={() => setComboOpen((o) => !o)}
                  className="w-full h-10 px-4 rounded-md border border-input bg-white text-sm flex items-center justify-between disabled:opacity-50">
                  {customer ? (
                    <span className="flex items-center gap-2 flex-1 min-w-0"><span className="truncate">{selected?.name}</span><StatusBadge status={credit?.credit_status || selected?.credit_status} /></span>
                  ) : (
                    <span className="text-muted-foreground">{!data ? "Loading customers..." : "Search customer..."}</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </button>
                {comboOpen && (
                  <div className="absolute z-[100] mt-1 w-full rounded-md border bg-white shadow-lg">
                    <div className="flex items-center border-b px-3">
                      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                      <input autoFocus value={comboQ} onChange={(e) => setComboQ(e.target.value)} placeholder="Search customer by name, address, or phone..."
                        className="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground" />
                    </div>
                    <div className="max-h-[300px] overflow-y-auto p-1" role="listbox">
                      {customers.length === 0 && <div className="py-6 text-center text-sm">No customer found.</div>}
                      {customers.map((c) => (
                        <div key={c.id} role="option" aria-selected={customer === c.id} onClick={() => pick(c.id)}
                          className="flex flex-col items-start py-3 px-2 rounded-sm cursor-pointer hover:bg-accent text-sm">
                          <div className="flex w-full items-center justify-between">
                            <div className="flex items-center gap-2"><Check className={`h-4 w-4 ${customer === c.id ? "opacity-100" : "opacity-0"}`} /><span className="font-medium">{c.name}</span></div>
                            <StatusBadge status={c.credit_status} />
                          </div>
                          {c.address && <span className="text-xs text-muted-foreground ml-6 mt-1">📍 {c.address}</span>}
                          {c.phone && <span className="text-xs text-muted-foreground ml-6">📞 {c.phone}</span>}
                          {c.credit_status === "overdue" && <span className="text-xs text-red-600 ml-6 mt-1 font-medium">⚠️ Cannot place orders on credit</span>}
                          {c.credit_status === "suspended" && <span className="text-xs text-red-600 ml-6 mt-1 font-medium">⚠️ Account suspended</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {creditBlocked && blockReason && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                  <div className="font-medium flex items-center gap-2"><AlertCircle className="h-4 w-4" />Order Blocked</div>
                  <div>{blockReason}</div>
                </div>
              )}

              {/* Products */}
              <button type="button" onClick={() => setProdOpen(true)} className="w-full h-auto py-4 px-4 rounded-md border border-input bg-white text-sm flex items-center justify-between hover:bg-accent">
                <span className="text-left">Select products</span>
                {lines.length > 0 && <span className="badge bg-secondary text-secondary-foreground ml-2">{lines.length} selected</span>}
              </button>

              {lines.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="font-medium">Selected Products:</p>
                  {lines.map((l) => (
                    <div key={l.product.id} className="flex justify-between items-center text-sm py-1 border-b">
                      <span>{l.product.name} x {l.quantity} {l.product.unit}</span>
                      <span>ETB {fmt(l.product.price * l.quantity)}</span>
                    </div>
                  ))}
                  <div className="pt-2 space-y-1">
                    <div className="flex justify-between items-center text-sm"><span>Subtotal:</span><span>ETB {fmt(subtotal)}</span></div>
                    {taxAmount > 0 && <div className="flex justify-between items-center text-sm"><span>Tax ({taxRate}%):</span><span>ETB {fmt(taxAmount)}</span></div>}
                    {tax?.exempt && <div className="flex justify-between items-center text-sm text-green-600"><span>Tax (Exempt):</span><span>ETB 0.00</span></div>}
                    {deliveryFee > 0 && <div className="flex justify-between items-center text-sm"><span>Delivery Fee:</span><span>ETB {fmt(deliveryFee)}</span></div>}
                  </div>
                  <div className="pt-2 font-medium flex justify-between border-t"><span>Total:</span><span>ETB {fmt(total)}</span></div>
                </div>
              )}

              {/* Payment type */}
              <div className="space-y-2" role="radiogroup">
                {(data?.paymentTypes || []).map((t) => {
                  const disabled = t.value === "credit" && !!credit && !credit.can_place_order;
                  return (
                    <div key={t.value} className={`flex items-center space-x-2 p-2 rounded ${disabled ? "bg-red-50 border border-red-200" : "hover:bg-gray-50"}`}>
                      <input type="radio" id={t.value} name="paymentType" value={t.value} checked={paymentType === t.value} disabled={disabled}
                        onChange={() => setPaymentType(t.value)} />
                      <label htmlFor={t.value} className={`text-sm font-medium cursor-pointer ${disabled ? "text-gray-400" : ""}`}>{t.label}</label>
                      {disabled && (
                        <span className="ml-2 flex items-center text-red-600 text-xs"><AlertCircle className="h-3 w-3 mr-1" />
                          {credit!.has_overdue ? "Overdue payments must be settled first"
                            : credit!.total_unpaid >= (credit!.maximum_unpaid_threshold || 20000) ? "Maximum unpaid limit (20,000 ETB) reached" : "Credit limit reached"}
                        </span>
                      )}
                    </div>
                  );
                })}
                {paymentType === "credit" && credit?.can_place_order && (
                  <div className="text-xs mt-1 text-muted-foreground">
                    ETB {fmt(availableCredit)} available (Individual limit: ETB {fmt(credit.credit_limit)}, System limit: ETB {fmt(credit.maximum_unpaid_threshold || 20000)})
                  </div>
                )}
              </div>

              {agreementWarning && paymentType === "credit" && (hasOverride ? (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
                  <div className="font-medium text-primary">No Signed Agreement On File</div>
                  <div className="text-muted-foreground">Allowed via approved credit override. Please collect and upload the signed agreement as soon as possible.</div>
                </div>
              ) : (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm">
                  <div className="font-medium text-destructive">Credit Orders Blocked</div>
                  <div className="text-destructive/80">Credit orders require a signed agreement on file. Please upload the agreement first or switch to Prepaid.</div>
                </div>
              ))}

              {/* Delivery date */}
              <div className="space-y-1">
                <input type="date" value={deliveryDate} min={originalDate} onChange={(e) => setDeliveryDate(e.target.value)}
                  className={`field w-full bg-white border ${deliveryDate !== originalDate ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-300"}`} />
                {deliveryDate !== originalDate && <p className="text-xs text-blue-600">Date will be changed from {originalDate} to {deliveryDate}</p>}
                {deliveryDate && deliveryDate < originalDate && <p className="text-xs text-amber-600">Warning: Selected date is in the past</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Order Notes (optional)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Add any special instructions for the warehouse..." className="textarea resize-none" />
              </div>

              <div className="mt-6 pt-4 border-t flex justify-end">
                <button type="submit" disabled={busy || !canSubmit} className="btn w-full sm:w-auto disabled:opacity-50 disabled:pointer-events-none">
                  {busy && <Loader className="h-4 w-4 animate-spin" />}{busy ? "Creating..." : "Create Order"}
                </button>
              </div>
            </form>
          </div>

          {/* Nested "Select Products" dialog */}
          {prodOpen && (
            <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setProdOpen(false)}>
              <div className="relative w-full sm:max-w-[600px] h-[80vh] flex flex-col rounded-lg border bg-white p-6 shadow-lg">
                <button type="button" onClick={() => setProdOpen(false)} className="absolute right-4 top-4 opacity-70 hover:opacity-100" aria-label="Close"><X className="h-4 w-4" /></button>
                <div className="flex flex-col gap-1">
                  <span className="text-lg font-semibold">Select Products</span>
                  <div className="flex flex-col text-sm font-normal text-muted-foreground">
                    <span>{customerType ? `Showing products for ${customerType} customers` : "No customer selected"}</span>
                    <div className="flex items-center gap-2">
                      {customerType && <span className="badge border bg-green-50 text-green-700">General Pricing</span>}
                      <span>{customerType ? `(${data?.products.length ?? 0} products available with standard pricing)` : "Please select a customer first"}</span>
                    </div>
                  </div>
                </div>
                <div className="relative mt-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input value={prodQ} onChange={(e) => setProdQ(e.target.value)} placeholder="Search products..." className="field w-full pl-10" />
                </div>
                <div className="flex-grow overflow-y-auto pr-2 mt-4 space-y-4">
                  {products.map((p) => {
                    const sel = lines.find((l) => l.product.id === p.id);
                    return (
                      <div key={p.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex-1">
                          <h3 className="font-medium">{p.name}</h3>
                          <p className="text-lg font-semibold text-green-600 mt-1">{p.price} ETB/{p.unit}</p>
                          {p.short_description && <p className="text-sm text-gray-600 mt-1">{p.short_description}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          {sel ? (
                            <>
                              <button type="button" className="btn-outline h-9 px-3" onClick={() => remove(p.id)} aria-label="Decrease"><Minus className="h-4 w-4" /></button>
                              <input type="number" value={sel.quantity} min="0" step="0.1" onChange={(e) => setQty(p.id, e.target.value)} className="field w-20 text-center" />
                              <button type="button" className="btn-outline h-9 px-3" onClick={() => add(p)} aria-label="Increase"><Plus className="h-4 w-4" /></button>
                            </>
                          ) : (
                            <button type="button" className="btn" onClick={() => add(p)}>Add</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="pt-4 border-t mt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span>Delivery Fee:</span>
                    <div className="flex items-center"><input type="number" value={deliveryFee} readOnly className="field w-24 h-8 bg-gray-100" /><span className="ml-2">ETB</span></div>
                  </div>
                  {lines.length > 0 && <div className="text-xs text-gray-500">{deliveryFee === 0 ? "Free delivery! (Order quantity exceeds 100kg)" : "Orders over 100kg qualify for free delivery"}</div>}
                  <div className="flex justify-between items-center w-full">
                    <div className="font-medium">Total: <span className="text-lg">ETB {(subtotal + deliveryFee).toFixed(2)}</span></div>
                    <button type="button" className="btn" onClick={() => setProdOpen(false)}>Done</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
