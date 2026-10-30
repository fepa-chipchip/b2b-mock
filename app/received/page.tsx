import { headers } from "next/headers";
import { db, must, BUCKET } from "@/lib/db";
import { addTester, connectBot } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  collecting: "receiving · እየደረሰ", waiting_company: "waiting for the company choice · ድርጅት እየጠበቀ",
  asked: "question sent to the customer · ጥያቄ ተልኳል", proposed: "waiting for your yes · ፈቃድዎን እየጠበቀ",
  created: "created · ተፈጥሯል", rejected: "declined · ውድቅ", unknown_sender: "unknown phone · ያልታወቀ ስልክ",
  waiting_signup: "waiting for the sign-up · ምዝገባ እየጠበቀ",
};

/** A new customer's sign-up through the bot. */
const SIGNUP_STATUS: Record<string, [string, string]> = {
  collecting: ["answering · እየመለሱ", "bg-blue-100 text-blue-800"],
  waiting_approval: ["waiting for your yes · ፈቃድዎን እየጠበቀ", "bg-amber-100 text-amber-800"],
  registered: ["registered · ተመዝግቧል", "bg-green-100 text-green-800"],
  declined: ["declined · ውድቅ", "bg-red-100 text-red-800"],
};

/** Badge colours in ChipChip B2B's palette: blue in progress, amber waiting on you, green done, red stopped. */
const COLOR: Record<string, string> = {
  collecting: "bg-blue-100 text-blue-800", waiting_company: "bg-yellow-100 text-yellow-800", asked: "bg-blue-100 text-blue-800",
  proposed: "bg-amber-100 text-amber-800", created: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800",
  unknown_sender: "bg-red-100 text-red-800", waiting_signup: "bg-amber-100 text-amber-800",
};

