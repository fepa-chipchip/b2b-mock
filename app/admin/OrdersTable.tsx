import type { OrderJson } from "@/lib/admin";
import { StatusBadge } from "./Badges";

/** Admin's placed-orders table (shared/OrdersTable.tsx): Date / Items / Delivery Location / Total / Status, one row per product. */
export default function OrdersTable({ orders }: { orders: OrderJson[] }) {
  if (orders.length === 0) return <div className="text-[12px] text-gray-500 p-3">No orders placed yet.</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl text-[13px]">
        <thead><tr><th>Date</th><th>Items</th><th>Delivery Location</th><th className="num">Total</th><th className="!text-center">Status</th></tr></thead>
        <tbody>
          {orders.map((o, i) => (
            <tr key={`${o.id}-${i}`}>
              <td className="text-gray-600 whitespace-nowrap">{new Date(o.created_at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}</td>
              <td>{o.item?.name ? `${o.item.name} x${o.item.quantity ?? "?"}` : "—"}</td>
              <td>{o.delivery_address?.delivery_location?.name || "—"}</td>
              <td className="num font-medium tabular-nums">{o.total_amount ?? o.subtotal ?? "—"} ETB</td>
              <td className="text-center"><StatusBadge status={o.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
