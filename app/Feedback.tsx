import { giveFeedback } from "./actions";

type Fb = { ok: boolean | null; comment: string | null; created_at: string };

/** "Is this right?" with ✅ / ❌ and a comment, plus what was already said. */
export default function Feedback({ about, given }: { about: string; given: Fb[] }) {
  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
      {given.map((f, i) => (
        <div key={i} className="muted" style={{ fontSize: 13 }}>
          {f.ok === true ? "✅" : f.ok === false ? "❌" : "💬"} {f.comment} · {new Date(f.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}
        </div>
      ))}
      <form action={giveFeedback} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <input type="hidden" name="about" value={about} />
        <span>Is this right? · ትክክል ነው?</span>
        <label style={{ margin: 0 }}><input type="radio" name="ok" value="yes" /> ✅</label>
        <label style={{ margin: 0 }}><input type="radio" name="ok" value="no" /> ❌</label>
        <input name="comment" placeholder="What is wrong / ምን ተሳስቷል" style={{ flex: "1 1 220px" }} />
        <button type="submit">Send · ላክ</button>
      </form>
    </div>
  );
}
