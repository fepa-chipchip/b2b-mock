import { giveFeedback } from "./actions";

type Fb = { ok: boolean | null; comment: string | null; created_at: string };

/** "Is this right?" with ✅ / ❌ and a comment, plus what was already said. */
export default function Feedback({ about, given }: { about: string; given: Fb[] }) {
  return (
    <div className="mt-4 border-t border-dashed pt-3">
      {given.map((f, i) => (
        <div key={i} className="text-sm text-gray-600">
          {f.ok === true ? "✅" : f.ok === false ? "❌" : "💬"} {f.comment} · <span className="text-xs text-gray-500">{new Date(f.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}</span>
        </div>
      ))}
      <form action={giveFeedback} className="flex flex-wrap items-center gap-2 mt-2">
        <input type="hidden" name="about" value={about} />
        <span className="text-sm font-medium text-gray-700">Is this right? · ትክክል ነው?</span>
        <label className="inline-flex items-center gap-1 text-sm"><input type="radio" name="ok" value="yes" /> ✅</label>
        <label className="inline-flex items-center gap-1 text-sm"><input type="radio" name="ok" value="no" /> ❌</label>
        <input name="comment" placeholder="What is wrong / ምን ተሳስቷል" className="field flex-[1_1_220px] min-w-0" />
        <button type="submit" className="btn">Send · ላክ</button>
      </form>
    </div>
  );
}
