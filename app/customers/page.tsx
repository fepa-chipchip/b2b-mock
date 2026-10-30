import { headers } from "next/headers";
import { db, must } from "@/lib/db";
import { addPerson, connectBot } from "../actions";

export const dynamic = "force-dynamic";

const etb = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The test customers, who may order for them, their credit in both systems; and the bot's connection. */
export default async function Customers() {
  const cos = must(await db().from("companies").select("*, locations(label)").order("id")) as any[];
  const staff = must(await db().from("staff").select("*, staff_companies(companies(name))").order("id")) as any[];
  const setup = must(await db().from("feedback").select("*").eq("about", "setup").order("id", { ascending: false }).limit(1)) as any[];
  const host = headers().get("host") || "";
  return (
    <>
      <h1>Test customers <div className="am">የሙከራ ደንበኞች</div></h1>
      <p className="muted">These companies and people are invented for the test; the products are ChipChip's, with sample prices. · እነዚህ ድርጅቶች እና ሰዎች ለሙከራ የተፈጠሩ ናቸው።</p>
      <div className="card">
        <table>
          <thead><tr><th>Company</th><th>Delivery places</th><th className="num">Limit</th><th className="num">Admin wallet owed</th><th className="num">B2B unpaid</th><th>B2B status</th></tr></thead>
          <tbody>
            {cos.map((c) => (
              <tr key={c.id}>
                <td>{c.name}<div className="muted" style={{ fontSize: 12 }}>{c.customer_type} · {c.payment_terms_days} days</div></td>
                <td>{c.locations.map((l: any) => l.label).join(" · ")}</td>
                <td className="num">{etb(c.credit_limit)}</td>
                <td className="num">{etb(Math.max(0, -c.admin_wallet_balance))}</td>
                <td className="num">{etb(c.b2b_unpaid)}</td>
                <td><span className={`pill ${c.b2b_credit_status === "good" ? "okp" : "badp"}`}>{c.b2b_credit_status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h1>Who may order <div className="am">ማዘዝ የሚችሉ</div></h1>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Companies</th><th>Telegram</th></tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>+{s.phone}</td>
                <td>{s.staff_companies.map((x: any) => x.companies?.name).join(", ")}</td>
                <td>{s.telegram_id ? <span className="pill okp">linked {s.telegram_name || ""}</span> : <span className="muted">not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addPerson} style={{ marginTop: 12 }}>
          <b>Add a tester · ሞካሪ ይጨምሩ</b>
          <div className="muted" style={{ fontSize: 13 }}>Their Telegram phone number. They open the order bot, press Start and share their number. · የቴሌግራም ስልክ ቁጥራቸው።</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <input name="name" placeholder="Name · ስም" required />
            <input name="phone" placeholder="+251 9…" required />
          </div>
          <div style={{ marginTop: 6 }}>
            {cos.map((c) => <label key={c.id} style={{ display: "inline-block", marginRight: 12 }}><input type="checkbox" name="company" value={c.id} /> {c.name}</label>)}
          </div>
          <button type="submit" style={{ marginTop: 6 }}>Add · ጨምር</button>
        </form>
      </div>

      <details className="card">
        <summary>Order bot connection (set up once)</summary>
        <form action={connectBot} style={{ marginTop: 8 }}>
          <input type="hidden" name="host" value={host} />
          <button type="submit" className="ghost">Connect the bot to {host}</button>
          {setup[0] && <span className="muted" style={{ marginLeft: 8 }}>{setup[0].ok ? "✅" : "❌"} {setup[0].comment}</span>}
        </form>
      </details>
    </>
  );
}
