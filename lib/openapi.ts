/**
 * OpenAPI 3 documents for the APIs an agent platform registers from this site:
 *   /api/openapi/b2b    the B2B copy (PostgREST shape, base https://<host>/b2b)
 *   /api/openapi/agent  the order bot's agent API (base https://<host>/api/agent)
 *   /api/openapi/erp    the fake ChipChip ERP's payment-requests API: create, list, get one, mark paid (base https://<host>/erp/functions/v1)
 * They describe calls that already exist; serving them changes nothing else.
 */

const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: "object", properties, ...(required.length ? { required } : {}) });
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: "number", ...(description ? { description } : {}) });
const json = (schema: unknown) => ({ content: { "application/json": { schema } } });
const okJson = (description: string) => ({ "200": { description, ...json({ type: "object" }) } });

const PGREST_QUERY = [
  { name: "select", in: "query", schema: str(), description: "Columns, e.g. * or id,name" },
  { name: "order", in: "query", schema: str(), description: "e.g. created_at.desc" },
  { name: "limit", in: "query", schema: { type: "integer" } },
  { name: "offset", in: "query", schema: { type: "integer" } },
];

function table(name: string, summary: string, filters: string[]) {
  return {
    get: {
      operationId: `list_${name}`,
      summary,
      description: `Reads rows of ${name}. Filters use PostgREST syntax: <column>=eq.<value>, ilike.*text*, in.(a,b).`,
      parameters: [
        ...PGREST_QUERY,
        ...filters.map((f) => ({ name: f, in: "query", schema: str(), description: `Filter, e.g. ${f}=eq.<value>` })),
      ],
      responses: { "200": { description: "Rows", ...json({ type: "array", items: { type: "object" } }) } },
    },
  };
}

export function b2bSpec(host: string) {
  return {
    openapi: "3.0.3",
    info: { title: "ChipChip B2B (staging copy)", version: "1.0.0",
      description: "Copy of ChipChip B2B for tests. Every call needs the apikey header and the Bearer token from sign-in." },
    servers: [{ url: `${host}/b2b` }],
    paths: {
      "/rest/v1/customers": {
        ...table("customers", "Business customers (name, phone, tin_number, customer type, credit limit, credit_status)",
          ["id", "name", "phone", "tin_number", "credit_status", "customer_type_id", "is_active"]),
        post: {
          operationId: "create_customer",
          summary: "Create a business customer",
          description: "Inserts one customer. Send Prefer: return=representation to get the row back.",
          requestBody: json(obj({ name: str(), phone: str("+251..."), tin_number: str("same TIN as the company in ChipChip Admin"), address: str(),
            customer_type_id: str("uuid"), credit_limit: num(), email: str() }, ["name", "phone"])),
          responses: { "201": { description: "Created", ...json({ type: "array", items: { type: "object" } }) } },
        },
      },
      "/rest/v1/customer_types": table("customer_types", "Customer types (VAT, pricing tier)", ["id", "name"]),
      "/rest/v1/products": table("products", "Products (name, unit, base price, status)", ["id", "name", "status"]),
      "/rest/v1/product_prices": table("product_prices", "Price per product and customer type (customer_type is the type's name)",
        ["product_id", "customer_type"]),
      "/rest/v1/payment_types": table("payment_types", "Payment types an order may use (e.g. cash, credit)", ["name", "is_active"]),
      "/rest/v1/pricing_settings": table("pricing_settings", "Tax rate and delivery fee settings", []),
      "/rest/v1/orders": table("orders", "Orders (order_number, customer, status, amount, delivery date)",
        ["id", "order_number", "customer_id", "status", "delivery_date"]),
      "/rest/v1/order_items": table("order_items", "Lines of an order", ["order_id", "product_id"]),
      "/rest/v1/rpc/check_customer_credit_status": {
        post: {
          operationId: "check_customer_credit_status",
          summary: "Whether a customer may order, and their credit left",
          requestBody: json(obj({ customer_uuid: str("the customer's id") }, ["customer_uuid"])),
          responses: okJson("Credit status: can_place_order, credit limit, used, available, reason"),
        },
      },
      "/rest/v1/rpc/create_order_with_items": {
        post: {
          operationId: "create_order_with_items",
          summary: "Create an order with its lines (status Processing)",
          description: "Does not check credit: call check_customer_credit_status first. p_amount is recomputed as subtotal - discount + tax + delivery fee.",
          requestBody: json(obj({
            p_customer_id: str("uuid"), p_subtotal: num(), p_discount: num(), p_discount_reason: str(), p_tax_amount: num(),
            p_tax_rate: num(), p_delivery_fee: num(), p_amount: num(), p_delivery_date: str("YYYY-MM-DD"),
            p_payment_type: str("a payment_types name"), p_payment_status: str("pending, paid or credit"),
            p_total_quantity: num(), p_source: str("e.g. telegram"), p_notes: str(), p_warehouse_id: str("uuid or null"),
            p_items: { type: "array", items: obj({ product_id: str("uuid"), product_name: str(), quantity: num(),
              price: num("unit price"), total: num("quantity x price") }) },
          }, ["p_customer_id", "p_items", "p_delivery_date", "p_payment_type", "p_payment_status"])),
          responses: okJson("The new order's id and order_number"),
        },
      },
      "/rest/v1/rpc/get_orders_page": {
        post: {
          operationId: "get_orders_page",
          summary: "One page of orders with totals, searchable",
          requestBody: json(obj({ p_page: { type: "integer" }, p_page_size: { type: "integer" }, p_search: str(),
            p_status: str(), p_payment_status: str() })),
          responses: okJson("Orders of the page and the totals"),
        },
      },
    },
  };
}

