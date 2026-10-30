import PlaceOrder from "./PlaceOrder";

export const dynamic = "force-dynamic";

/** /admin/dashboard/b2b/<companyId>/order?userId=<linked user>  (real: /dashboard/b2b/<companyId>/order?userId=...) */
export default function PlaceOrderPage({ params, searchParams }: { params: { companyId: string }; searchParams: { userId?: string } }) {
  return <PlaceOrder companyId={params.companyId} userId={searchParams.userId || ""} />;
}
