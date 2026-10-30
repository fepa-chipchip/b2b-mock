import { Suspense } from "react";
import { ShoppingCart, Clock, DollarSign, CheckCircle, Banknote, CreditCard, Eye, Receipt, Package, X } from "lucide-react";
import { db, must } from "@/lib/db";
import { getOrdersPage } from "@/lib/b2b";
import Feedback from "../../Feedback";
import NewOrderDialog from "./NewOrderDialog";
import OrdersSearch from "./OrdersSearch";

export const dynamic = "force-dynamic";

/**
 * Copy of ChipChip B2B's Orders page (src/pages/OrdersOptimized.tsx): heading + "New Order", six stats cards,
 * search + filters, the orders table (20 per page, from RPC get_orders_page) and "View Details".
 */

const statusColor = (s: string) => ({ completed: "bg-green-100 text-green-800", processing: "bg-blue-100 text-blue-800",
  pending: "bg-yellow-100 text-yellow-800", cancelled: "bg-red-100 text-red-800" } as Record<string, string>)[(s || "").toLowerCase()] || "bg-gray-100 text-gray-800";
const payColor = (s: string) => ({ paid: "bg-green-100 text-green-800", pending: "bg-amber-100 text-amber-800",
  credit: "bg-blue-100 text-blue-800" } as Record<string, string>)[(s || "").toLowerCase()] || "bg-gray-100 text-gray-800";
const ago = (d: string) => {
  const days = Math.floor((Date.now() - Date.parse(d)) / 86400_000);
  if (days >= 1) return `${days} day${days > 1 ? "s" : ""} ago`;
  const h = Math.floor((Date.now() - Date.parse(d)) / 3600_000);
  return h >= 1 ? `about ${h} hour${h > 1 ? "s" : ""} ago` : "less than an hour ago";
};
const longDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Africa/Addis_Ababa" });

type SP = { search?: string; status?: string; payment?: string; page?: string; view?: string };

export default async function Orders({ searchParams }: { searchParams: SP }) {
  const page = Math.max(1, Number(searchParams.page || 1));
  const data = await getOrdersPage({ p_page: page, p_page_size: 20, p_search: searchParams.search || null,
    p_status: searchParams.status || null, p_payment_status: searchParams.payment || null });
  const s = data.stats;
  const cards = [
    { title: "Total Orders", value: s.totalOrders.toLocaleString(), icon: ShoppingCart, color: "text-blue-600", bg: "bg-blue-50", desc: "All time orders" },
    { title: "Processing", value: s.processingOrders.toLocaleString(), icon: Clock, color: "text-orange-600", bg: "bg-orange-50", desc: "Orders to fulfill" },
    { title: "Pending Payment", value: s.pendingPaymentOrders.toLocaleString(), icon: DollarSign, color: "text-amber-600", bg: "bg-amber-50", desc: "Awaiting payment" },
    { title: "Completed", value: s.completedOrders.toLocaleString(), icon: CheckCircle, color: "text-green-600", bg: "bg-green-50", desc: "Successfully delivered" },
    { title: "Total Paid", value: `${s.totalPaidAmount.toLocaleString()} ETB`, icon: Banknote, color: "text-green-700", bg: "bg-green-50", desc: "Paid orders total" },
    { title: "Total Unpaid", value: `${s.totalUnpaidAmount.toLocaleString()} ETB`, icon: CreditCard, color: "text-red-600", bg: "bg-red-50", desc: "Unpaid orders total" },
  ];
  const totalPages = Math.max(1, Math.ceil(data.total / 20));
  const link = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...extra })) if (v) p.set(k, v);
    return `/b2b/orders?${p.toString()}`;
  };

  return (
    <>
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">Orders</h2>
          <p className="text-gray-600 mt-1">Manage all your orders efficiently</p>
        </div>
        <NewOrderDialog />
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map(({ title, value, icon: Icon, color, bg, desc }) => (
          <div key={title} className="card relative overflow-hidden hover:shadow-md transition-shadow duration-200">
            <div className="flex flex-row items-center justify-between space-y-0 p-4 md:p-6 pb-2 md:pb-2">
              <div className="text-sm font-medium text-gray-700">{title}</div>
              <div className={`p-2 rounded-lg ${bg}`}><Icon className={`h-4 w-4 ${color}`} /></div>
            </div>
            <div className="px-4 md:px-6 pb-4 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-gray-900 mb-1 break-words">{value}</div>
              <p className="text-xs text-gray-500">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg p-4 md:p-6 shadow-sm border">
        <Suspense><OrdersSearch /></Suspense>
      </div>

      {data.orders.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 text-center">
          <div className="mx-auto max-w-sm">
            <div className="mx-auto h-24 w-24 rounded-full bg-gray-100 flex items-center justify-center mb-4"><Receipt className="h-12 w-12 text-gray-400" /></div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No orders found</h3>
            <p className="text-gray-500">No orders match your current filters. Try adjusting your search criteria.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr className="border-b-2">
                  {["Order", "Customer", "Date", "Status", "Payment"].map((h) => <th key={h} className="!text-gray-900 font-semibold">{h}</th>)}
                  <th className="!text-gray-900 font-semibold text-right">Amount</th>
                  <th className="!text-gray-900 font-semibold w-[100px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">
                      <div className="font-semibold text-gray-900 whitespace-nowrap">{o.order_number}</div>
                      <div className="text-sm text-gray-500 truncate max-w-[150px]" title={o.items_summary}>{o.items_summary}</div>
                    </td>
                    <td>
                      <div className="font-medium text-gray-900">{o.customer_name}</div>
                      {o.customer_phone && <div className="text-sm text-gray-500">{o.customer_phone}</div>}
                    </td>
                    <td>
                      <div className="text-sm font-medium text-gray-900 whitespace-nowrap">{new Date(o.date).toLocaleDateString("en-US")}</div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">{ago(o.date)}</div>
                    </td>
                    <td><span className={`badge ${statusColor(o.status)}`}>{o.status}</span></td>
                    <td><span className={`badge ${payColor(o.payment_status)}`}>{o.payment_status}</span></td>
                    <td className="num"><div className="font-semibold text-gray-900">{Number(o.amount).toLocaleString()} ETB</div></td>
                    <td><a href={link({ view: o.id })} className="btn-outline h-8"><Eye className="h-4 w-4" />View Details</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          {page > 1 && <a className="btn-outline" href={link({ page: String(page - 1), view: undefined })}>Previous</a>}
          <span className="text-sm text-gray-600 self-center">Page {page} of {totalPages}</span>
          {page < totalPages && <a className="btn-outline" href={link({ page: String(page + 1), view: undefined })}>Next</a>}
        </div>
      )}

      {searchParams.view && <Details id={searchParams.view} close={link({ view: undefined })} />}
    </>
  );
}

