/* ---------- Fake ChipChip ERP: "external payment requests" (guide v2) ----------
 * The real API: https://<erp-project>.supabase.co/functions/v1/external-payment-requests with
 * `Authorization: Bearer <API_TOKEN>`. One path, two methods:
 *   POST                     create a payment request (200; 200 `duplicate: true` for a repeated external_reference)
 *   POST {action:"mark_paid"} mark an approved request paid (200; 200 `already_paid: true`; 409 if not approved; 404)
 *   GET ?status&from&to&limit&offset   list, newest first, with the total
 *   GET ?request_number=PR-...         one request with its approvals and history (404 if unknown)
 * Anything else: 405. This copy answers on /erp/functions/v1/external-payment-requests with the same bodies, statuses
 * and errors, so an agent can be tested without touching real payment requests, and pointed at the real ERP later by
 * changing only the base URL and the token.
 *
 * Every token has a System Name (stored as `external_source` on each request it creates) and an Auto-approve flag
 * (on: the request is "approved" at once; off: "pending", waiting for the ERP's approval chain, which here is the
 * Approve / Reject buttons of the page /erp/requests). The same token reads and marks paid, any request.
 * Idempotency: (external_source, external_reference) is unique; a retry with the same reference gets the ORIGINAL request
 * back with `duplicate: true` and 200. Mark-paid twice: the second answers 200 `already_paid: true` with the FIRST
 * payment's reference, date and expense number.
 *
 * Test switch, mock only: an external_reference starting with "FAIL500-" creates the request AND answers 500, as the
 * real API may after it has written the row; a retry with the same reference then answers 200 duplicate. Likewise a
 * mark_paid whose payment_reference starts with "FAIL500-" marks the request paid AND answers 500; the retry answers
 * 200 already_paid.
 *
 * Tokens: from the Vercel variables ERP_MOCK_TOKENS / ERP_MOCK_TOKEN, and from lib/erpMockTokens.json, a committed list
 * of sha256 hashes (the tokens themselves stay in the user's .env.local), so the mock works with no Vercel variable.
 *
 * Documents: only file_name, file_type and the decoded size are kept; the base64 itself is never stored.
 *
 * No `@/` imports on purpose: tests/erp_payments.test.mjs loads this file straight into Node.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type ErpToken = {
  /** The token itself (ERP_MOCK_TOKENS / ERP_MOCK_TOKEN), or ... */
  token?: string;
  /** ... only its sha256, hex of its UTF-8 bytes (the committed lib/erpMockTokens.json, so the token is never in git). */
  sha256?: string;
  system_name: string;
  auto_approve: boolean;
  /** Mock only, to test the 401s: a revoked token, or one past its expiry (ISO date or timestamp). */
  revoked?: boolean;
  expires_at?: string;
};

export type ErpDocumentMeta = { file_name: string; file_type: string | null; size_bytes: number };
export type ErpAllocation = { business_unit: string; percentage: number };
export type ErpItem = {
  description: string | null; quantity: number | null; unit_price: number | null; amount: number | null; notes: string | null;
};

/** The row written to erp_payment_requests (id and request_number come from the database). */
export type NewErpRequest = {
  external_source: string;
  external_reference: string | null;
  status: "approved" | "pending";
  title: string;
  description: string | null;
  amount: number;
  total_amount: number;
  currency: string;
  vendor_name: string | null;
  vendor_bank_name: string | null;
  vendor_bank_account: string | null;
  vendor_bank_branch: string | null;
  payment_method: string;
  preferred_payment_date: string | null;
  department_id: string | null;
  category_id: string | null;
  business_unit: string;
  vat_applicable: boolean;
  vat_amount: number;
  requester_first_name: string | null;
  requester_last_name: string | null;
  requester_email: string | null;
  items: ErpItem[];
  documents: ErpDocumentMeta[];
  allocations: ErpAllocation[];
};