export function agentSpec(host: string) {
  const id = [{ name: "id", in: "path", required: true, schema: { type: "integer" } }];
  return {
    openapi: "3.0.3",
    info: { title: "Order bot (test)", version: "1.0.0",
      description: "The Telegram order bot's API for the agent: orders customers sent, replies to them, sign-ups. Bearer token." },
    servers: [{ url: `${host}/api/agent` }],
    paths: {
      "/inbox": {
        get: {
          operationId: "list_orders",
          summary: "Orders customers sent that are ready to prepare",
          description: "Ready = sender quiet 90 s. status=all lists the latest 30 in any state. Each has sender {name, phone, telegram_id, telegram_name} and its messages (text, or a photo/file with a one-hour file_url).",
          parameters: [{ name: "status", in: "query", schema: str("all for every state") }],
          responses: okJson("{orders: [...]}"),
        },
      },
      "/inbox/{id}/status": {
        post: {
          operationId: "set_order_status",
          summary: "Record where an order stands (and tell the customer)",
          parameters: id,
          requestBody: json(obj({ status: str("proposed, rejected, collecting, asked or created"), note: str(),
            tell_customer: str("sent to the customer by the bot"), company_id: str(), admin_user_id: str(),
            b2b_order_number: str(), admin_bill_id: str() })),
          responses: okJson("The status saved; 409 already_created when the order was already created"),
        },
      },
      "/inbox/{id}/reply": {
        post: {
          operationId: "reply_to_customer",
          summary: "Send the customer a message about their order (a question, the order to confirm)",
          parameters: id,
          requestBody: json(obj({ text: str() }, ["text"])),
          responses: okJson("{sent: true}"),
        },
      },
      "/inbox/{id}/signup": {
        post: {
          operationId: "start_signup",
          summary: "Start the bot's sign-up for a sender who is not a business customer yet",
          parameters: id,
          requestBody: json(obj({ intro: str("optional first line") })),
          responses: okJson("{signup_id}"),
        },
      },
      "/signups": {
        get: {
          operationId: "list_signups",
          summary: "Sign-ups waiting for approval (status=all for every state)",
          parameters: [{ name: "status", in: "query", schema: str() }],
          responses: okJson("{signups: [...]}"),
        },
      },
      "/signups/{id}/status": {
        post: {
          operationId: "set_signup_status",
          summary: "Record a sign-up as registered (customer created) or declined",
          parameters: id,
          requestBody: json(obj({ status: str("registered or declined"), note: str(), tell_customer: str(),
            b2b_customer_id: str(), admin_company_id: str(), admin_user_id: str() }, ["status"])),
          responses: okJson("The status saved"),
        },
      },
      "/settings": {
        get: {
          operationId: "get_settings",
          summary: "How the B2B person answered the order questions (where orders go, credit, who places them)",
          responses: okJson("{settings}"),
        },
      },
    },
  };
}

