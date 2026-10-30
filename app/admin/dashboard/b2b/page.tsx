import { Search } from "lucide-react";
import { listCompanies } from "@/lib/admin";
import { StatusBadge, VatBadge } from "../../Badges";

export const dynamic = "force-dynamic";

/**
 * Copy of ChipChip Admin's B2B Customers screen (src/components/pages/b2b/B2BPage.tsx), Companies tab:
 * # / Business Name / TIN / Phone / Credit Limit / Payment Terms / VAT / Status / Credit / Wallet / View · Delete.
 * Customer Types, Products, Bidding, "+ Add Company" and Delete are shown but not copied.
 */

const money = (v: string | number) => Number(v).toLocaleString();

export default async function B2BCustomers({ searchParams }: { searchParams: { q?: string } }) {
  const { rows } = await listCompanies(1, 1000);
  const term = (searchParams.q || "").trim().toLowerCase();
  const companies = rows.filter((c) => !term || [c.business_name, c.tin, c.phone].some((v) => String(v || "").toLowerCase().includes(term)));
  const tab = (label: string, on = false) => (
    <span key={label} title={on ? undefined : "Not copied in the test"}
      className={`px-3 h-7 inline-flex items-center rounded-md text-[12px] font-medium ${on ? "bg-red-600 text-white shadow-sm" : "bg-white text-gray-400 shadow-sm"}`}>{label}</span>
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">B2B Customers</h2>
          <p className="text-[12px] text-gray-500">ChipChip Admin · companies, their linked users and wallet credit</p>
        </div>
        <span className="btn opacity-50 cursor-not-allowed" title="Not copied in the test">+ Add Company</span>
      </div>
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-gray-100">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {tab("Companies", true)}{tab("Customer Types")}{tab("Products")}{tab("Bidding")}
          </div>
          <form className="relative w-[20rem] max-w-full" action="/admin/dashboard/b2b">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input name="q" defaultValue={searchParams.q || ""} placeholder="Search by name, TIN or phone" className="field w-full pl-9" />
          </form>
        </div>
        <div className="tbl-wrap px-2 py-1">
          <table className="tbl text-[13px]">
            <thead>
              <tr>
                <th>#</th><th>Business Name</th><th>TIN</th><th>Phone</th><th className="num">Credit Limit</th><th>Payment Terms</th>
                <th className="!text-center">VAT</th><th className="!text-center">Status</th><th className="!text-center">Credit</th><th>Wallet</th><th></th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 && <tr><td colSpan={11} className="text-center text-gray-500">{term ? `No companies match “${searchParams.q}”.` : "No companies yet — add one to get started."}</td></tr>}
              {companies.map((c, i) => (
                <tr key={c.id}>
                  <td className="text-gray-400">{i + 1}</td>
                  <td><a href={`/admin/dashboard/b2b/${c.id}`} className="font-semibold text-gray-900 hover:underline">{c.business_name}</a></td>
                  <td className="text-gray-600">{c.tin || "—"}</td>
                  <td className="text-gray-600 tabular-nums whitespace-nowrap">{c.phone ? `+${c.phone}` : "—"}</td>
                  <td className="num font-medium tabular-nums">{money(c.credit_limit)}</td>
                  <td className="whitespace-nowrap">{c.payment_terms_days ? `${c.payment_terms_days} days` : "—"}</td>
                  <td className="text-center"><VatBadge chargeVat={c.charge_vat} /></td>
                  <td className="text-center"><StatusBadge status={c.status} /></td>
                  <td className="text-center"><StatusBadge status={c.credit_status} /></td>
                  <td>{c.wallet_account_id ? <span className="text-gray-400 text-[11px]" title={c.wallet_account_id}>Provisioned</span> : <span className="text-red-600 font-semibold text-[11px]">No wallet</span>}</td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <a href={`/admin/dashboard/b2b/${c.id}`} className="btn-outline h-8 text-[12px]">View</a>
                      <span className="btn-outline h-8 text-[12px] opacity-40 cursor-not-allowed" title="Not copied in the test">Delete</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
