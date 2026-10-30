import { db, must, BUCKET } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  collecting: "receiving · እየደረሰ", waiting_company: "waiting for the company choice · ድርጅት እየጠበቀ",
  asked: "question sent to the customer · ጥያቄ ተልኳል", proposed: "waiting for your yes · ፈቃድዎን እየጠበቀ",
  created: "created · ተፈጥሯል", rejected: "declined · ውድቅ", unknown_sender: "unknown phone · ያልታወቀ ስልክ",
};

/** What customers sent the order bot, exactly as it arrived. */
export default async function Received() {
  const rows = must(await db().from("inbox").select("*, companies(name)").order("id", { ascending: false }).limit(40)) as any[];
  const ids = rows.map((r) => r.id);
  const msgs = ids.length ? (must(await db().from("inbox_messages").select("*").in("inbox_id", ids).order("id")) as any[]) : [];
  const urls = new Map<string, string>();
  for (const m of msgs.filter((m) => m.file_path)) {
    const s = await db().storage.from(BUCKET).createSignedUrl(m.file_path, 3600);
    if (s.data?.signedUrl) urls.set(m.file_path, s.data.signedUrl);
  }
  return (
    <>
      <h1>What customers sent <div className="am">ደንበኞች የላኩት</div></h1>
      {rows.length === 0 && <div className="card muted">Nothing received yet. · እስካሁን ምንም አልደረሰም።</div>}
      {rows.map((r) => (
        <div className="card" key={r.id}>
          <h2>{r.sender_name || "?"} → {r.companies?.name || "company not chosen yet"} <span className="pill">{STATUS[r.status] || r.status}</span></h2>
          <div className="muted" style={{ fontSize: 13 }}>{new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}{r.agent_note ? ` · ${r.agent_note}` : ""}</div>
          {msgs.filter((m) => m.inbox_id === r.id).map((m) => (
            <div key={m.id} style={{ marginTop: 6 }}>
              {m.text && <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>}
              {m.kind === "photo" && urls.get(m.file_path) && <img className="thumb" src={urls.get(m.file_path)} alt="photo" />}
              {m.kind === "document" && urls.get(m.file_path) && <a href={urls.get(m.file_path)}>{m.file_name}</a>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
