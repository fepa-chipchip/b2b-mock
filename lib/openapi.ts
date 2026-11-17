/**
 * OpenAPI 3 documents for the APIs an agent platform registers from this site:
 *   /api/openapi/b2b    the B2B copy (PostgREST shape, base https://<host>/b2b)
 *   /api/openapi/agent  the order bot's agent API (base https://<host>/api/agent)
 *   /api/openapi/erp    the fake ChipChip ERP's payment-request call (base https://<host>/erp/functions/v1)
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
 * The fake ChipChip ERP's one call (lib/erpPayments.ts). The real ERP has the same path under
 * https://<erp-project>.supabase.co/functions/v1, so an agent synced from this document moves to the real ERP by changing
 * the base URL and the token only.
 */
export function erpSpec(host: string) {
  const answer = (description: string, properties: Record<string, unknown>, example: object) =>
    ({ description, content: { "application/json": { schema: obj(properties), example } } });
  const err = (description: string, example: string) =>
    ({ description, content: { "application/json": {
      schema: obj({ success: { type: "boolean", enum: [false] }, error: str() }, ["success", "error"]),
      example: { success: false, error: example } } } });
  const uuid = (description: string) => ({ type: "string", format: "uuid", description });
  return {
    openapi: "3.0.3",
    info: {
      title: "ChipChip ERP payment requests (sandbox)", version: "1.0.0",
      description: "Test copy of ChipChip ERP's external payment requests API: same path, body, statuses and errors as the "
        + "real one, but it creates nothing in the ERP. One call only: there is no read or list call. "
        + "Every request carries `Authorization: Bearer <API token>`. Each token has a System Name, saved as the request's "
        + "external_source, and an Auto-approve setting: on, a new request is `approved` at once; off, it is `pending` "
        + "and goes through the ERP's approval chain.",
    },
    servers: [{ url: `${host}/erp/functions/v1` }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "The ERP API token" } } },
    security: [{ bearerAuth: [] }],
    paths: {
      "/external-payment-requests": {
        post: {
          operationId: "create_payment_request",
          summary: "Create a payment request in ChipChip ERP",
          description: "Creates one payment request and answers its request_number and status (approved or pending).\n\n"
            + "**Idempotency:** send a unique `external_reference` for every payment (e.g. your own order or invoice id). "
            + "A second call with the same external_reference from the same token's System Name creates nothing and "
            + "answers 200 with `duplicate: true` and the ORIGINAL request's id, number and status. So after a timeout or "
            + "a 500, retry with the SAME external_reference: a 500 may or may not have created the request, and the "
            + "retry tells you which without paying twice.\n\n"
            + "**Errors:** 400 invalid body (missing title, total_amount not above 0, bad JSON, more than 10 documents, "
            + "a document whose base64 does not decode); 401 token missing, invalid, revoked or expired; 405 any method "
            + "but POST; 500 server or database error. Every error is `{success: false, error}`.\n\n"
            + "Sandbox only: an external_reference starting with `FAIL500-` creates the request and still answers 500, "
            + "to test the retry.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: obj({
              title: str("What the payment is for (required)"),
              total_amount: { type: "number", minimum: 0, exclusiveMinimum: true, description: "Total to pay, above 0 (required)" },
              amount: num("Amount before VAT; defaults to total_amount"),
              currency: str("Defaults to ETB"),
              external_reference: str("Your unique id for this payment: the idempotency key (strongly recommended)"),
              description: str(),
              vendor_name: str("Who is paid"),
              vendor_bank_name: str(),
              vendor_bank_account: str(),
              vendor_bank_branch: str(),
              payment_method: str("Defaults to bank_transfer"),
              preferred_payment_date: { type: "string", format: "date", description: "YYYY-MM-DD" },
              department_id: uuid("Department, e.g. SOURCING = 6b863514-6646-4a6e-aca4-d53d40ef0862"),
              category_id: uuid("Category, e.g. Direct Garment Sales = 39e52256-6829-4183-88c1-979f96d9b3f9, "
                + "B2B Purchase Repayment = b1134780-e645-4d07-b7f5-c5f0da451781"),
              business_unit: str("Defaults to chipchip"),
              vat_applicable: { type: "boolean", description: "Defaults to false" },
              vat_amount: num("Defaults to 0"),
              requester_first_name: str(),
              requester_last_name: str(),
              requester_email: str(),
              documents: {
                type: "array", maxItems: 10, description: "Up to 10 files (invoice, receipt, ...)",
                items: obj({ file_name: str("e.g. invoice.pdf"), file_type: str("MIME type, e.g. application/pdf"),
                  base64: str("The file as raw base64, without a data: prefix") }, ["file_name", "base64"]),
              },
              allocations: {
                type: "array", description: "How the cost is split between business units",
                items: obj({ business_unit: str(), percentage: num() }, ["business_unit", "percentage"]),
              },
            }, ["title", "total_amount"]),
            example: { title: "Supplier payment for order 1042", total_amount: 15000, external_reference: "order-1042",
              vendor_name: "Example Supplier PLC", vendor_bank_name: "Example Bank", vendor_bank_account: "1000000000000",
              preferred_payment_date: "2026-11-20", department_id: "6b863514-6646-4a6e-aca4-d53d40ef0862",
              category_id: "b1134780-e645-4d07-b7f5-c5f0da451781" } } },
          },
          responses: {
            "201": answer("Created", { success: { type: "boolean" }, request_id: { type: "string", format: "uuid" },
              request_number: str("e.g. PR-2026-01970 (sandbox numbers are PR-<year>-9xxxx)"),
              status: str("approved (token auto-approves) or pending (waits for approval)"), message: str() },
              { success: true, request_id: "00000000-0000-4000-8000-000000000000", request_number: "PR-2026-90001",
                status: "approved", message: "Payment request created" }),
            "200": answer("Duplicate: a request with this external_reference already exists; nothing new was created",
              { success: { type: "boolean" }, duplicate: { type: "boolean", enum: [true] },
                request_id: { type: "string", format: "uuid" }, request_number: str(), status: str() },
              { success: true, duplicate: true, request_id: "00000000-0000-4000-8000-000000000000",
                request_number: "PR-2026-90001", status: "approved" }),
            "400": err("Invalid request body", "total_amount must be a number greater than 0"),
            "401": err("Missing, invalid, revoked or expired API token", "Invalid API token"),
            "405": err("Only POST is allowed", "Method not allowed"),
            "500": err("Server or database error; the request may or may not exist: retry with the same external_reference",
              "Internal server error"),
          },
        },
      },
    },
  };
}
