import { db, must, BUCKET } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  collecting: "receiving · እየደረሰ", waiting_company: "waiting for the company choice · ድርጅት እየጠበቀ",
  asked: "question sent to the customer · ጥያቄ ተልኳል", proposed: "waiting for your yes · ፈቃድዎን እየጠበቀ",
  created: "created · ተፈጥሯል", rejected: "declined · ውድቅ", unknown_sender: "unknown phone · ያልታወቀ ስልክ",
};

/** Badge colours in ChipChip B2B's palette: blue in progress, amber waiting on you, green done, red stopped. */
const COLOR: Record<string, string> = {
  collecting: "bg-blue-100 text-blue-800", waiting_company: "bg-yellow-100 text-yellow-800", asked: "bg-blue-100 text-blue-800",
  proposed: "bg-amber-100 text-amber-800", created: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800",
  unknown_sender: "bg-red-100 text-red-800",
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
      <div>
        <h2 className="page-title">What customers sent</h2>
        <div className="am">ደንበኞች የላኩት</div>
      </div>
      {rows.length === 0 && <div className="card p-6 text-gray-500">Nothing received yet. · እስካሁን ምንም አልደረሰም።</div>}
      {rows.map((r) => (
        <div className="card p-4 md:p-6" key={r.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900 break-words">{r.sender_name || "?"} → {r.companies?.name || "company not chosen yet"}</h3>
            <span className={`badge ${COLOR[r.status] || "bg-gray-100 text-gray-800"}`}>{STATUS[r.status] || r.status}</span>
          </div>
          <div className="text-sm text-gray-500 mt-1">{new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}{r.agent_note ? ` · ${r.agent_note}` : ""}</div>
          {msgs.filter((m) => m.inbox_id === r.id).map((m) => (
            <div key={m.id} className="mt-3 rounded-lg border bg-gray-50 p-3 text-sm text-gray-900">
              {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
              {m.kind === "photo" && urls.get(m.file_path) && <img className="max-w-[220px] w-full rounded-md border" src={urls.get(m.file_path)} alt="photo" />}
              {m.kind === "document" && urls.get(m.file_path) && <a className="text-red-700 underline break-all" href={urls.get(m.file_path)}>{m.file_name}</a>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