export type StoredErpRequest = { id: string; request_number: string; status: string };

/** A whole stored row as the database's to_jsonb gives it (supabase/erp_payment_requests.sql). */
export type ErpRow = Record<string, any>;

export type ErpListQuery = { statuses: string[] | null; from: string | null; to: string | null; limit: number; offset: number };

export type MarkPaidInput = {
  request_number: string; payment_reference: string; payment_date: string; bank_account_id: string | null; paid_by: string;
};
/** erp_mark_paid's answer: paid / already_paid carry the payment, not_approved the current status. */
export type MarkPaidOutcome =
  | { outcome: "paid" | "already_paid"; request_number: string; status: string; payment_reference: string;
      payment_date: string; expense_number: string }
  | { outcome: "not_approved"; request_number: string; status: string }
  | { outcome: "not_found" };

export interface ErpStore {
  findByReference(externalSource: string, externalReference: string): Promise<StoredErpRequest | null>;
  /** `conflict` when (external_source, external_reference) already exists (a retry that raced the first call). */
  insert(row: NewErpRequest): Promise<{ row: StoredErpRequest } | { conflict: true }>;
  /** erp_list_requests: `to` is already the exclusive end (the day after the asked `to`), as an ISO timestamp. */
  list(q: ErpListQuery): Promise<{ total: number; rows: ErpRow[] }>;
  /** erp_get_request. */
  get(requestNumber: string): Promise<ErpRow | null>;
  /** erp_mark_paid: one transaction, the row locked. */
  markPaid(p: MarkPaidInput): Promise<MarkPaidOutcome>;
}

export const MAX_DOCUMENTS = 10;
export const FAIL500_PREFIX = "FAIL500-";
export const DEFAULT_SOURCE = "zeami-test";

/**
 * The ERP's departments and their categories (cost positions): lib/erpDepartments.json, read from the ERP staging
 * payment form (15 departments, 100 category entries; "Salary" sits under both Administration and Operations). Its
 * SOURCING id and SOURCING's two categories are the ones in the ERP guide. For the page only: the API accepts any uuid,
 * and a category outside the sent department, as the guide documents no refusal for either.
 */
export type ErpDepartment = { id: string; name: string; code: string; categories: { id: string; name: string; code: string }[] };

/**
 * What the page says about a request's department_id / category_id: their names when known, and whether the category is
 * outside the department (only said when both are sent and the department is known).
 */