/** "Order Details - ORD-…" (EnhancedOrderDetailsDialog.tsx, reduced): dates, status, customer, items, financial summary. */
async function Details({ id, close }: { id: string; close: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const o = must(await db().from("b2b_orders").select("*, b2b_customers(name,phone,address, b2b_customer_types(name)), b2b_order_items(*, b2b_products(unit,weight))")
    .eq("id", id).maybeSingle()) as any;
  if (!o) return null;
  const fb = must(await db().from("feedback").select("*").eq("about", `b2b-order:${o.order_number}`).order("id")) as any[];
  const items = (o.b2b_order_items || []) as any[];
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-start sm:items-center justify-center p-2 sm:p-4">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border bg-white p-6 shadow-lg">
        <a href={close} className="absolute right-4 top-4 opacity-70 hover:opacity-100" aria-label="Close"><X className="h-4 w-4" /></a>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Package className="h-5 w-5" />Order Details - {o.order_number}</h2>
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="space-y-3">
            <div><p className="text-sm font-medium text-muted-foreground">Order Date</p><p className="font-medium">{longDate(o.date)}</p></div>
            {o.delivery_date && <div><p className="text-sm font-medium text-muted-foreground">Delivery Date</p><p className="font-medium">{longDate(o.delivery_date)}</p></div>}
          </div>
          <div className="space-y-3">
            <div><p className="text-sm font-medium text-muted-foreground">Status</p><span className={`badge border ${statusColor(o.status)}`}>{o.status}</span></div>
            <div><p className="text-sm font-medium text-muted-foreground">Payment</p>
              <span className={`badge border ${payColor(o.payment_status)}`}>{o.payment_status}</span> <span className="text-sm text-muted-foreground">({o.payment_type})</span></div>
          </div>
        </div>
        <hr className="my-6" />
        <h3 className="text-lg font-semibold mb-3">Customer Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium">{o.b2b_customers?.name}</span>
            {o.b2b_customers?.b2b_customer_types?.name && <span className="ml-2 bg-gray-50 px-2 py-1 rounded text-gray-700">{o.b2b_customers.b2b_customer_types.name}</span>}
            {o.b2b_customers?.phone && <p className="text-muted-foreground">Phone: {o.b2b_customers.phone}</p>}
          </div>
          {o.b2b_customers?.address && <div><p className="font-medium text-muted-foreground">Address</p><p>{o.b2b_customers.address}</p></div>}
        </div>
        <hr className="my-6" />
        <h3 className="text-lg font-semibold mb-3">Order Items</h3>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Product</th><th className="!text-center">Quantity</th><th className="!text-center">Unit</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.product_name}</td><td className="text-center">{Number(i.quantity)}</td>
                  <td className="text-center">{i.b2b_products?.unit || "pcs"}</td><td className="num">ETB {Number(i.price).toFixed(2)}</td>
                  <td className="num font-medium">ETB {Number(i.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <hr className="my-6" />
        <h3 className="text-lg font-semibold mb-3">Financial Summary</h3>
        <div className="max-w-md ml-auto space-y-2 text-sm">
          <div className="flex justify-between"><span>Subtotal:</span><span>ETB {Number(o.subtotal).toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Tax ({Number(o.tax_rate)}%):</span><span>ETB {Number(o.tax_amount).toFixed(2)}</span></div>
          {Number(o.delivery_fee) > 0 && <div className="flex justify-between"><span>Delivery Fee:</span><span>ETB {Number(o.delivery_fee).toFixed(2)}</span></div>}
          <div className="flex justify-between font-semibold border-t pt-2"><span>Total:</span><span>ETB {Number(o.amount).toFixed(2)}</span></div>
        </div>
        {o.notes && <div className="mt-4 text-sm"><p className="font-medium text-muted-foreground">Notes</p><p className="whitespace-pre-wrap">{o.notes}</p></div>}
        <Feedback about={`b2b-order:${o.order_number}`} given={fb} />
      </div>
    </div>
  );
}
