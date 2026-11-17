import { db, must } from "@/lib/db";
import type { ErpStore, StoredErpRequest } from "@/lib/erpPayments";

/** The fake ERP's payment requests (supabase/erp_payment_requests.sql). Only the server (service role) reads it. */
export const ERP_TABLE = "erp_payment_requests";
const RETURNED = "id,request_number,status";

/** The store behind POST /erp/functions/v1/external-payment-requests. db() is reached only when a call gets that far. */
export function supabaseErpStore(): ErpStore {
  return {
    async findByReference(source, reference) {
      const r = await db().from(ERP_TABLE).select(RETURNED)
        .eq("external_source", source).eq("external_reference", reference).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return (r.data as StoredErpRequest | null) || null;
    },
    async insert(row) {
      const r = await db().from(ERP_TABLE).insert(row).select(RETURNED).single();
      if (r.error) {
        if (r.error.code === "23505") return { conflict: true };  // unique (external_source, external_reference)
        throw new Error(r.error.message);
      }
      return { row: r.data as StoredErpRequest };
    },
  };
}

/** Newest first, for the page /erp/requests. */
export async function listErpRequests(limit = 200): Promise<any[]> {
  return must(await db().from(ERP_TABLE).select("*").order("created_at", { ascending: false }).limit(limit)) as any[];
}

/** Deletes every mock request. The number sequence goes on, so an old PR-…-9xxxx never comes back for a new one. */
export async function clearErpRequests(): Promise<number> {
  const rows = must(await db().from(ERP_TABLE).delete().not("id", "is", null).select("id")) as { id: string }[];
  return rows.length;
}
