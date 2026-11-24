import { db, must } from "@/lib/db";
import type { ErpRow, ErpStore, MarkPaidOutcome, StoredErpRequest } from "@/lib/erpPayments";

/** The fake ERP's payment requests (supabase/erp_payment_requests.sql). Only the server (service role) reads it. */
export const ERP_TABLE = "erp_payment_requests";
const RETURNED = "id,request_number,status";

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const r = await db().rpc(fn, args);
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/**
 * The store behind /erp/functions/v1/external-payment-requests. db() is reached only when a call gets that far.
 * List, get one and mark paid are the SQL functions of supabase/erp_payment_requests.sql, the same ones the tests run.
 */
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
    async list(q) {
      return rpc<{ total: number; rows: ErpRow[] }>("erp_list_requests", {
        p_statuses: q.statuses, p_from: q.from, p_to: q.to, p_limit: q.limit, p_offset: q.offset });
    },
    async get(requestNumber) {
      return (await rpc<ErpRow | null>("erp_get_request", { p_request_number: requestNumber })) || null;
    },
    async markPaid(p) {
      return rpc<MarkPaidOutcome>("erp_mark_paid", {
        p_request_number: p.request_number, p_payment_reference: p.payment_reference, p_payment_date: p.payment_date,
        p_bank_account_id: p.bank_account_id, p_paid_by: p.paid_by });
    },
  };
}

/** Newest first, for the page /erp/requests. */
export async function listErpRequests(limit = 200): Promise<any[]> {
  return must(await db().from(ERP_TABLE).select("*").order("created_at", { ascending: false }).limit(limit)) as any[];
}

/** The page's Approve / Reject of a pending request (the ERP's approval chain, one level in the mock). */
export async function decideErpRequest(requestNumber: string, decision: "approved" | "rejected", comments: string) {
  return rpc<{ outcome: string }>("erp_decide_request", {
    p_request_number: requestNumber, p_decision: decision, p_by: "Sandbox approver", p_comments: comments });
}

/** Deletes every mock request. The number sequence goes on, so an old PR-…-9xxxx never comes back for a new one. */
export async function clearErpRequests(): Promise<number> {
  const rows = must(await db().from(ERP_TABLE).delete().not("id", "is", null).select("id")) as { id: string }[];
  return rows.length;
}
