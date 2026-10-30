/** Admin's StatusBadge and VatBadge (B2BPage.tsx), as the real screens show them. */
export function StatusBadge({ status }: { status?: string | null }) {
  const s = String(status || "").toUpperCase();
  const c = ["ACTIVE", "GOOD", "DELIVERED", "COMPLETED"].includes(s) ? "bg-green-100 text-green-800"
    : ["PENDING"].includes(s) ? "bg-yellow-100 text-yellow-800"
      : ["INACTIVE", "SUSPENDED", "CANCELLED", "OVERDUE"].includes(s) ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{s || "—"}</span>;
}

export function VatBadge({ chargeVat }: { chargeVat?: boolean | null }) {
  if (chargeVat === undefined || chargeVat === null) return <span className="text-gray-400 text-[11px]">—</span>;
  return chargeVat
    ? <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-[11px] font-semibold">Tax included</span>
    : <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-[11px] font-semibold">Tax not included</span>;
}
