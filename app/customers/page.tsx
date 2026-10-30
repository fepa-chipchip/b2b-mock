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
      <div>
        <h2 className="page-title">Test customers</h2>
        <div className="am">የሙከራ ደንበኞች</div>
        <p className="page-sub">These companies and people are invented for the test; the products are ChipChip's, with sample prices. · እነዚህ ድርጅቶች እና ሰዎች ለሙከራ የተፈጠሩ ናቸው።</p>
      </div>
      <div className="card overflow-hidden">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Company</th><th>Delivery places</th><th className="num">Limit</th><th className="num">Admin wallet owed</th><th className="num">B2B unpaid</th><th>B2B status</th></tr></thead>
            <tbody>
              {cos.map((c) => (
                <tr key={c.id}>
                  <td><div className="font-medium text-gray-900">{c.name}</div><div className="text-xs text-gray-500">{c.customer_type} · {c.payment_terms_days} days</div></td>
                  <td className="text-gray-700">{c.locations.map((l: any) => l.label).join(" · ")}</td>
                  <td className="num">{etb(c.credit_limit)}</td>
                  <td className="num">{etb(Math.max(0, -c.admin_wallet_balance))}</td>
                  <td className="num">{etb(c.b2b_unpaid)}</td>
                  <td><span className={`badge ${c.b2b_credit_status === "good" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{c.b2b_credit_status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900">Who may order</h2>
        <div className="am">ማዘዝ የሚችሉ</div>
      </div>
      <div className="card overflow-hidden">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Phone</th><th>Companies</th><th>Telegram</th></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium text-gray-900">{s.name}</td><td className="whitespace-nowrap">+{s.phone}</td>
                  <td className="text-gray-700">{s.staff_companies.map((x: any) => x.companies?.name).join(", ")}</td>
                  <td>{s.telegram_id ? <span className="badge bg-green-100 text-green-800">linked {s.telegram_name || ""}</span> : <span className="text-gray-500">not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={addPerson} className="border-t p-4 md:p-6 space-y-3">
          <div>
            <div className="font-semibold text-gray-900">Add a tester · ሞካሪ ይጨምሩ</div>
            <div className="text-sm text-gray-500">Their Telegram phone number. They open the order bot, press Start and share their number. · የቴሌግራም ስልክ ቁጥራቸው።</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input name="name" placeholder="Name · ስም" required className="field flex-[1_1_180px] min-w-0" />
            <input name="phone" placeholder="+251 9…" required className="field flex-[1_1_180px] min-w-0" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {cos.map((c) => <label key={c.id} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="company" value={c.id} /> {c.name}</label>)}
          </div>
          <button type="submit" className="btn">Add · ጨምር</button>
        </form>
      </div>

      <details className="card p-4 md:p-6">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">Order bot connection (set up once)</summary>
        <form action={connectBot} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="host" value={host} />
          <button type="submit" className="btn-outline max-w-full whitespace-normal text-left h-auto min-h-9 py-2">Connect the bot to {host}</button>
          {setup[0] && <span className="text-sm text-gray-500 break-words">{setup[0].ok ? "✅" : "❌"} {setup[0].comment}</span>}
        </form>
      </details>
    </>
  );
}
