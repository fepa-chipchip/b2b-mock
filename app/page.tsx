import { db, must } from "@/lib/db";
import Feedback from "./Feedback";

export const dynamic = "force-dynamic";

const etb = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Every order the agent created, as each system would hold it, with Simenesh's ✅ / ❌. */
export default async function Orders() {
  const orders = must(await db().from("orders").select("*, companies(name), locations(label)").order("id", { ascending: false }).limit(50)) as any[];
  const fb = must(await db().from("feedback").select("*").like("about", "order:%").order("id")) as any[];
  return (
    <>
      <h1>Orders created by the agent <div className="am">ወኪሉ የፈጠራቸው ትዕዛዞች</div></h1>
      <p className="muted">
        Each order shows what ChipChip B2B and ChipChip Admin would hold, following your answers on the “4 questions” page.
        Tell us with ✅ or ❌ what is right or wrong. · እያንዳንዱ ትዕዛዝ በB2B እና በAdmin ምን እንደሚመስል ያሳያል። ትክክል ወይም ስህተቱን በ✅ ወይም ❌ ይንገሩን።
      </p>
      {orders.length === 0 && <div className="card muted">No order yet. Send one to the order bot on Telegram. · እስካሁን ትዕዛዝ የለም።</div>}
      {orders.map((o) => (
        <div className="card" key={o.id}>
          <h2>
            #{o.id} · {o.companies?.name} <span className="pill">{o.delivery_date}</span>{" "}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {new Date(o.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}
            </span>
          </h2>
          <div className="muted">Deliver to · የሚደርስበት: {o.locations?.label || "—"}{o.notes ? ` · Note · ማስታወሻ: ${o.notes}` : ""}</div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Product</th><th className="num">Qty</th><th>Unit</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
            <tbody>
              {o.items.map((i: any, k: number) => (
                <tr key={k}><td>{i.name}</td><td className="num">{i.quantity}</td><td>{i.unit}</td><td className="num">{etb(i.price)}</td><td className="num">{etb(i.total)}</td></tr>
              ))}
              <tr><td colSpan={4} className="num muted">Subtotal · Tax · Total (ETB)</td><td className="num"><b>{etb(o.subtotal)} · {etb(o.tax)} · {etb(o.total)}</b></td></tr>
            </tbody>
          </table>
          <div className="grid" style={{ marginTop: 10 }}>
            <Copy title="In ChipChip B2B" copy={o.b2b_copy} extra={o.b2b_copy && <>Order {o.b2b_copy.order_number} · {o.b2b_copy.status} · credit</>} />
            <Copy title="In ChipChip Admin" copy={o.admin_copy} extra={o.admin_copy && <>{o.admin_copy.status} · {o.admin_copy.payment_method}<br />Placed as: {o.admin_copy.placed_as}<br />{o.admin_copy.rows.length} rows · {etb(o.admin_copy.total)} ETB</>} />
            <div>
              <b>Credit checked</b> <span className="muted">({labelCredit(o.credit_check.setting)})</span>
              <ul>
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
  if (!copy) return <div><b>{title}</b><div className="muted">Not created here (your answer to question 1).</div></div>;
  return (
    <div>
      <b>{title}</b>
      <div className="muted" style={{ fontSize: 14 }}>{extra}</div>
      <div style={{ fontSize: 14, marginTop: 4 }}>What it starts · የሚያስጀምረው:</div>
      <ul style={{ fontSize: 14 }}>{copy.triggers.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

const labelCredit = (s: string) => (s === "admin_wallet" ? "Admin wallet decides" : s === "b2b_status" ? "B2B status decides" : "both must allow");
