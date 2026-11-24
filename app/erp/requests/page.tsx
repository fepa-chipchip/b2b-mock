import { Fragment } from "react";
import { listErpRequests } from "@/lib/erpStore";
import { departmentCategory, type ErpDepartment } from "@/lib/erpPayments";
import departments from "@/lib/erpDepartments.json";
import { clearErpTestRequests, decideErpTestRequest } from "../actions";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
};

const DEPARTMENTS = departments as ErpDepartment[];
const money = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const when = (t: string | null) => (t ? new Date(t).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" }) : "");
const day = (d: string | null) => (d ? String(d).slice(0, 10) : "");

type Item = { description: string | null; quantity: number | null; unit_price: number | null; amount: number | null; notes: string | null };

/** One label: value line of the details; an empty value shows a dash, so a field that was not sent is visible. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex gap-2"><span className="text-gray-500 w-40 shrink-0">{label}</span>
      <span className="text-gray-900 break-words min-w-0">{empty ? "—" : children}</span></div>
  );
}

/** Every field the ERP's payment form carries, as the request stored it. */
function Details({ r }: { r: any }) {
  const dc = departmentCategory(DEPARTMENTS, r.department_id, r.category_id);
  const items = (r.items || []) as Item[];
  const allocations = (r.allocations || []) as { business_unit: string; percentage: number }[];
  const allocTotal = allocations.reduce((s, a) => s + Number(a.percentage || 0), 0);
  const docs = (r.documents || []) as { file_name: string; file_type: string | null; size_bytes: number }[];
  const requester = [r.requester_first_name, r.requester_last_name].filter(Boolean).join(" ");
  return (
    <div className="grid gap-x-8 gap-y-1 md:grid-cols-2 text-xs">
      <div className="space-y-1">
        <Field label="Requester">{requester ? `${requester}${r.requester_email ? ` <${r.requester_email}>` : ""}`
          : r.requester_email || "(token owner: External System)"}</Field>
        <Field label="Department">{r.department_id ? (dc.department || `unknown id ${r.department_id}`) : null}</Field>
        <Field label="Category">{r.category_id ? <>
          {dc.category ? `${dc.category}${dc.category_code ? ` (${dc.category_code})` : ""}` : `unknown id ${r.category_id}`}
          {dc.category_not_in_department && (
            <span className="badge bg-red-100 text-red-800 ml-2">category not in department</span>)}
        </> : null}</Field>
        <Field label="Purpose / description"><span className="whitespace-pre-line">{r.description}</span></Field>
        <Field label="Vendor">{r.vendor_name}</Field>
        <Field label="Bank">{r.vendor_bank_name}</Field>
        <Field label="Account number">{r.vendor_bank_account}</Field>
        <Field label="Branch">{r.vendor_bank_branch}</Field>
        <Field label="Payment method">{r.payment_method}</Field>
        <Field label="Preferred payment date">{day(r.preferred_payment_date)}</Field>
      </div>
      <div className="space-y-1">
        <Field label="Business unit">{r.business_unit}</Field>
        <Field label="Allocations">{allocations.length ? <>
          {allocations.map((a) => `${a.business_unit} ${money(a.percentage)}%`).join(" · ")}
          <span className={allocTotal === 100 ? "text-gray-500" : "text-red-700"}> (total {money(allocTotal)}%)</span>
        </> : null}</Field>
        <Field label="Amount (net)">{`${money(r.amount)} ${r.currency}`}</Field>
        <Field label="VAT">{r.vat_applicable ? `yes, ${money(r.vat_amount)} ${r.currency}`
          : Number(r.vat_amount) ? `not applicable, ${money(r.vat_amount)} ${r.currency}` : "no"}</Field>
        <Field label="Total">{`${money(r.total_amount)} ${r.currency}`}</Field>
        <Field label="Documents">{docs.length ? docs.map((d) => `${d.file_name} (${money(d.size_bytes)} B)`).join(", ") : null}</Field>
        <Field label="Approval">{(r.approvals || []).length
          ? (r.approvals as any[]).map((a) => `level ${a.approval_level} ${a.status} by ${a.approver_name}`
            + `${a.comments ? `: ${a.comments}` : ""}`).join("; ")
          : r.status === "pending" ? "waiting at level 1" : r.approved_at ? "auto-approved (token)" : null}</Field>
      </div>
      <div className="md:col-span-2 mt-2">
        <div className="text-gray-500 mb-1">Line items</div>
        {items.length === 0 ? <div className="text-gray-500">—</div> : (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500"><th className="text-left font-normal">Description</th>
              <th className="text-right font-normal">Qty</th><th className="text-right font-normal">Unit price</th>
              <th className="text-right font-normal">Amount</th><th className="text-left font-normal pl-4">Notes</th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}><td>{it.description || "—"}</td><td className="text-right">{money(it.quantity)}</td>
                  <td className="text-right">{money(it.unit_price)}</td><td className="text-right">{money(it.amount)}</td>
                  <td className="pl-4">{it.notes || ""}</td></tr>
              ))}
              <tr className="font-medium"><td colSpan={3} className="text-right">Items total</td>
                <td className="text-right">{money(items.reduce((s, it) => s + Number(it.amount || 0), 0))} {r.currency}</td><td /></tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * The fake ERP's payment requests, newest first: what agents created, approved and marked paid, with Approve / Reject
 * for a pending one (the ERP's approval chain), and under each request every field the ERP's payment form carries.
 * Like every page it asks for UI_PASSWORD (middleware.ts); it is not in the menu.
 */
export default async function ErpRequests() {
  const rows = await listErpRequests();
  return (
    <>
      <div>
        <h2 className="page-title">ERP payment requests (sandbox)</h2>
        <p className="page-sub">What agents sent to the fake ChipChip ERP at <code>/erp/functions/v1/external-payment-requests</code>.
          Nothing here reaches the real ERP. Numbers PR-&lt;year&gt;-9xxxx and EXP-&lt;year&gt;-9xxxx are mock numbers.
          A pending request waits here for Approve or Reject, as it would for the ERP&apos;s approvers. Latest {rows.length}.</p>
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
                  <th className="text-right">Amount</th><th>Currency</th><th>Created</th><th>Approval / payment</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dc = departmentCategory(DEPARTMENTS, r.department_id, r.category_id);
                  const tags = [r.department_id && (dc.department || r.department_id.slice(0, 8)),
                    r.category_id && (dc.category || r.category_id.slice(0, 8))].filter(Boolean);
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="font-medium text-gray-900 whitespace-nowrap">{r.request_number}</td>
                        <td><span className={`badge ${COLOR[r.status] || "bg-gray-100 text-gray-800"}`}>{r.status}</span></td>
                        <td className="text-gray-700">{r.external_source}</td>
                        <td className="text-gray-700 break-all">{r.external_reference || "—"}</td>
                        <td className="text-gray-900 break-words">{r.title}
                          {tags.length > 0 && <div className="text-xs text-gray-500">{tags.join(" · ")}
                            {dc.category_not_in_department && <span className="text-red-700"> · category not in department</span>}</div>}</td>
                        <td className="text-gray-700 break-words">{r.vendor_name || ""}
                          {r.vendor_bank_account && <div className="text-xs text-gray-500">{[r.vendor_bank_name, r.vendor_bank_account].filter(Boolean).join(" ")}</div>}</td>
                        <td className="text-right whitespace-nowrap">{money(r.total_amount)}</td>
                        <td>{r.currency}</td>
                        <td className="whitespace-nowrap text-gray-500">{when(r.created_at)}</td>
                        <td className="text-xs text-gray-600 min-w-[14rem]">
                          {r.status === "paid" && (
                            <div>Paid {day(r.actual_payment_date)} · ref <span className="break-all">{r.payment_reference}</span>
                              <div>{r.expense_number}{r.paid_by ? ` · by ${r.paid_by}` : ""} · {when(r.paid_at)}</div></div>
                          )}
                          {r.status === "rejected" && (
                            <div>Rejected {when(r.rejected_at)}{r.rejection_reason ? `: ${r.rejection_reason}` : ""}</div>
                          )}
                          {r.status === "approved" && <div>Approved {when(r.approved_at)}, waiting for payment</div>}
                          {r.status === "pending" && (
                            <form action={decideErpTestRequest} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="request_number" value={r.request_number} />
                              <input name="comments" placeholder="Comment / reason" className="border rounded px-2 h-8 w-36" />
                              <button type="submit" name="decision" value="approved" className="btn-outline h-8">Approve</button>
                              <button type="submit" name="decision" value="rejected" className="btn-outline h-8">Reject</button>
                            </form>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={10} className="bg-gray-50">
                          <details>
                            <summary className="cursor-pointer text-xs text-gray-600">All fields of {r.request_number}</summary>
                            <div className="pt-2"><Details r={r} /></div>
                          </details>
                        </td>
                      </tr>
                    </Fragment>
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
