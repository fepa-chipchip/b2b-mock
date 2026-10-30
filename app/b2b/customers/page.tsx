import { Search } from "lucide-react";
import { db, must } from "@/lib/db";
import { checkCustomerCreditStatus } from "@/lib/b2b";

export const dynamic = "force-dynamic";

/**
 * Copy of ChipChip B2B's Customers page (src/pages/Customers.tsx), reduced to the list: search, then the table
 * Name / Contact / Type / Credit Status / Status / Approval. Like the real page, the credit status shown is what
 * check_customer_credit_status computes for each customer.
 */

const creditBadge = (s: string) => ({
  good: ["Good Standing", "bg-green-100 text-green-800"], overdue: ["Overdue", "bg-amber-100 text-amber-800"],
  suspended: ["Suspended", "bg-red-100 text-red-800"], approved_override: ["Override Approved", "bg-blue-100 text-blue-800"],
  credit_limit_exceeded: ["Credit Limit Reached", "bg-orange-100 text-orange-800"], legal_process: ["Legal Process", "bg-red-100 text-red-800"],
} as Record<string, [string, string]>)[s] || [s, "bg-gray-100 text-gray-800"];

export default async function Customers({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q || "").trim().toLowerCase();
  const rows = (must(await db().from("b2b_customers").select("*, b2b_customer_types(name)").order("name")) as any[])
    .filter((c) => !q || [c.name, c.phone, c.address].some((v) => String(v || "").toLowerCase().includes(q)));
  const credit = new Map<string, any>();
  for (const c of rows) credit.set(c.id, await checkCustomerCreditStatus(c.id));
  return (
    <>
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Customers</h2>
      </div>
      <div className="inline-flex h-10 items-center rounded-md bg-muted p-1 text-muted-foreground w-fit">
        <span className="rounded-sm bg-white px-3 py-1.5 text-sm font-medium text-foreground shadow-sm">Customers</span>
      </div>
      <form className="relative" action="/b2b/customers">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input name="q" defaultValue={searchParams.q || ""} placeholder="Search by name, phone, or address..." className="field pl-10 w-full" />
      </form>
      <div className="card overflow-hidden">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Contact</th><th>Type</th><th>Credit Status</th><th>Status</th><th>Approval</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const cs = credit.get(c.id);
                const [label, color] = creditBadge(cs?.credit_status || c.credit_status);
                return (
                  <tr key={c.id}>
                    <td><div className="font-medium text-gray-900">{c.name}</div><div className="text-xs text-gray-500">{c.address}</div></td>
                    <td className="whitespace-nowrap">{c.phone || c.email}</td>
                    <td>{c.b2b_customer_types?.name}</td>
                    <td>
                      <span className={`badge ${color}`}>{label}</span>
                      {cs && "total_unpaid" in cs && <div className="text-xs text-gray-500 mt-1 whitespace-nowrap">Unpaid {Number(cs.total_unpaid).toLocaleString()} / {Number(c.credit_limit).toLocaleString()} ETB</div>}
                    </td>
                    <td><span className={`badge ${c.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{c.is_active ? "Active" : "Inactive"}</span></td>
                    <td><span className="badge bg-green-100 text-green-800 capitalize">{c.approval_status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
