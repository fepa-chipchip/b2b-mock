import { db, must } from "@/lib/db";
import { saveAnswer } from "../actions";
import Feedback from "../Feedback";

export const dynamic = "force-dynamic";

const QUESTIONS = [
  {
    key: "q1_where",
    en: "When a customer orders, where should the order be entered?",
    am: "ደንበኛ ሲያዝ ትዕዛዙ የት መመዝገብ አለበት?",
    why: "Today you type every order twice, in B2B and in Admin. Tell us in the comment what each one starts: delivery, invoice, warehouse list…",
    why_am: "ዛሬ እያንዳንዱን ትዕዛዝ ሁለት ጊዜ ይጽፋሉ፣ በB2B እና በAdmin። እያንዳንዱ ምን እንደሚያስጀምር (ማድረስ፣ ደረሰኝ፣ መጋዘን…) በአስተያየቱ ይጻፉ።",
    options: [
      ["both", "In both, B2B and Admin", "በሁለቱም፣ B2B እና Admin"],
      ["b2b", "Only in B2B", "በB2B ብቻ"],
      ["admin", "Only in Admin", "በAdmin ብቻ"],
    ],
  },
  {
    key: "q2_credit",
    en: "Which credit decides whether a customer can still order?",
    am: "ደንበኛ አሁንም ማዘዝ ይችል እንደሆነ የሚወስነው የትኛው ክሬዲት ነው?",
    why: "Admin keeps a company wallet with a limit. B2B keeps its own unpaid total and status (good, overdue). They are not the same numbers.",
    why_am: "Admin የድርጅት ዋሌት ከገደብ ጋር ይይዛል። B2B የራሱን ያልተከፈለ ድምር እና ሁኔታ ይይዛል። ቁጥሮቹ አንድ አይደሉም።",
    options: [
      ["admin_wallet", "The Admin wallet", "የAdmin ዋሌት"],
      ["b2b_status", "The B2B credit status", "የB2B ክሬዲት ሁኔታ"],
      ["both", "Both must allow it", "ሁለቱም መፍቀድ አለባቸው"],
    ],
  },
  {
    key: "q3_placed_as",
    en: "In Admin, whose account should place the order?",
    am: "በAdmin ትዕዛዙን የሚያስገባው በማን አካውንት መሆን አለበት?",
    why: "Today Admin orders run on your own account, which is linked to every company. The agent can do the same, or use the customer's staff account.",
    why_am: "ዛሬ በAdmin ትዕዛዞች በእርስዎ አካውንት ይገባሉ፣ ከሁሉም ድርጅቶች ጋር የተገናኘ። ወኪሉ እንደዚሁ ማድረግ ወይም የደንበኛውን ሰራተኛ አካውንት መጠቀም ይችላል።",
    options: [
      ["simenesh", "My account, as today", "የእኔ አካውንት፣ እንደ ዛሬው"],
      ["staff", "The customer's staff account", "የደንበኛው ሰራተኛ አካውንት"],
    ],
  },
  {
    key: "q4_several",
    en: "When one person orders for several companies, what should the bot do?",
    am: "አንድ ሰው ለብዙ ድርጅቶች ሲያዝ ቦቱ ምን ማድረግ አለበት?",
    why: "Some people order for two places (two restaurants, or a restaurant and a hotel). Tell us in the comment who does this today.",
    why_am: "አንዳንድ ሰዎች ለሁለት ቦታዎች ያዛሉ። ዛሬ ይህን የሚያደርጉት እነማን እንደሆኑ በአስተያየቱ ይጻፉ።",
    options: [
      ["ask", "Ask them each time which company", "ሁልጊዜ የትኛው ድርጅት እንደሆነ ይጠይቅ"],
      ["usual", "Use their usual company", "የተለመደውን ድርጅታቸውን ይጠቀም"],
    ],
  },
];

/** The four open questions. The answers are for the agent (GET /api/agent/settings); the fake systems behave like the real ones. */
export default async function Questions() {
  const rows = must(await db().from("settings").select("*")) as any[];
  const fb = must(await db().from("feedback").select("*").or("about.like.setting:%,about.eq.general").order("id")) as any[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <>
      <div>
        <h2 className="page-title">4 questions</h2>
        <div className="am">4 ጥያቄዎች</div>
        <p className="page-sub">
          Pick the answer that matches how you work. The order agent reads it before every order. The two test systems do not
          change with your answers: like the real ones, B2B blocks a customer with overdue or too much unpaid credit, and
          Admin refuses an order the company wallet cannot cover. ·
          እንደ ስራዎ ትክክለኛውን መልስ ይምረጡ። ወኪሉ ከእያንዳንዱ ትዕዛዝ በፊት ያነበዋል። ሁለቱ የሙከራ ስርዓቶች እንደ እውነተኞቹ ይሰራሉ።
        </p>
      </div>
      {QUESTIONS.map((q, n) => {
        const cur = byKey.get(q.key);
        return (
          <div className="card p-4 md:p-6" key={q.key}>
            <h3 className="text-lg font-semibold text-gray-900">{n + 1}. {q.en}</h3>
            <div className="am">{q.am}</div>
            <div className="text-sm text-gray-600 mt-2">{q.why}<br />{q.why_am}</div>
            <form action={saveAnswer} className="mt-4 space-y-2">
              <input type="hidden" name="key" value={q.key} />
              {q.options.map(([v, en, am]) => (
                <label key={v} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 has-[:checked]:border-red-600 has-[:checked]:bg-red-50">
                  <input type="radio" name="value" value={v} defaultChecked={cur?.value === v} className="mt-1" />
                  <span>{en} · <span className="am">{am}</span></span>
                </label>
              ))}
              <textarea name="comment" rows={2} defaultValue={cur?.comment || ""} placeholder="Comment · አስተያየት" className="textarea" />
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="btn">Save · አስቀምጥ</button>
                {cur?.answered_by && <span className="text-xs text-gray-500">Saved {new Date(cur.updated_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}</span>}
              </div>
            </form>
          </div>
        );
      })}
      <div className="card p-4 md:p-6">
        <h3 className="text-lg font-semibold text-gray-900">Anything else?</h3>
        <div className="am">ሌላ ነገር አለ?</div>
        <Feedback about="general" given={fb.filter((f) => f.about === "general")} />
      </div>
    </>
  );
}
