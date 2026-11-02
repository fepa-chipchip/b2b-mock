/**
 * OpenAPI 3 documents for the two APIs an agent platform registers from this site:
 *   /api/openapi/b2b    the B2B copy (PostgREST shape, base https://<host>/b2b)
 *   /api/openapi/agent  the order bot's agent API (base https://<host>/api/agent)
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
          description: "Ready = sender quiet 90 s. status=all lists the latest 30 in any state. Each has sender {name, phone, telegram_name} and its messages (text, or a photo/file with a one-hour file_url).",
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
