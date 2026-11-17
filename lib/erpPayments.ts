/* ---------- Fake ChipChip ERP: "external payment requests" ----------
 * The real call: POST https://<erp-project>.supabase.co/functions/v1/external-payment-requests with
 * `Authorization: Bearer <API_TOKEN>`. It creates one payment request in the ERP. This copy answers on
 * /erp/functions/v1/external-payment-requests with the same body, statuses and errors, so an agent can be tested without
 * creating real payment requests, and pointed at the real ERP later by changing only the base URL and the token.
 *
 * Every token has a System Name (stored as `external_source` on each request it creates) and an Auto-approve flag
 * (on: the request is "approved" at once; off: "pending", waiting for the ERP's approval chain).
 * Idempotency: (external_source, external_reference) is unique; a retry with the same reference gets the ORIGINAL request
 * back with `duplicate: true` and 200. The real API has no read or list call, and neither has this copy (the page
 * /erp/requests is our own check).
 *
 * Test switch, mock only: an external_reference starting with "FAIL500-" creates the request AND answers 500, as the
 * real API may after it has written the row. A retry with the same reference then answers 200 duplicate.
 *
 * Documents: only file_name, file_type and the decoded size are kept; the base64 itself is never stored.
 *
 * No `@/` imports on purpose: tests/erp_payments.test.mjs loads this file straight into Node.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type ErpToken = {
  token: string;
  system_name: string;
  auto_approve: boolean;
  /** Mock only, to test the 401s: a revoked token, or one past its expiry (ISO date or timestamp). */
  revoked?: boolean;
  expires_at?: string;
};

export type ErpDocumentMeta = { file_name: string; file_type: string | null; size_bytes: number };
export type ErpAllocation = { business_unit: string; percentage: number };

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
  documents: ErpDocumentMeta[];
  allocations: ErpAllocation[];
};

export type StoredErpRequest = { id: string; request_number: string; status: string };

export interface ErpStore {
  findByReference(externalSource: string, externalReference: string): Promise<StoredErpRequest | null>;
  /** `conflict` when (external_source, external_reference) already exists (a retry that raced the first call). */
  insert(row: NewErpRequest): Promise<{ row: StoredErpRequest } | { conflict: true }>;
}

export const MAX_DOCUMENTS = 10;
export const FAIL500_PREFIX = "FAIL500-";
export const DEFAULT_SOURCE = "zeami-test";

/** Departments and categories named in ChipChip's ERP instructions, for the mock's page only (any uuid is accepted). */
export const KNOWN_IDS: Record<string, string> = {
  "6b863514-6646-4a6e-aca4-d53d40ef0862": "SOURCING",
  "39e52256-6829-4183-88c1-979f96d9b3f9": "Direct Garment Sales",
  "b1134780-e645-4d07-b7f5-c5f0da451781": "B2B Purchase Repayment",
};

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

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time: every token is compared (as equal-length sha256 digests), whichever matches. */
export function findToken(got: string, tokens: ErpToken[]): ErpToken | null {
  const g = digest(got);
  let found: ErpToken | null = null;
  for (const t of tokens) if (timingSafeEqual(g, digest(t.token)) && !found) found = t;
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
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))
        || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d)
      return { error: "preferred_payment_date must be a date YYYY-MM-DD" };
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

/** The whole call: 405, 401, 400, 200 duplicate, 201 created, 500. Never throws. */
export async function handleExternalPaymentRequest(req: Request, deps: ErpDeps): Promise<Response> {
  const log = deps.log || ((l: string) => console.log(l));
  if (req.method !== "POST") return fail("Method not allowed", 405, { allow: "POST" });

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
  if (token.expires_at) {
    const exp = Date.parse(token.expires_at);
    if (!Number.isNaN(exp) && exp <= (deps.now ? deps.now() : new Date()).getTime()) return fail("API token has expired", 401);
  }

  let body: unknown;
  try { body = JSON.parse(await req.text()); } catch { return fail("Invalid JSON body", 400); }
  const parsed = parseBody(body, token);
  if ("error" in parsed) return fail(parsed.error, 400);
  const row = parsed.row;

  try {
    if (row.external_reference) {
      const before = await deps.store.findByReference(row.external_source, row.external_reference);
      if (before) return duplicate(before);
    }
    const ins = await deps.store.insert(row);
    if ("conflict" in ins) {
      const first = await deps.store.findByReference(row.external_source, row.external_reference || "");
      if (first) return duplicate(first);
      throw new Error("unique conflict without a matching request");
    }
    if (row.external_reference?.startsWith(FAIL500_PREFIX)) {
      log(`erp mock: ${FAIL500_PREFIX} test switch, ${ins.row.request_number} created and answered 500`);
      return fail("Internal server error", 500);
    }
    return json({ success: true, request_id: ins.row.id, request_number: ins.row.request_number, status: ins.row.status,
      message: "Payment request created" }, 201);
  } catch (e) {
    log(`erp mock: database error: ${(e as Error).message}`);
    return fail("Internal server error", 500);
  }
}
