"use server";
import { revalidatePath } from "next/cache";
import { clearErpRequests } from "@/lib/erpStore";

/** "Clear test requests" on /erp/requests: deletes every mock payment request. The page asks for UI_PASSWORD. */
export async function clearErpTestRequests() {
  await clearErpRequests();
  revalidatePath("/erp/requests");
}
