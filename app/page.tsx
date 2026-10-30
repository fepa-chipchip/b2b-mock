import { ShoppingCart, CalendarCheck, Clock, MessageSquare, Eye } from "lucide-react";
import { db, must } from "@/lib/db";
import Feedback from "./Feedback";

export const dynamic = "force-dynamic";

const etb = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addis = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" });
const addisDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Africa/Addis_Ababa" });

/** Same colours as ChipChip B2B's orders table. */
const statusColor = (s: string) => {
  switch ((s || "").toLowerCase()) {
    case "completed": return "bg-green-100 text-green-800";
    case "processing": return "bg-blue-100 text-blue-800";
    case "pending": return "bg-yellow-100 text-yellow-800";
    case "cancelled": return "bg-red-100 text-red-800";
    default: return "bg-gray-100 text-gray-800";
  }
};

/** Every order the agent created, as each system would hold it, with Simenesh's ✅ / ❌. */
export default async function Orders() {
  const orders = must(await db().from("orders").select("*, companies(name), locations(label)").order("id", { ascending: false }).limit(50)) as any[];
  const fb = must(await db().from("feedback").select("*").like("about", "order:%").order("id")) as any[];
  const waiting = await db().from("inbox").select("id", { count: "exact", head: true }).eq("status", "proposed");
  const today = addisDay(new Date());
  const stats = [
    { title: "Total orders", am: "ጠቅላላ ትዕዛዞች", value: orders.length, desc: "Created by the agent", icon: ShoppingCart, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "Created today", am: "ዛሬ የተፈጠሩ", value: orders.filter((o) => addisDay(o.created_at) === today).length, desc: "Since this morning", icon: CalendarCheck, color: "text-green-600", bg: "bg-green-50" },
    { title: "Waiting for your yes", am: "ፈቃድዎን የሚጠብቁ", value: waiting.count ?? 0, desc: "On the Received page", icon: Clock, color: "text-orange-600", bg: "bg-orange-50" },
    { title: "Feedback given", am: "የተሰጡ አስተያየቶች", value: fb.length, desc: "Your ✅ / ❌ on orders", icon: MessageSquare, color: "text-amber-600", bg: "bg-amber-50" },
  ];
  return (
    <>
      <div>
        <h2 className="page-title">Orders created by the agent</h2>
        <div className="am">ወኪሉ የፈጠራቸው ትዕዛዞች</div>
        <p className="page-sub">
          Each order shows what ChipChip B2B and ChipChip Admin would hold, following your answers on the “4 questions” page.
          Tell us with ✅ or ❌ what is right or wrong. · እያንዳንዱ ትዕዛዝ በB2B እና በAdmin ምን እንደሚመስል ያሳያል። ትክክል ወይም ስህተቱን በ✅ ወይም ❌ ይንገሩን።
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map(({ title, am, value, desc, icon: Icon, color, bg }) => (
          <div key={title} className="card hover:shadow-md transition-shadow duration-200">
            <div className="flex flex-row items-start justify-between gap-2 p-4 md:p-6 pb-2 md:pb-2">
              <div className="text-sm font-medium text-gray-700">{title}<div className="text-xs font-normal text-gray-500">{am}</div></div>
              <div className={`p-2 rounded-lg ${bg}`}><Icon className={`h-4 w-4 ${color}`} /></div>
            </div>
            <div className="px-4 md:px-6 pb-4 md:pb-6">
              <div className="text-2xl font-bold text-gray-900 mb-1">{value.toLocaleString()}</div>
              <p className="text-xs text-gray-500">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {orders.length === 0 && <div className="card p-6 text-gray-500">No order yet. Send one to the order bot on Telegram. · እስካሁን ትዕዛዝ የለም።</div>}

      {orders.length > 0 && (
        <div className="card overflow-hidden">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr className="border-b-2">
                  <th className="!text-gray-900 font-semibold">Order</th><th className="!text-gray-900 font-semibold">Customer</th>
                  <th className="!text-gray-900 font-semibold">Date</th><th className="!text-gray-900 font-semibold">Status</th>
                  <th className="!text-gray-900 font-semibold">Payment</th><th className="!text-gray-900 font-semibold text-right">Amount</th>
                  <th className="!text-gray-900 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div className="font-semibold text-gray-900 whitespace-nowrap">{o.b2b_copy?.order_number || `#${o.id}`}</div>
                      <div className="text-sm text-gray-500 whitespace-nowrap">Deliver {o.delivery_date}</div>
                    </td>
                    <td>
                      <div className="font-medium text-gray-900">{o.companies?.name}</div>
                      <div className="text-sm text-gray-500">{o.locations?.label || "—"}</div>
                    </td>
                    <td className="whitespace-nowrap text-sm text-gray-900">{addis(o.created_at)}</td>
                    <td className="whitespace-nowrap">
                      {o.b2b_copy && <span className={`badge ${statusColor(o.b2b_copy.status)}`}>{o.b2b_copy.status}</span>}{" "}
                      {o.admin_copy && <span className={`badge ${statusColor(o.admin_copy.status)}`}>Admin {o.admin_copy.status}</span>}
                    </td>
                    <td>{o.b2b_copy ? <span className="badge bg-blue-100 text-blue-800">credit</span> : o.admin_copy ? <span className="badge bg-gray-100 text-gray-800">{o.admin_copy.payment_method}</span> : "—"}</td>
                    <td className="num"><div className="font-semibold text-gray-900">{etb(o.total)} ETB</div></td>
                    <td><a href={`#order-${o.id}`} className="btn-outline h-8"><Eye className="h-4 w-4" />View</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {orders.map((o) => (
        <div className="card p-4 md:p-6 scroll-mt-4" id={`order-${o.id}`} key={o.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">#{o.id} · {o.companies?.name}</h3>
            <span className="badge bg-red-50 text-red-700">{o.delivery_date}</span>
            <span className="text-sm text-gray-500">{addis(o.created_at)}</span>
          </div>
          <div className="text-sm text-gray-600 mt-1">Deliver to · የሚደርስበት: {o.locations?.label || "—"}{o.notes ? ` · Note · ማስታወሻ: ${o.notes}` : ""}</div>
          <div className="rounded-lg border mt-4 tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Product</th><th className="num">Qty</th><th>Unit</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
              <tbody>
                {o.items.map((i: any, k: number) => (
                  <tr key={k}><td>{i.name}</td><td className="num">{i.quantity}</td><td>{i.unit}</td><td className="num">{etb(i.price)}</td><td className="num">{etb(i.total)}</td></tr>
                ))}
                <tr className="bg-muted/50"><td colSpan={4} className="num text-gray-500">Subtotal · Tax · Total (ETB)</td><td className="num font-semibold text-gray-900">{etb(o.subtotal)} · {etb(o.tax)} · {etb(o.total)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 mt-4 md:grid-cols-2 lg:grid-cols-3">
            <Copy title="In ChipChip B2B" copy={o.b2b_copy} extra={o.b2b_copy && <>Order {o.b2b_copy.order_number} · <span className={`badge ${statusColor(o.b2b_copy.status)}`}>{o.b2b_copy.status}</span> · <span className="badge bg-blue-100 text-blue-800">credit</span></>} />
            <Copy title="In ChipChip Admin" copy={o.admin_copy} extra={o.admin_copy && <>{o.admin_copy.status} · {o.admin_copy.payment_method}<br />Placed as: {o.admin_copy.placed_as}<br />{o.admin_copy.rows.length} rows · {etb(o.admin_copy.total)} ETB</>} />
            <div className="rounded-lg border bg-gray-50 p-4">
              <div className="font-semibold text-gray-900">Credit checked</div>
              <div className="text-xs text-gray-500">({labelCredit(o.credit_check.setting)})</div>
              <ul className="list-disc ml-5 mt-2 text-sm text-gray-700 space-y-1">
                <li>Admin wallet: owed {etb(o.credit_check.admin.owed)}, could spend {etb(o.credit_check.admin.available)}</li>
                <li>B2B: status {o.credit_check.b2b.status}, unpaid {etb(o.credit_check.b2b.unpaid)}</li>
              </ul>
            </div>
          </div>
          <Feedback about={`order:${o.id}`} given={fb.filter((f) => f.about === `order:${o.id}`)} />
        </div>
      ))}
    </>
  );
}

function Copy({ title, copy, extra }: { title: string; copy: any; extra: any }) {
  if (!copy) return <div className="rounded-lg border bg-gray-50 p-4"><div className="font-semibold text-gray-900">{title}</div><div className="text-sm text-gray-500 mt-1">Not created here (your answer to question 1).</div></div>;
  return (
    <div className="rounded-lg border bg-gray-50 p-4">
      <div className="font-semibold text-gray-900">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{extra}</div>
      <div className="text-sm font-medium text-gray-700 mt-2">What it starts · የሚያስጀምረው:</div>
      <ul className="list-disc ml-5 text-sm text-gray-700 space-y-0.5">{copy.triggers.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

const labelCredit = (s: string) => (s === "admin_wallet" ? "Admin wallet decides" : s === "b2b_status" ? "B2B status decides" : "both must allow");
