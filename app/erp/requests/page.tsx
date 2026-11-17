import { listErpRequests } from "@/lib/erpStore";
import { KNOWN_IDS } from "@/lib/erpPayments";
import { clearErpTestRequests } from "../actions";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
};

const money = (n: number | string) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The fake ERP's payment requests, newest first: our own check of what the agent sent (the real ERP has no list call).
 * Like every page it asks for UI_PASSWORD (middleware.ts); it is not in the menu.
 */
export default async function ErpRequests() {
  const rows = await listErpRequests();
  return (
    <>
      <div>
        <h2 className="page-title">ERP payment requests (sandbox)</h2>
        <p className="page-sub">What agents sent to the fake ChipChip ERP at <code>/erp/functions/v1/external-payment-requests</code>.
          Nothing here reaches the real ERP. Numbers PR-&lt;year&gt;-9xxxx are mock numbers. Latest {rows.length}.</p>
      </div>

      <form action={clearErpTestRequests} className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-outline" disabled={rows.length === 0}>Clear test requests</button>
        <span className="text-xs text-gray-500">Deletes every request on this page. A retry of an old reference then creates a new request.</span>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6 text-gray-500">No payment requests yet.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Number</th><th>Status</th><th>Source</th><th>Reference</th><th>Title</th><th>Vendor</th>
                  <th className="text-right">Amount</th><th>Currency</th><th>Created</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const docs = (r.documents || []) as { file_name: string; size_bytes: number }[];
                  const tags = [r.department_id, r.category_id].filter(Boolean).map((id: string) => KNOWN_IDS[id] || id.slice(0, 8));
                  return (
                    <tr key={r.id}>
                      <td className="font-medium text-gray-900 whitespace-nowrap">{r.request_number}</td>
                      <td><span className={`badge ${COLOR[r.status] || "bg-gray-100 text-gray-800"}`}>{r.status}</span></td>
                      <td className="text-gray-700">{r.external_source}</td>
                      <td className="text-gray-700 break-all">{r.external_reference || "—"}</td>
                      <td className="text-gray-900 break-words">{r.title}
                        {(tags.length > 0 || docs.length > 0) && (
                          <div className="text-xs text-gray-500">
                            {tags.join(" · ")}{tags.length && docs.length ? " · " : ""}
                            {docs.length > 0 && `${docs.length} file${docs.length > 1 ? "s" : ""}: ${docs.map((d) => `${d.file_name} (${money(d.size_bytes)} B)`).join(", ")}`}
                          </div>
                        )}</td>
                      <td className="text-gray-700 break-words">{r.vendor_name || ""}
                        {r.vendor_bank_account && <div className="text-xs text-gray-500">{[r.vendor_bank_name, r.vendor_bank_account].filter(Boolean).join(" ")}</div>}</td>
                      <td className="text-right whitespace-nowrap">{money(r.total_amount)}</td>
                      <td>{r.currency}</td>
                      <td className="whitespace-nowrap text-gray-500">
                        {new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
