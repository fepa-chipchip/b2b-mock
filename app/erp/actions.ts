"use server";
import { revalidatePath } from "next/cache";
import { clearErpRequests, decideErpRequest } from "@/lib/erpStore";

/** "Clear test requests" on /erp/requests: deletes every mock payment request. The page asks for UI_PASSWORD. */
export async function clearErpTestRequests() {
  await clearErpRequests();
  revalidatePath("/erp/requests");
}

/**
 * Approve / Reject on /erp/requests: what the ERP's approval chain does to a pending request, so a test can move it to
 * approved (then mark_paid works) or rejected. Only a pending request moves; anything else is left as it is.
 */
export async function decideErpTestRequest(form: FormData) {
  const number = String(form.get("request_number") || "").trim();
  const decision = form.get("decision") === "rejected" ? "rejected" : "approved";
  const comments = String(form.get("comments") || "").trim().slice(0, 500);
  if (number) await decideErpRequest(number, decision, comments);
  revalidatePath("/erp/requests");
}