/**
 * The fake ChipChip ERP's payment-requests API (lib/erpPayments.ts, ERP guide v2). The real ERP has the same path under
 * https://<erp-project>.supabase.co/functions/v1, so an agent synced from this document moves to the real ERP by changing
 * the base URL and the token only. One path, two methods, as in the real API: GET lists or reads one request; POST
 * creates one, or marks one paid when the body says `action: "mark_paid"`.
 *
 * The POST body schema is one flat object holding both shapes' fields (no oneOf), so an importer that reads the
 * schema's `properties` sees every field either shape may send.
 */
export function erpSpec(host: string) {
  const answer = (description: string, properties: Record<string, unknown>, examples: Record<string, object>) =>
    ({ description, content: { "application/json": { schema: obj(properties),
      examples: Object.fromEntries(Object.entries(examples).map(([k, value]) => [k, { value }])) } } });
  const err = (description: string, example: string) =>
    ({ description, content: { "application/json": {
      schema: obj({ success: { type: "boolean", enum: [false] }, error: str() }, ["success", "error"]),
      example: { success: false, error: example } } } });
  const uuid = (description: string) => ({ type: "string", format: "uuid", description });
  const date = (description: string) => ({ type: "string", format: "date", description });
  const nstr = (description?: string) => ({ ...str(description), nullable: true });
  const ntime = (description?: string) => ({ type: "string", format: "date-time", nullable: true,
    ...(description ? { description } : {}) });
  const ID = "00000000-0000-4000-8000-000000000000";

  const request = {
    id: { type: "string", format: "uuid" }, request_number: str("e.g. PR-2026-01970 (sandbox: PR-<year>-9xxxx)"),
    title: str(), description: nstr(), status: str("pending, approved, paid or rejected"),
    vendor_name: nstr(), vendor_bank_name: nstr(), vendor_bank_account: nstr(), vendor_bank_branch: nstr(),
    amount: num(), vat_amount: num(), total_amount: num(), currency: str(), payment_method: str(),
    preferred_payment_date: { ...date("YYYY-MM-DD"), nullable: true }, business_unit: str(),
    external_source: nstr("The creating token's System Name"), external_reference: nstr(),
    submitted_at: ntime(), approved_at: ntime(), paid_at: ntime(), payment_reference: nstr(),
    actual_payment_date: { ...date("YYYY-MM-DD"), nullable: true }, rejection_reason: nstr(), rejected_at: ntime(),
    created_at: { type: "string", format: "date-time" }, requester_first_name: nstr(), requester_last_name: nstr(),
    requester_email: nstr(),
    documents: { type: "array", items: str(), description: "Attached file names only, never the contents" },
  };
  const listed = {
    id: ID, request_number: "PR-2026-90001", title: "Supplier payment for order 1042", description: null,
    status: "approved", vendor_name: "Example Supplier PLC", vendor_bank_name: "Example Bank",
    vendor_bank_account: "1000000000000", vendor_bank_branch: null, amount: 15000, vat_amount: 0, total_amount: 15000,
    currency: "ETB", payment_method: "bank_transfer", preferred_payment_date: "2026-11-20", business_unit: "chipchip",
    external_source: "zeami-test", external_reference: "order-1042", submitted_at: "2026-11-17T09:12:00.000Z",
    approved_at: "2026-11-17T09:12:00.000Z", paid_at: null, payment_reference: null, actual_payment_date: null,
    rejection_reason: null, rejected_at: null, created_at: "2026-11-17T09:12:00.000Z", requester_first_name: "External",
    requester_last_name: "System", requester_email: null, documents: ["invoice.pdf"],
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "ChipChip ERP payment requests (sandbox)", version: "2.0.0",
      description: "Test copy of ChipChip ERP's external payment requests API (v2): same path, bodies, statuses and errors "
        + "as the real one, but nothing reaches the ERP. GET lists requests or reads one; POST creates a request, or "
        + "marks an approved one paid with `action: \"mark_paid\"`. "
        + "Every call carries `Authorization: Bearer <API token>`; the same token creates, reads and marks paid. Each "
        + "token has a System Name, saved as the request's external_source, and an Auto-approve setting: on, a new "
        + "request is `approved` at once; off, it is `pending` and goes through the ERP's approval chain. "
        + "Every error is `{success: false, error}`.",
    },
    servers: [{ url: `${host}/erp/functions/v1` }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "The ERP API token" } } },
    security: [{ bearerAuth: [] }],
    paths: {
      "/external-payment-requests": {
        get: {
          operationId: "list_payment_requests",
          summary: "List payment requests, or read one by request_number with its approvals and history",
          description: "**One request:** `?request_number=PR-2026-01970` answers `{success, request, approvals, history}`: "
            + "the request (the list's fields plus current_approval_level, paid_by, rejected_by), its approval chain, and "
            + "its lifecycle oldest first (submitted, level_N_approved / level_N_rejected, approved, rejected, paid). 404 "
            + "if the number does not exist. Other parameters are ignored when request_number is given.\n\n"
            + "**List:** without request_number, answers `{success, total, limit, offset, requests}`, newest first. "
            + "`status`: pending (covers pending_approval, pending, submitted), approved, paid or rejected. `from` and "
            + "`to`: YYYY-MM-DD, on the creation date (UTC), both inclusive. `limit` 1-500 (default 100) and `offset` "
            + "(default 0) page through `total`. To find requests awaiting payment: `?status=approved`.\n\n"
            + "**Errors:** 400 bad status filter or bad date; 401 token missing, invalid, revoked or expired; 404 "
            + "request_number not found; 500 server or database error.",
          parameters: [
            { name: "request_number", in: "query", schema: str(), description: "Read this one request, e.g. PR-2026-01970" },
            { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "paid", "rejected"] },
              description: "pending covers pending_approval, pending and submitted" },
            { name: "from", in: "query", schema: { type: "string", format: "date" }, description: "Created on or after, YYYY-MM-DD (UTC)" },
            { name: "to", in: "query", schema: { type: "string", format: "date" }, description: "Created on or before, YYYY-MM-DD (UTC), inclusive" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          ],
          responses: {
            "200": answer("The list, or one request with its approvals and history", {
              success: { type: "boolean" }, total: { type: "integer" }, limit: { type: "integer" },
              offset: { type: "integer" }, requests: { type: "array", items: obj(request) },
              request: obj({ ...request, current_approval_level: { type: "integer", nullable: true },
                paid_by: nstr(), rejected_by: nstr() }),
              approvals: { type: "array", items: obj({ approver_id: uuid("Approver"), approver_name: str(),
                approval_level: { type: "integer" }, status: str("approved or rejected"), comments: nstr(),
                approved_at: ntime("Null for a rejection") }) },
              history: { type: "array", items: obj({ event: str("submitted, level_1_approved, approved, rejected, paid, ..."),
                at: { type: "string", format: "date-time" }, by: nstr(), comments: nstr(), reason: nstr("rejected only"),
                reference: nstr("paid only: the payment reference") }) },
            }, {
              list: { success: true, total: 1, limit: 100, offset: 0, requests: [listed] },
              one: { success: true,
                request: { ...listed, status: "paid", paid_at: "2026-11-18T08:30:00.000Z", payment_reference: "FT26203ABC",
                  actual_payment_date: "2026-11-18", current_approval_level: null, paid_by: "zeami-test", rejected_by: null },
                approvals: [],
                history: [{ event: "submitted", at: "2026-11-17T09:12:00.000Z" },
                  { event: "approved", at: "2026-11-17T09:12:00.000Z" },
                  { event: "paid", at: "2026-11-18T08:30:00.000Z", by: "zeami-test", reference: "FT26203ABC" }] },
            }),
            "400": err("Invalid status filter or date", "from must be a date YYYY-MM-DD"),
            "401": err("Missing, invalid, revoked or expired API token", "Invalid API token"),
            "404": err("No request with this request_number", "Payment request not found"),
            "405": err("Only GET and POST are allowed", "Method not allowed"),
            "500": err("Server or database error", "Internal server error"),
          },
        },
        post: {
          operationId: "create_payment_request",
          summary: "Create a payment request in ChipChip ERP, or mark an approved one paid (action: mark_paid)",
          description: "**Create** (no `action`): title and total_amount (above 0) are required. Answers 200 with the "
            + "request_number and status (approved or pending).\n\n"
            + "**Idempotency:** send a unique `external_reference` for every payment (e.g. your own order or invoice id). "
            + "A second call with the same external_reference from the same token's System Name creates nothing and "
            + "answers 200 with `duplicate: true` and the ORIGINAL request's id, number and status. So after a timeout or "
            + "a 500, retry with the SAME external_reference: a 500 may or may not have created the request, and the "
            + "retry tells you which without paying twice.\n\n"
            + "**Mark paid** (`action: \"mark_paid\"`): request_number and payment_reference (the bank transfer "
            + "reference, at most 200 characters) are required; payment_date (YYYY-MM-DD) defaults to today; "
            + "bank_account_id is optional. Only an `approved` request can be marked paid: anything else answers 409. "
            + "Calling it twice is safe: an already paid request answers 200 with `already_paid: true` and the first "
            + "payment's reference, date and expense number. A paid expense (expense_number EXP-...) is created and "
            + "linked to the request; VAT is carried over, withholding tax is 0. No Telegram payment notification.\n\n"
            + "**Errors:** 400 invalid body (missing title, total_amount not above 0, bad JSON, bad date, more than 10 "
            + "documents, a document whose base64 does not decode, an unknown action, mark_paid without request_number or "
            + "payment_reference); 401 token missing, invalid, revoked or expired; 404 mark_paid on an unknown "
            + "request_number; 409 mark_paid on a request that is not approved; 500 server or database error.\n\n"
            + "Sandbox only: an external_reference starting with `FAIL500-` creates the request and still answers 500; a "
            + "mark_paid payment_reference starting with `FAIL500-` marks it paid and still answers 500. Retry to test.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: obj({
              action: { type: "string", enum: ["mark_paid"], description: "Leave out to create; \"mark_paid\" to mark paid" },
              title: str("Create: what the payment is for (required to create)"),
              total_amount: { type: "number", minimum: 0, exclusiveMinimum: true, description: "Create: total to pay, above 0 (required to create)" },
              amount: num("Create: net amount; defaults to total_amount"),
              currency: str("Create: defaults to ETB"),
              external_reference: str("Create: your unique id for this payment, the idempotency key (strongly recommended)"),
              description: str("Create"),
              vendor_name: str("Create: who is paid"),
              vendor_bank_name: str("Create"),
              vendor_bank_account: str("Create"),
              vendor_bank_branch: str("Create"),
              payment_method: str("Create: defaults to bank_transfer"),
              preferred_payment_date: date("Create: YYYY-MM-DD"),
              department_id: uuid("Create: department, e.g. SOURCING = 6b863514-6646-4a6e-aca4-d53d40ef0862"),
              category_id: uuid("Create: category, e.g. Direct Garment Sales = 39e52256-6829-4183-88c1-979f96d9b3f9, "
                + "B2B Purchase Repayment = b1134780-e645-4d07-b7f5-c5f0da451781"),
              business_unit: str("Create: defaults to chipchip"),
              vat_applicable: { type: "boolean", description: "Create: defaults to false" },
              vat_amount: num("Create: defaults to 0"),
              requester_first_name: str("Create: overrides the token owner"),
              requester_last_name: str("Create"),
              requester_email: str("Create"),
              items: {
                type: "array", description: "Create: line items",
                items: obj({ description: str(), quantity: num(), unit_price: num(), amount: num(), notes: str() }),
              },
              documents: {
                type: "array", maxItems: 10, description: "Create: up to 10 files (invoice, receipt, ...)",
                items: obj({ file_name: str("e.g. invoice.pdf"), file_type: str("MIME type, e.g. application/pdf"),
                  base64: str("The file as raw base64, without a data: prefix") }, ["file_name", "base64"]),
              },
              allocations: {
                type: "array", description: "Create: how the cost is split between business units",
                items: obj({ business_unit: str(), percentage: num() }, ["business_unit", "percentage"]),
              },
              request_number: str("Mark paid: the request, e.g. PR-2026-01970 (required to mark paid)"),
              payment_reference: { type: "string", maxLength: 200,
                description: "Mark paid: the bank transfer reference (required to mark paid)" },
              payment_date: date("Mark paid: YYYY-MM-DD; defaults to today"),
              bank_account_id: uuid("Mark paid: the paying bank account, optional"),
            }),
            examples: {
              create: { value: { title: "Supplier payment for order 1042", total_amount: 15000,
                external_reference: "order-1042", vendor_name: "Example Supplier PLC", vendor_bank_name: "Example Bank",
                vendor_bank_account: "1000000000000", preferred_payment_date: "2026-11-20",
                department_id: "6b863514-6646-4a6e-aca4-d53d40ef0862", category_id: "b1134780-e645-4d07-b7f5-c5f0da451781" } },
              mark_paid: { value: { action: "mark_paid", request_number: "PR-2026-90001",
                payment_reference: "FT2625883RYN", payment_date: "2026-11-17" } },
            } } },
          },
          responses: {
            "200": answer("Created; a duplicate (nothing new created); marked paid; or already paid (nothing changed)", {
              success: { type: "boolean" }, request_id: { type: "string", format: "uuid" },
              request_number: str("e.g. PR-2026-01970 (sandbox numbers are PR-<year>-9xxxx)"),
              status: str("approved, pending, or paid"), external_source: str(), external_reference: nstr(),
              documents_uploaded: { type: "integer" }, message: str(),
              duplicate: { type: "boolean", enum: [true], description: "Create: the request already existed" },
              already_paid: { type: "boolean", enum: [true], description: "Mark paid: it was paid before" },
              payment_reference: str(), payment_date: date("YYYY-MM-DD"),
              expense_number: str("e.g. EXP-2026-04123 (sandbox: EXP-<year>-9xxxx)"),
            }, {
              created: { success: true, request_id: ID, request_number: "PR-2026-90001", status: "approved",
                external_source: "zeami-test", external_reference: "order-1042", documents_uploaded: 0,
                message: "Payment request created and auto-approved" },
              duplicate: { success: true, duplicate: true, request_id: ID, request_number: "PR-2026-90001", status: "approved" },
              marked_paid: { success: true, request_number: "PR-2026-90001", status: "paid",
                payment_reference: "FT2625883RYN", payment_date: "2026-11-17", expense_number: "EXP-2026-90001" },
              already_paid: { success: true, already_paid: true, request_number: "PR-2026-90001", status: "paid",
                payment_reference: "FT2625883RYN", payment_date: "2026-11-17", expense_number: "EXP-2026-90001" },
            }),
            "400": err("Invalid request body", "total_amount must be a number greater than 0"),
            "401": err("Missing, invalid, revoked or expired API token", "Invalid API token"),
            "404": err("mark_paid: no request with this request_number", "Payment request not found"),
            "405": err("Only GET and POST are allowed", "Method not allowed"),
            "409": err("mark_paid on a request that is not approved",
              "Only approved requests can be marked paid. PR-2026-90002 is pending"),
            "500": err("Server or database error; the request may or may not exist: retry with the same external_reference",
              "Internal server error"),
          },
        },
      },
    },
  };
}
