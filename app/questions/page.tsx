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

/** The four open questions, answered as settings the test then follows. */
export default async function Questions() {
  const rows = must(await db().from("settings").select("*")) as any[];
  const fb = must(await db().from("feedback").select("*").or("about.like.setting:%,about.eq.general").order("id")) as any[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <>
      <h1>4 questions <div className="am">4 ጥያቄዎች</div></h1>
      <p className="muted">
        Pick the answer that matches how you work. The test follows it at once: send a new order and look at the result. ·
        እንደ ስራዎ ትክክለኛውን መልስ ይምረጡ። ሙከራው ወዲያውኑ ይከተለዋል፤ አዲስ ትዕዛዝ ልከው ውጤቱን ይመልከቱ።
      </p>
      {QUESTIONS.map((q, n) => {
        const cur = byKey.get(q.key);
        return (
          <div className="card" key={q.key}>
            <h2>{n + 1}. {q.en}<div className="am">{q.am}</div></h2>
            <div className="muted" style={{ fontSize: 14 }}>{q.why}<br />{q.why_am}</div>
            <form action={saveAnswer} style={{ marginTop: 8 }}>
              <input type="hidden" name="key" value={q.key} />
              {q.options.map(([v, en, am]) => (
                <label key={v}><input type="radio" name="value" value={v} defaultChecked={cur?.value === v} /> {en} · <span className="am">{am}</span></label>
              ))}
              <textarea name="comment" rows={2} defaultValue={cur?.comment || ""} placeholder="Comment · አስተያየት" style={{ marginTop: 6 }} />
              <button type="submit" style={{ marginTop: 6 }}>Save · አስቀምጥ</button>
              {cur?.answered_by && <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>Saved {new Date(cur.updated_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}</span>}
            </form>
          </div>
        );
      })}
      <div className="card">
        <h2>Anything else? <div className="am">ሌላ ነገር አለ?</div></h2>
        <Feedback about="general" given={fb.filter((f) => f.about === "general")} />
      </div>
    </>
  );
}
