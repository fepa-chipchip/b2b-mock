"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/** "Search orders..." + status + payment filters, applied as you type/pick (OrdersSearch.tsx). */
export default function OrdersSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const [term, setTerm] = useState(sp.get("search") || "");
  const go = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v && v !== "all") p.set(k, v); else p.delete(k);
    p.delete("page");
    router.push(`/b2b/orders?${p.toString()}`);
  };
  useEffect(() => {
    const t = setTimeout(() => { if (term !== (sp.get("search") || "")) go("search", term); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="relative flex-1">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"><Search className="h-4 w-4 text-gray-400" /></div>
        <input type="search" placeholder="Search orders..." className="field w-full pl-10 border border-gray-300" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      <div className="flex gap-2 flex-wrap">
        <select className="field w-[180px] bg-white border border-gray-300" value={sp.get("status") || "all"} onChange={(e) => go("status", e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="Processing">Processing</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Delivered">Delivered</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select className="field w-[180px] bg-white border border-gray-300" value={sp.get("payment") || "all"} onChange={(e) => go("payment", e.target.value)}>
          <option value="all">All Payments</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>
    </div>
  );
}