/** What customers sent the order bot, exactly as it arrived; who may use the bot; the bot's connection. */
export default async function Received() {
  const rows = must(await db().from("inbox").select("*").order("id", { ascending: false }).limit(40)) as any[];
  const companies = must(await db().from("adm_b2b_customers").select("id,business_name").is("deleted_at", null).order("business_name")) as any[];
  const coName = new Map(companies.map((c) => [c.id, c.business_name]));
  const ids = rows.map((r) => r.id);
  const msgs = ids.length ? (must(await db().from("inbox_messages").select("*").in("inbox_id", ids).order("id")) as any[]) : [];
  const urls = new Map<string, string>();
  for (const m of msgs.filter((m) => m.file_path)) {
    const s = await db().storage.from(BUCKET).createSignedUrl(m.file_path, 3600);
    if (s.data?.signedUrl) urls.set(m.file_path, s.data.signedUrl);
  }
  const signups = must(await db().from("bot_signups").select("*").order("id", { ascending: false }).limit(20)) as any[];
  const contacts = must(await db().from("bot_contacts").select("*")) as any[];
  const links = must(await db().from("adm_b2b_customer_users").select("role, adm_users(name,phone), adm_b2b_customers(business_name)")) as any[];
  const people = new Map<string, { name: string; phone: string; companies: string[] }>();
  for (const l of links) {
    const u = l.adm_users;
    if (!u) continue;
    const p = people.get(u.phone) || { name: u.name, phone: u.phone, companies: [] as string[] };
    p.companies.push(l.adm_b2b_customers?.business_name);
    people.set(u.phone, p);
  }
  const setup = must(await db().from("feedback").select("*").eq("about", "setup").order("id", { ascending: false }).limit(1)) as any[];
  const host = headers().get("host") || "";

  return (
    <>
      <div>
        <h2 className="page-title">What customers sent</h2>
        <div className="am">ደንበኞች የላኩት</div>
        <p className="page-sub">The order bot is our own service and stays at go-live. A person can use it when their phone number is a
          linked user of a company in ChipChip Admin. · ቦቱን መጠቀም የሚችሉት በAdmin ከድርጅት ጋር የተገናኙ ተጠቃሚዎች ናቸው።</p>
      </div>
      {rows.length === 0 && <div className="card p-6 text-gray-500">Nothing received yet. · እስካሁን ምንም አልደረሰም።</div>}
      {rows.map((r) => (
        <div className="card p-4 md:p-6" key={r.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900 break-words">{r.sender_name || "?"} → {coName.get(r.company_id) || "company not chosen yet"}</h3>
            <span className={`badge ${COLOR[r.status] || "bg-gray-100 text-gray-800"}`}>{STATUS[r.status] || r.status}</span>
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}
            {r.sender_phone ? ` · +${r.sender_phone}` : ""}{r.agent_note ? ` · ${r.agent_note}` : ""}
          </div>
          {(r.b2b_order_number || r.admin_bill_id) && (
            <div className="text-sm text-gray-700 mt-1">
              {r.b2b_order_number && <>B2B: <a className="text-red-700 underline" href={`/b2b/orders?search=${encodeURIComponent(r.b2b_order_number)}`}>{r.b2b_order_number}</a> </>}
              {r.admin_bill_id && <>· Admin bill {r.admin_bill_id.slice(0, 8)}</>}
            </div>
          )}
          {msgs.filter((m) => m.inbox_id === r.id).map((m) => (
            <div key={m.id} className="mt-3 rounded-lg border bg-gray-50 p-3 text-sm text-gray-900">
              {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
              {m.kind === "photo" && urls.get(m.file_path) && <img className="max-w-[220px] w-full rounded-md border" src={urls.get(m.file_path)} alt="photo" />}
              {m.kind === "document" && urls.get(m.file_path) && <a className="text-red-700 underline break-all" href={urls.get(m.file_path)}>{m.file_name}</a>}
            </div>
          ))}
        </div>
      ))}

      <div>
        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900">Sign-ups</h2>
        <div className="am">አዲስ ምዝገባዎች</div>
        <p className="page-sub">New customers whose number is not linked to any company yet: the bot asks their business, type, TIN and
          delivery place, and they can already send an order while you decide. · ቁጥራቸው ገና ከድርጅት ጋር ያልተገናኘ አዲስ ደንበኞች።</p>
      </div>
      <div className="card overflow-hidden">
        {signups.length === 0 ? (
          <div className="p-6 text-gray-500">No sign-ups yet. · እስካሁን ምዝገባ የለም።</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Business</th><th>Phone</th><th>Type</th><th>TIN</th><th>Place</th><th>Status</th></tr></thead>
              <tbody>
                {signups.map((s) => {
                  const [label, color] = SIGNUP_STATUS[s.status] || [s.status, "bg-gray-100 text-gray-800"];
                  const map = s.latitude != null && s.longitude != null ? `https://maps.google.com/?q=${s.latitude},${s.longitude}` : null;
                  return (
                    <tr key={s.id}>
                      <td className="font-medium text-gray-900">{s.business_name || "…"}
                        {s.telegram_name && <div className="text-xs text-gray-500">{s.telegram_name}</div>}</td>
                      <td className="whitespace-nowrap">+{s.phone}</td>
                      <td className="text-gray-700">{s.business_type || "…"}</td>
                      <td className="text-gray-700">{s.tin || (s.step === "location" || s.step === "done" ? "none yet" : "…")}</td>
                      <td className="text-gray-700 break-words">{s.address || ""}
                        {map && <> {s.address ? "· " : ""}<a className="text-red-700 underline" href={map} target="_blank" rel="noreferrer">map</a></>}</td>
                      <td><span className={`badge ${color}`}>{label}</span>
                        {s.agent_note && <div className="text-xs text-gray-500 mt-1">{s.agent_note}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900">Who may order through the bot</h2>
        <div className="am">በቦቱ ማዘዝ የሚችሉ</div>
        <p className="page-sub">Linked users in ChipChip Admin (change them on Admin → B2B Customers → a company → Linked Users).</p>
      </div>
      <div className="card overflow-hidden">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Phone</th><th>Companies</th><th>Telegram</th></tr></thead>
            <tbody>
              {Array.from(people.values()).map((p) => {
                const c = contacts.find((x) => x.phone === p.phone);
                return (
                  <tr key={p.phone}>
                    <td className="font-medium text-gray-900">{p.name}</td><td className="whitespace-nowrap">+{p.phone}</td>
                    <td className="text-gray-700">{p.companies.join(", ")}</td>
                    <td>{c ? <span className="badge bg-green-100 text-green-800">linked {c.telegram_name || ""}</span> : <span className="text-gray-500">not yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <form action={addTester} className="border-t p-4 md:p-6 space-y-3">
          <div>
            <div className="font-semibold text-gray-900">Add a tester · ሞካሪ ይጨምሩ <span className="badge bg-amber-100 text-amber-800 ml-1">mock only</span></div>
            <div className="text-sm text-gray-500">Their Telegram phone number. This makes them an Admin user linked to the company (in reality they
              register in the app first). They open the order bot, press Start and share their number. · የቴሌግራም ስልክ ቁጥራቸው።</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input name="name" placeholder="Name · ስም" required className="field flex-[1_1_180px] min-w-0" />
            <input name="phone" placeholder="+251 9…" required className="field flex-[1_1_180px] min-w-0" />
            <select name="company" required className="field flex-[1_1_220px] min-w-0">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.business_name}</option>)}
            </select>
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
