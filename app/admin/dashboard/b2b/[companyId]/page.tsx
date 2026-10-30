import { ArrowLeft, X } from "lucide-react";
import { db, must } from "@/lib/db";
import * as A from "@/lib/admin";
import { linkUserAction, unlinkUserAction } from "../../../actions";
import { StatusBadge, VatBadge } from "../../../Badges";
import OrdersTable from "../../../OrdersTable";
import Feedback from "../../../../Feedback";

export const dynamic = "force-dynamic";

/**
 * Copy of ChipChip Admin's company page (B2BPage.tsx, company detail): Back, name, phone • TIN • Created, Edit,
 * VAT and status badges; tabs Linked Users / Financial Summary / Settlement Report. Linked Users has "Link User"
 * (search + MEMBER/ADMIN + Link) and the table # / Name / Phone / Role with Place Order / Orders / Unlink.
 */

const money = (v: string | number) => Number(v).toLocaleString();
const created = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

type SP = { tab?: string; orders?: string };

export default async function Company({ params, searchParams }: { params: { companyId: string }; searchParams: SP }) {
  let company: Awaited<ReturnType<typeof A.getCompany>>;
  try { company = await A.getCompany(params.companyId); }
  catch { return <div className="card p-6 text-gray-500">Company not found. <a className="text-red-700 underline" href="/admin/dashboard/b2b">Back</a></div>; }
  const tab = searchParams.tab || "users";
  const users = await A.linkedUsers(company.id);
  const statement = await A.statement(company.id);
  const linkedIds = new Set(users.map((u) => u.user_id));
  const allUsers = (must(await db().from("adm_users").select("id,name,phone").eq("is_system", false).order("name")) as any[]).filter((u) => !linkedIds.has(u.id));
  const base = `/admin/dashboard/b2b/${company.id}`;
  const tabBtn = (key: string, label: string, extra?: React.ReactNode) => (
    <a key={key} href={`${base}?tab=${key}`} className={`px-3 h-8 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 ${
      tab === key ? "bg-red-600 text-white shadow-sm" : "bg-white text-gray-600 border border-gray-300 shadow-sm hover:bg-gray-50"}`}>{label}{extra}</a>
  );

  return (
    <>
      <div className="rounded-xl border bg-white shadow-sm p-4 flex flex-wrap items-center gap-3">
        <a href="/admin/dashboard/b2b" className="btn-outline h-8 text-[12px]"><ArrowLeft size={14} /> Back</a>
        <div className="flex flex-col gap-1">
          <span className="font-bold text-[18px] text-gray-900">{company.business_name}</span>
          <span className="text-[11px] text-gray-500">
            {company.phone ? `+${company.phone} • ` : ""}TIN: {company.tin || "—"}{company.created_at && ` • Created ${created(company.created_at)}`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="btn-outline h-8 text-[12px] opacity-40 cursor-not-allowed" title="Not copied in the test">Edit</span>
          <VatBadge chargeVat={company.charge_vat} />
          <StatusBadge status={company.status} />
        </div>
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 p-2 border-b border-gray-100">
          {tabBtn("users", "Linked Users", users.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold ring-1 ring-white">{users.length}</span>))}
          {tabBtn("summary", "Financial Summary")}
          {tabBtn("settlements", "Settlement Report")}
        </div>

        {tab === "users" && (
          <div className="p-4 flex flex-col gap-4">
            <form action={linkUserAction} className="rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
              <span className="font-semibold text-[13px] text-gray-900">Link User</span>
              <input type="hidden" name="company_id" value={company.id} />
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input name="user" list="admin-users" placeholder="Search user by name, phone or email" className="field flex-1 min-w-0" />
                <datalist id="admin-users">
                  {allUsers.map((u) => <option key={u.id} value={`${u.name} · +${u.phone}`} />)}
                </datalist>
                <select name="role" defaultValue="MEMBER" className="field sm:w-32 shrink-0">
                  <option value="MEMBER">MEMBER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
                <button type="submit" className="btn sm:w-24 shrink-0 bg-green-600 hover:bg-green-700">Link</button>
              </div>
            </form>
            <div className="tbl-wrap">
              <table className="tbl text-[13px]">
                <thead><tr><th>#</th><th>Name</th><th>Phone</th><th className="!text-center">Role</th><th></th></tr></thead>
                <tbody>
                  {users.length === 0 && <tr><td colSpan={5} className="text-center text-gray-500">No users linked yet.</td></tr>}
                  {users.map((l, i) => (
                    <tr key={l.id}>
                      <td className="text-gray-400">{i + 1}</td>
                      <td className="font-medium text-gray-900">{l.user?.name || "—"}</td>
                      <td className="text-gray-600">{l.user?.phone || "—"}</td>
                      <td className="text-center text-gray-600">{l.role}</td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <a href={`${base}/order?userId=${l.user_id}`} className="btn h-8 text-[12px] bg-green-600 hover:bg-green-700">Place Order</a>
                          <a href={`${base}?tab=users&orders=${l.user_id}`} className="btn h-8 text-[12px] bg-amber-500 hover:bg-amber-600">Orders</a>
                          <form action={unlinkUserAction}>
                            <input type="hidden" name="company_id" value={company.id} />
                            <input type="hidden" name="user_id" value={l.user_id} />
                            <button type="submit" className="btn-outline h-8 text-[12px]">Unlink</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "summary" && (
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {[["Credit Limit", statement.credit_limit], ["Balance", statement.balance], ["Amount Owed", statement.amount_owed], ["Available Credit", statement.available_credit]]
              .map(([label, v]) => (
                <div key={label} className="rounded-xl border border-gray-200 p-3">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
                  <div className="font-bold text-[16px] tabular-nums text-gray-900">{money(v)} ETB</div>
                </div>
              ))}
            <p className="col-span-full text-[11px] text-gray-400">Set credit limit and Record settlement are not copied in the test.</p>
          </div>
        )}

        {tab === "settlements" && <div className="p-4 text-[12px] text-gray-500">The settlement report is not copied in the test.</div>}
      </div>

      {searchParams.orders && <OrdersModal userId={searchParams.orders} close={`${base}?tab=users`} />}
    </>
  );
}

/** "Orders" button: the linked user's placed group orders (B2BOrdersModal). */
async function OrdersModal({ userId, close }: { userId: string; close: string }) {
  let name = "";
  let orders: Awaited<ReturnType<typeof A.ordersOf>>["rows"] = [];
  try {
    name = (await A.findUser(userId)).user.name;
    orders = (await A.ordersOf(userId, 1, 50)).rows;
  } catch { return null; }
  const fb = must(await db().from("feedback").select("*").eq("about", `admin-orders:${userId}`).order("id")) as any[];
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start sm:items-center justify-center p-2 sm:p-4">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border bg-white p-5 shadow-lg">
        <a href={close} className="absolute right-4 top-4 opacity-70 hover:opacity-100" aria-label="Close"><X className="h-4 w-4" /></a>
        <h2 className="font-bold text-[16px] text-gray-900">Orders — {name}</h2>
        <div className="mt-3"><OrdersTable orders={orders} /></div>
        <Feedback about={`admin-orders:${userId}`} given={fb} />
      </div>
    </div>
  );
}