export function departmentCategory(list: ErpDepartment[], departmentId: string | null, categoryId: string | null) {
  const dep = departmentId ? list.find((d) => d.id === departmentId.toLowerCase()) || null : null;
  const cid = categoryId ? categoryId.toLowerCase() : null;
  const cat = cid ? (dep?.categories.find((c) => c.id === cid)
    || list.flatMap((d) => d.categories).find((c) => c.id === cid) || null) : null;
  return {
    department: dep ? dep.name : null,
    category: cat ? cat.name : null,
    category_code: cat ? cat.code : null,
    category_not_in_department: !!(dep && cid && !dep.categories.some((c) => c.id === cid)),
  };
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fail = (error: string, status: number, headers: Record<string, string> = {}) =>
  json({ success: false, error }, status, headers);

const truthy = (v: unknown, dflt: boolean) => {
  if (v === undefined || v === null || v === "") return dflt;
  if (typeof v === "boolean") return v;
  return !["false", "0", "no", "off"].includes(String(v).trim().toLowerCase());
};

/**
 * The tokens the mock accepts. ERP_MOCK_TOKENS = JSON list of {token, system_name, auto_approve, revoked?, expires_at?};
 * else one token from ERP_MOCK_TOKEN (+ ERP_MOCK_SOURCE, default "zeami-test", + ERP_MOCK_AUTO_APPROVE, default true).
 * Throws when ERP_MOCK_TOKENS is set but is not such a list (the route then answers 500 and says why in the log).
 */
export function loadTokens(env: Record<string, string | undefined> = process.env): ErpToken[] {
  const list = (env.ERP_MOCK_TOKENS || "").trim();
  if (list) {
    let parsed: unknown;
    try { parsed = JSON.parse(list); } catch { throw new Error("ERP_MOCK_TOKENS is not valid JSON"); }
    if (!Array.isArray(parsed)) throw new Error("ERP_MOCK_TOKENS must be a JSON list");
    return parsed.map((t, i) => {
      if (!t || typeof t !== "object" || typeof (t as any).token !== "string" || !(t as any).token)
        throw new Error(`ERP_MOCK_TOKENS[${i}] needs a token`);
      const o = t as Record<string, unknown>;
      return {
        token: String(o.token),
        system_name: String(o.system_name || DEFAULT_SOURCE),
        auto_approve: truthy(o.auto_approve, true),
        ...(o.revoked !== undefined ? { revoked: truthy(o.revoked, false) } : {}),
        ...(o.expires_at ? { expires_at: String(o.expires_at) } : {}),
      };
    });
  }
  const one = (env.ERP_MOCK_TOKEN || "").trim();
  if (!one) return [];
  return [{
    token: one,
    system_name: (env.ERP_MOCK_SOURCE || "").trim() || DEFAULT_SOURCE,
    auto_approve: truthy(env.ERP_MOCK_AUTO_APPROVE, true),
  }];
}

/**
 * The committed tokens (lib/erpMockTokens.json): a JSON list of {sha256, system_name, auto_approve, revoked?, expires_at?},
 * sha256 = hex of the token's UTF-8 bytes. Rotating a token = replacing its hash. Throws when the list is malformed
 * (the route then answers 500 and says why in the log).
 */
export function loadHashedTokens(list: unknown, name = "lib/erpMockTokens.json"): ErpToken[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`${name} must be a JSON list`);
  return list.map((t, i) => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const h = typeof o.sha256 === "string" ? o.sha256.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`${name}[${i}] needs a sha256 (64 hex characters)`);
    if ("token" in o) throw new Error(`${name}[${i}] must hold only the hash, never the token`);
    return {
      sha256: h,
      system_name: String(o.system_name || DEFAULT_SOURCE),
      auto_approve: truthy(o.auto_approve, true),
      ...(o.revoked !== undefined ? { revoked: truthy(o.revoked, false) } : {}),
      ...(o.expires_at ? { expires_at: String(o.expires_at) } : {}),
    };
  });
}

/** Every token the mock accepts: the Vercel variables first (as before), then the committed hashes. */
export function allTokens(env: Record<string, string | undefined> = process.env, committed?: unknown): ErpToken[] {
  return [...loadTokens(env), ...loadHashedTokens(committed)];
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
const expected = (t: ErpToken) => (t.sha256 ? Buffer.from(t.sha256, "hex") : digest(t.token || ""));

/**
 * Constant-time: the presented token's sha256 is compared with every token's (equal-length digests), whichever matches.
 * A committed entry is only its hash, so it is compared as is.
 */
export function findToken(got: string, tokens: ErpToken[]): ErpToken | null {
  const g = digest(got);
  let found: ErpToken | null = null;
  for (const t of tokens) {
    const want = expected(t);
    if (want.length === g.length && timingSafeEqual(g, want) && !found) found = t;
  }
  return found;
}

/** Raw base64 only (no `data:` prefix); line breaks allowed. Returns the decoded size in bytes, or null if invalid. */
export function base64Size(b64: string): number | null {
  const s = b64.replace(/[\r\n]/g, "");
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const has = (v: unknown) => v !== undefined && v !== null;
/** A real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
const isDate = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Validates the body. Returns the row to write, or an error message for a 400. */
export function parseBody(body: unknown, token: ErpToken): { row: NewErpRequest } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Request body must be a JSON object" };
  const b = body as Record<string, unknown>;

  if (typeof b.title !== "string" || !b.title.trim()) return { error: "title is required" };
  if (!has(b.total_amount)) return { error: "total_amount is required" };
  if (!isNum(b.total_amount) || b.total_amount <= 0) return { error: "total_amount must be a number greater than 0" };
  if (has(b.amount) && (!isNum(b.amount) || b.amount <= 0)) return { error: "amount must be a number greater than 0" };
  if (has(b.vat_amount) && (!isNum(b.vat_amount) || b.vat_amount < 0)) return { error: "vat_amount must be a number, 0 or more" };
  if (has(b.vat_applicable) && typeof b.vat_applicable !== "boolean") return { error: "vat_applicable must be true or false" };

  // Text fields: a number (e.g. a bank account) is kept as text, as the ERP's text columns would.
  const TEXT = ["external_reference", "description", "currency", "vendor_name", "vendor_bank_name", "vendor_bank_account",
    "vendor_bank_branch", "payment_method", "business_unit", "requester_first_name", "requester_last_name", "requester_email"];
  const text: Record<string, string | null> = {};
  for (const k of TEXT) {
    const v = b[k];
    if (!has(v) || v === "") { text[k] = null; continue; }
    if (typeof v !== "string" && !isNum(v)) return { error: `${k} must be a string` };
    text[k] = String(v).trim() || null;
  }

  let date: string | null = null;
  if (has(b.preferred_payment_date) && b.preferred_payment_date !== "") {
    const d = b.preferred_payment_date;
    if (!isDate(d)) return { error: "preferred_payment_date must be a date YYYY-MM-DD" };
    date = d;
  }
  const ids: Record<string, string | null> = {};
  for (const k of ["department_id", "category_id"]) {
    const v = b[k];
    if (!has(v) || v === "") { ids[k] = null; continue; }
    if (typeof v !== "string" || !UUID.test(v)) return { error: `${k} must be a uuid` };
    ids[k] = v.toLowerCase();
  }

  const documents: ErpDocumentMeta[] = [];
  if (has(b.documents)) {
    if (!Array.isArray(b.documents)) return { error: "documents must be a list" };
    if (b.documents.length > MAX_DOCUMENTS) return { error: `documents: at most ${MAX_DOCUMENTS} files per request` };
    for (const [i, d] of b.documents.entries()) {
      if (!d || typeof d !== "object") return { error: `documents[${i}] must be an object {file_name, file_type, base64}` };
      const o = d as Record<string, unknown>;
      if (typeof o.file_name !== "string" || !o.file_name.trim()) return { error: `documents[${i}].file_name is required` };
      if (has(o.file_type) && typeof o.file_type !== "string") return { error: `documents[${i}].file_type must be a string` };
      const size = typeof o.base64 === "string" ? base64Size(o.base64) : null;
      if (size === null || size === 0)
        return { error: `documents[${i}].base64 is not valid base64 (send the raw base64, without a data: prefix)` };
      documents.push({ file_name: o.file_name.trim(), file_type: (o.file_type as string) || null, size_bytes: size });
    }
  }

  const items: ErpItem[] = [];
  if (has(b.items)) {
    if (!Array.isArray(b.items)) return { error: "items must be a list" };
    for (const [i, it] of b.items.entries()) {
      if (!it || typeof it !== "object" || Array.isArray(it))
        return { error: `items[${i}] must be an object {description, quantity, unit_price, amount, notes}` };
      const o = it as Record<string, unknown>;
      for (const k of ["quantity", "unit_price", "amount"])
        if (has(o[k]) && !isNum(o[k])) return { error: `items[${i}].${k} must be a number` };
      for (const k of ["description", "notes"])
        if (has(o[k]) && typeof o[k] !== "string") return { error: `items[${i}].${k} must be a string` };
      items.push({
        description: (o.description as string | undefined)?.trim() || null,
        quantity: isNum(o.quantity) ? o.quantity : null,
        unit_price: isNum(o.unit_price) ? o.unit_price : null,
        amount: isNum(o.amount) ? o.amount : null,
        notes: (o.notes as string | undefined)?.trim() || null,
      });
    }
  }

  const allocations: ErpAllocation[] = [];
  if (has(b.allocations)) {
    if (!Array.isArray(b.allocations)) return { error: "allocations must be a list" };
    for (const [i, a] of b.allocations.entries()) {
      const o = (a || {}) as Record<string, unknown>;
      if (typeof o.business_unit !== "string" || !o.business_unit.trim() || !isNum(o.percentage))
        return { error: `allocations[${i}] must be {business_unit, percentage}` };
      allocations.push({ business_unit: o.business_unit.trim(), percentage: o.percentage });
    }
  }

  const total = b.total_amount as number;
  return {
    row: {
      external_source: token.system_name,
      external_reference: text.external_reference,
      status: token.auto_approve ? "approved" : "pending",
      title: (b.title as string).trim(),
      description: text.description,
      amount: isNum(b.amount) ? b.amount : total,
      total_amount: total,
      currency: text.currency || "ETB",
      vendor_name: text.vendor_name,
      vendor_bank_name: text.vendor_bank_name,
      vendor_bank_account: text.vendor_bank_account,
      vendor_bank_branch: text.vendor_bank_branch,
      payment_method: text.payment_method || "bank_transfer",
      preferred_payment_date: date,
      department_id: ids.department_id,
      category_id: ids.category_id,
      business_unit: text.business_unit || "chipchip",
      vat_applicable: b.vat_applicable === true,
      vat_amount: isNum(b.vat_amount) ? b.vat_amount : 0,
      requester_first_name: text.requester_first_name,
      requester_last_name: text.requester_last_name,
      requester_email: text.requester_email,
      items,
      documents,
      allocations,
    },
  };
}


const duplicate = (r: StoredErpRequest) =>
  json({ success: true, duplicate: true, request_id: r.id, request_number: r.request_number, status: r.status }, 200);

export type ErpDeps = {
  store: ErpStore;
  tokens: () => ErpToken[];
  now?: () => Date;
  log?: (line: string) => void;
};

/* ---------- reading: the answer shapes of GET (guide v2, sections 3 and 4) ---------- */

/** `status` filter of the list: `pending` covers every waiting status the real ERP uses. */
export const STATUS_FILTERS: Record<string, string[]> = {
  pending: ["pending_approval", "pending", "submitted"],
  approved: ["approved"],
  paid: ["paid"],
  rejected: ["rejected"],
};
export const LIST_DEFAULT_LIMIT = 100;
export const LIST_MAX_LIMIT = 500;
export const MAX_PAYMENT_REFERENCE = 200;

const ts = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const day = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const textOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** One request as the list answers it: exactly the guide's fields, in its order. */
export function apiRequest(r: ErpRow) {
  return {
    id: r.id,
    request_number: r.request_number,
    title: r.title,
    description: textOrNull(r.description),
    status: r.status,
    vendor_name: textOrNull(r.vendor_name),
    vendor_bank_name: textOrNull(r.vendor_bank_name),
    vendor_bank_account: textOrNull(r.vendor_bank_account),
    vendor_bank_branch: textOrNull(r.vendor_bank_branch),
    amount: numOrNull(r.amount),
    vat_amount: numOrNull(r.vat_amount) ?? 0,
    total_amount: numOrNull(r.total_amount),
    currency: r.currency,
    payment_method: r.payment_method,
    preferred_payment_date: day(r.preferred_payment_date),
    business_unit: r.business_unit,
    external_source: textOrNull(r.external_source),
    external_reference: textOrNull(r.external_reference),
    submitted_at: ts(r.submitted_at ?? r.created_at),
    approved_at: ts(r.approved_at),
    paid_at: ts(r.paid_at),
    payment_reference: textOrNull(r.payment_reference),
    actual_payment_date: day(r.actual_payment_date),
    rejection_reason: textOrNull(r.rejection_reason),
    rejected_at: ts(r.rejected_at),
    created_at: ts(r.created_at),
    // No requester sent: the real ERP names the token's owner; the mock's tokens are owned by "External System".
    requester_first_name: textOrNull(r.requester_first_name) ?? "External",
    requester_last_name: textOrNull(r.requester_last_name) ?? "System",
    requester_email: textOrNull(r.requester_email),
    documents: ((r.documents || []) as { file_name?: string }[]).map((d) => d?.file_name).filter(Boolean) as string[],
  };
}

type Approval = { approver_id: string | null; approver_name: string | null; approval_level: number | null;
  status: string; comments: string | null; approved_at: string | null; decided_at: string | null };

function approvalsOf(r: ErpRow): Approval[] {
  return ((r.approvals || []) as Record<string, unknown>[]).map((a) => ({
    approver_id: textOrNull(a.approver_id),
    approver_name: textOrNull(a.approver_name),
    approval_level: numOrNull(a.approval_level),
    status: String(a.status || ""),
    comments: textOrNull(a.comments),
    approved_at: ts(a.approved_at),
    // When a rejection was decided (approved_at stays null): the row's rejected_at.
    decided_at: ts(a.approved_at) ?? (a.status === "rejected" ? ts(r.rejected_at) : null),
  }));
}

/** The lifecycle, oldest first: submitted, each approval level, approved or rejected, paid. */
export function historyOf(r: ErpRow) {
  type Ev = { event: string; at: string | null; by?: string | null; comments?: string | null; reason?: string | null;
    reference?: string | null };
  const out: Ev[] = [{ event: "submitted", at: ts(r.submitted_at ?? r.created_at) }];
  for (const a of approvalsOf(r)) {
    const ev: Ev = { event: `level_${a.approval_level ?? 1}_${a.status}`, at: a.decided_at, by: a.approver_name };
    if (a.comments) ev.comments = a.comments;
    out.push(ev);
  }
  if (r.approved_at) out.push({ event: "approved", at: ts(r.approved_at) });
  if (r.rejected_at) {
    const ev: Ev = { event: "rejected", at: ts(r.rejected_at), by: textOrNull(r.rejected_by) };
    if (r.rejection_reason) ev.reason = String(r.rejection_reason);
    out.push(ev);
  }
  if (r.paid_at) out.push({ event: "paid", at: ts(r.paid_at), by: textOrNull(r.paid_by), reference: textOrNull(r.payment_reference) });
  // Stable: events at the same moment keep the order above (level_1_approved before approved).
  return out.map((e, i) => ({ e, i }))
    .sort((x, y) => (Date.parse(x.e.at || "") || 0) - (Date.parse(y.e.at || "") || 0) || x.i - y.i)
    .map(({ e }) => e);
}

/** GET ?request_number=...: the request (list fields + three), its approvals and its history. */
export function apiRequestDetail(r: ErpRow) {
  return {
    success: true,
    request: { ...apiRequest(r), current_approval_level: numOrNull(r.current_approval_level),
      paid_by: textOrNull(r.paid_by), rejected_by: textOrNull(r.rejected_by) },
    approvals: approvalsOf(r).map(({ decided_at: _d, ...a }) => a),
    history: historyOf(r),
  };
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString();
const intParam = (v: string | null, dflt: number, min: number, max: number) => {
  if (v === null || v.trim() === "" || !/^-?\d+$/.test(v.trim())) return dflt;
  return Math.min(max, Math.max(min, parseInt(v.trim(), 10)));
};

/** Validates the list's query. `limit` and `offset` are clamped (1-500, >= 0), never refused. */
export function parseListQuery(params: URLSearchParams): { query: ErpListQuery } | { error: string } {
  let statuses: string[] | null = null;
  const status = params.get("status");
  if (status !== null && status.trim() !== "") {
    statuses = STATUS_FILTERS[status.trim()] || null;
    if (!statuses) return { error: `Invalid status filter. Use one of: ${Object.keys(STATUS_FILTERS).join(", ")}` };
  }
  const dates: Record<string, string | null> = {};
  for (const k of ["from", "to"]) {
    const v = params.get(k);
    if (v === null || v.trim() === "") { dates[k] = null; continue; }
    if (!isDate(v.trim())) return { error: `${k} must be a date YYYY-MM-DD` };
    dates[k] = v.trim();
  }
  return { query: {
    statuses,
    from: dates.from ? `${dates.from}T00:00:00.000Z` : null,
    to: dates.to ? nextDay(dates.to) : null,
    limit: intParam(params.get("limit"), LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT),
    offset: intParam(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER),
  } };
}

/** Validates a mark_paid body. `payment_date` defaults to today (UTC). */
export function parseMarkPaid(b: Record<string, unknown>, token: ErpToken, today: string):
    { input: MarkPaidInput } | { error: string } {
  const rn = typeof b.request_number === "string" ? b.request_number.trim() : "";
  if (!rn) return { error: "request_number is required" };
  const ref = typeof b.payment_reference === "string" || isNum(b.payment_reference) ? String(b.payment_reference).trim() : "";
  if (!ref) return { error: "payment_reference is required" };
  if (ref.length > MAX_PAYMENT_REFERENCE) return { error: `payment_reference must be at most ${MAX_PAYMENT_REFERENCE} characters` };
  let date = today;
  if (has(b.payment_date) && b.payment_date !== "") {
    if (!isDate(b.payment_date)) return { error: "payment_date must be a date YYYY-MM-DD" };
    date = b.payment_date;
  }
  let bank: string | null = null;
  if (has(b.bank_account_id) && b.bank_account_id !== "") {
    if (typeof b.bank_account_id !== "string" || !UUID.test(b.bank_account_id)) return { error: "bank_account_id must be a uuid" };
    bank = b.bank_account_id.toLowerCase();
  }
  return { input: { request_number: rn, payment_reference: ref, payment_date: date, bank_account_id: bank,
    paid_by: token.system_name } };
}

/* ---------- the call ---------- */

/**
 * The whole API: 405, 401, then GET (list / one: 200, 400, 404) or POST (create: 200, 200 duplicate; mark_paid: 200,
 * 200 already_paid, 404, 409), 400, 500. Never throws.
 */
export async function handleExternalPaymentRequest(req: Request, deps: ErpDeps): Promise<Response> {
  const log = deps.log || ((l: string) => console.log(l));
  if (req.method !== "POST" && req.method !== "GET") return fail("Method not allowed", 405, { allow: "GET, POST" });

  let tokens: ErpToken[];
  try { tokens = deps.tokens(); } catch (e) {
    log(`erp mock: ${(e as Error).message}`);
    return fail("Internal server error", 500);
  }
  const auth = req.headers.get("authorization") || "";
  const got = auth.replace(/^Bearer\s+/i, "").trim();
  if (!/^Bearer\s+/i.test(auth) || !got) return fail("Missing API token", 401);
  const token = findToken(got, tokens);
  if (!token) return fail("Invalid API token", 401);
  if (token.revoked) return fail("API token has been revoked", 401);
  const now = deps.now ? deps.now() : new Date();
  if (token.expires_at) {
    const exp = Date.parse(token.expires_at);
    if (!Number.isNaN(exp) && exp <= now.getTime()) return fail("API token has expired", 401);
  }

  if (req.method === "GET") return read(new URL(req.url).searchParams, deps.store, log);

  let body: unknown;
  try { body = JSON.parse(await req.text()); } catch { return fail("Invalid JSON body", 400); }
  if (body && typeof body === "object" && !Array.isArray(body) && has((body as Record<string, unknown>).action)) {
    const action = (body as Record<string, unknown>).action;
    if (action !== "mark_paid")
      return fail(`Unknown action. The only action is "mark_paid"; leave action out to create a payment request`, 400);
    return markPaid(body as Record<string, unknown>, token, now, deps.store, log);
  }
  return create(body, token, deps.store, log);
}

async function create(body: unknown, token: ErpToken, store: ErpStore, log: (l: string) => void): Promise<Response> {
  const parsed = parseBody(body, token);
  if ("error" in parsed) return fail(parsed.error, 400);
  const row = parsed.row;

  try {
    if (row.external_reference) {
      const before = await store.findByReference(row.external_source, row.external_reference);
      if (before) return duplicate(before);
    }
    const ins = await store.insert(row);
    if ("conflict" in ins) {
      const first = await store.findByReference(row.external_source, row.external_reference || "");
      if (first) return duplicate(first);
      throw new Error("unique conflict without a matching request");
    }
    if (row.external_reference?.startsWith(FAIL500_PREFIX)) {
      log(`erp mock: ${FAIL500_PREFIX} test switch, ${ins.row.request_number} created and answered 500`);
      return fail("Internal server error", 500);
    }
    return json({
      success: true, request_id: ins.row.id, request_number: ins.row.request_number, status: ins.row.status,
      external_source: row.external_source, external_reference: row.external_reference,
      documents_uploaded: row.documents.length,
      message: ins.row.status === "approved" ? "Payment request created and auto-approved" : "Payment request created",
    }, 200);
  } catch (e) {
    log(`erp mock: database error: ${(e as Error).message}`);
    return fail("Internal server error", 500);
  }
}

async function markPaid(b: Record<string, unknown>, token: ErpToken, now: Date, store: ErpStore,
                        log: (l: string) => void): Promise<Response> {
  const parsed = parseMarkPaid(b, token, now.toISOString().slice(0, 10));
  if ("error" in parsed) return fail(parsed.error, 400);
  const p = parsed.input;
  try {
    const out = await store.markPaid(p);
    if (out.outcome === "not_found") return fail("Payment request not found", 404);
    if (out.outcome === "not_approved")
      return fail(`Only approved requests can be marked paid. ${out.request_number} is ${out.status}`, 409);
    if (out.outcome === "paid" && p.payment_reference.startsWith(FAIL500_PREFIX)) {
      log(`erp mock: ${FAIL500_PREFIX} test switch, ${out.request_number} marked paid and answered 500`);
      return fail("Internal server error", 500);
    }
    return json({
      success: true, ...(out.outcome === "already_paid" ? { already_paid: true } : {}),
      request_number: out.request_number, status: out.status, payment_reference: out.payment_reference,
      payment_date: day(out.payment_date), expense_number: out.expense_number,
    }, 200);
  } catch (e) {
    log(`erp mock: database error: ${(e as Error).message}`);
    return fail("Internal server error", 500);
  }
}

async function read(params: URLSearchParams, store: ErpStore, log: (l: string) => void): Promise<Response> {
  const number = params.get("request_number");
  if (number !== null) {
    if (!number.trim()) return fail("request_number must not be empty", 400);
    try {
      const row = await store.get(number.trim());
      if (!row) return fail("Payment request not found", 404);
      return json(apiRequestDetail(row), 200);
    } catch (e) {
      log(`erp mock: database error: ${(e as Error).message}`);
      return fail("Internal server error", 500);
    }
  }
  const parsed = parseListQuery(params);
  if ("error" in parsed) return fail(parsed.error, 400);
  const q = parsed.query;
  try {
    const { total, rows } = await store.list(q);
    return json({ success: true, total: Number(total), limit: q.limit, offset: q.offset, requests: rows.map(apiRequest) }, 200);
  } catch (e) {
    log(`erp mock: database error: ${(e as Error).message}`);
    return fail("Internal server error", 500);
  }
}
