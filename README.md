# B2B order mock (staging)

A reduced copy of **ChipChip B2B** and **ChipChip Admin**, plus our own **order bot**, used to test the B2B order agent
before it touches the real systems. The two fake systems answer on the **same paths, with the same requests, responses
and errors** as the real ones, so the agent built against this mock is pointed at the real systems later by changing
only base URLs and credentials.

- **Fake ChipChip B2B** (real: React + Supabase): PostgREST reads and the order RPCs under `/b2b/...`, and the pages
  **Orders** (with "+ New Order") and **Customers**.
- **Fake ChipChip Admin** (real: Next.js + Go API): the `/v1` and `/v2` calls the B2B screens use under `/admin-api/...`,
  and the pages **B2B Customers → Companies → a company → Linked Users / Place Order / Orders**.
- **Order bot (Telegram)**: ours, stays at go-live. Customers' staff send an order in any form (a list, a photo, a file).
  A person is known by phone number as a **linked user of their company in Admin**; the bot groups their messages into
  one order and asks which company when they are linked to several. Page **Received**.
- **4 questions**: Simenesh's answers, stored for the agent (`GET /api/agent/settings`). The fake systems do not change
  with them; each behaves like the real one.

Every company and person is invented (phones `2519000000xx`, TINs `00000001xx`). Product names and units follow ChipChip's
catalogue; prices are samples.

## Set up

1. **Supabase** → SQL Editor → paste `supabase/schema.sql` → Run. **Re-running it wipes all test data** (orders, carts,
   messages, testers added on the Received page) and puts the sample data back.
2. **Bot**: @BotFather → `/newbot` → keep the token.
3. **Vercel** environment variables (unchanged, no new ones):

   | Variable | What |
   |---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role / secret key (server only) |
   | `TELEGRAM_BOT_TOKEN` | from @BotFather |
   | `TELEGRAM_WEBHOOK_SECRET` | any long random string |
   | `AGENT_TOKEN` | any long random string: the agent's key for `/api/agent/*` |
   | `UI_PASSWORD` | the password of the pages |

4. Open the site → **Received** → *Order bot connection* → **Connect the bot**.
5. Testers: **Received** → *Add a tester* (their Telegram phone + company). They open the bot, press Start, share their number.

### The agent's test accounts in the fake systems

> **Test accounts of the mock, not real credentials.** They exist only in this mock's database (`mock_accounts`,
> stored as sha256). To change one, run in the SQL Editor:
> `update mock_accounts set password_sha256 = encode(sha256('<new>'::bytea), 'hex') where system = 'b2b';` (or `'admin'`).

| Fake system | Login | Password |
|---|---|---|
| B2B (`POST /b2b/auth/v1/token?grant_type=password`, header `apikey: mock-b2b-publishable-key`) | `order-agent@mock.chipchip.test` | `mock-b2b-agent-test` |
| Admin (`POST /admin-api/v1/users/login`) | phone `251900000099` | `mock-admin-agent-test` |
| Admin ordering, test account (`POST /admin-api/v1/users/login`) | phone `251900000098` | `mock-admin-ordering-test` |

`mock-b2b-publishable-key` is the fake B2B's public anon key (the real one is public too, hardcoded in the B2B app).
**Two Admin logins:** back office `251900000099` ("Zeami order agent (test)", `is_system`) for `/system/*` (companies,
linked users, statements, user lookups); ordering `251900000098` ("Zeami ordering (test)", an ordinary app user, MEMBER
of all 4 companies with Simenesh's delivery locations) for placing orders: cart, bill, locations, payment methods,
`multiple-group` and order history with its own login token, no impersonation. Checkout charges `b2b_customer_id` only
when that user is linked to it (else 400 `"user is not linked to this b2b customer"`). To add it to a live database
without wiping test data, run `supabase/add_ordering_user.sql` (safe to re-run) instead of `schema.sql`.
Simenesh's Admin user is `251900000009`, linked to
every company, with every company's delivery locations, as in reality.

## Real call → mock call

Swap the base URL (and credentials) at go-live; paths, bodies and responses stay the same.

| | Real base | Mock base |
|---|---|---|
| B2B Auth | `https://<b2b-ref>.supabase.co/auth/v1` | `https://<mock-host>/b2b/auth/v1` |
| B2B REST/RPC | `https://<b2b-ref>.supabase.co/rest/v1` | `https://<mock-host>/b2b/rest/v1` |
| Admin v1 | `https://ccapi.chipchip.social/v1` | `https://<mock-host>/admin-api/v1` |
| Admin v2 | `https://ccapi.chipchip.social/v2` | `https://<mock-host>/admin-api/v2` |

**ChipChip B2B** (every call: headers `apikey` + `Authorization: Bearer <access_token>`):

| Call | Body / query | Answer |
|---|---|---|
| `POST /auth/v1/token?grant_type=password` | `{email, password}` | `{access_token, token_type, expires_in: 3600, expires_at, refresh_token, user}`; bad login: 400 `{code, error_code: "invalid_credentials", msg}` |
| `GET /rest/v1/customers` | e.g. `select=*,customer_types(id,name,tax_exempt,custom_tax_rate)&is_active=eq.true&order=name` | rows |
| `GET /rest/v1/products` | `select=*&status=eq.active&approval_status=eq.approved&order=name` | rows |
| `GET /rest/v1/product_prices` | `select=*` | `(product_id, customer_type = type NAME, price)` |
| `GET /rest/v1/payment_types` | `select=name,label&is_active=eq.true&order=name` | cash, credit, prepaid |
| `GET /rest/v1/pricing_settings` | `select=*` | `tax_rate 15, delivery_fee_base 0, delivery_fee_threshold_kg 1` |
| `GET /rest/v1/orders`, `/order_items`, `/customer_types`, `/profiles` | `select` with embeds such as `order_items(*)`, `customers(name)` | rows |
| `POST /rest/v1/rpc/check_customer_credit_status` | `{customer_uuid}` | `{customer_id, credit_limit, credit_status, total_unpaid, has_overdue, can_place_order, overdue_orders_count, maximum_unpaid_threshold, is_legal_stage, stage_6_orders}` (resets a stale bad status when nothing is unpaid, like the real one) |
| `POST /rest/v1/rpc/create_order_with_items` | `{p_customer_id, p_subtotal, p_discount, p_discount_reason, p_tax_amount, p_tax_rate, p_delivery_fee, p_amount, p_delivery_date, p_payment_type, p_payment_status, p_total_quantity, p_source, p_notes, p_items:[{product_id, product_name, quantity, price, total}], p_warehouse_id}` | `{success, order_id, order_number}`; order `Processing` |
| `POST /rest/v1/rpc/get_orders_page` | `{p_page, p_page_size, p_search, p_status, p_payment_status}` | `{orders[], total, stats}` |

Filters copied: `select` (columns, `alias:col`, embeds, `!inner`), `eq neq gt gte lt lte like ilike in is not.*`,
`or=(...)`, `rel.col=` on an embed, `order`, `limit`, `offset`, `Range`, `Prefer: count=exact`, and
`Accept: application/vnd.pgrst.object+json` (`.single()`). Errors in PostgREST's shape `{code, details, hint, message}`
(e.g. 404 `PGRST202` for wrong RPC parameter names, 400 `P0001` "Order creation failed: Cannot create order without items").

As in the real app, **`create_order_with_items` does not check credit**: the New Order dialog (and so the agent) calls
`check_customer_credit_status` first and stops when `can_place_order` is false, computes subtotal, VAT (customer
override → customer type → `pricing_settings.tax_rate`) and delivery fee itself, prices each product with
`product_prices` for the customer's type name else `products.price`, sends `p_payment_status` `credit` for credit and
`pending` otherwise, and appends "⚠️ Credit order placed without agreement on file" to notes for credit without an agreement.

**ChipChip Admin** (answers `{ok: true, data, meta_data?}` or `{ok: false, error: {message}}`; header `Authorization: Bearer`):

| Call | Token | Body / query | Answer |
|---|---|---|---|
| `POST v1/users/login` | none | `{phone, password, country: "ETH"}` | `data: {token, user_id, user}` |
| `GET v1/system/b2b-customers` | back-office | `?page=&per_page=` | companies, `meta_data.total` |
| `GET v1/system/b2b-customers/:id` | back-office | | company `{id, business_name, tin, phone, status, credit_limit, payment_terms_days, credit_status, charge_vat, customer_type_id, wallet_account_id, created_at}` |
| `GET v1/system/b2b-customers/:id/users` | back-office | | linked users `{id, b2b_customer_id, user_id, role, created_at, user:{id,name,phone}}` |
| `POST` / `DELETE v1/system/b2b-customers/:id/users[/:user_id]` | back-office | `{user_id, role: ADMIN\|MEMBER}` | link / unlink |
| `GET v1/system/b2b-customers/:id/statement` | back-office | | `{credit_limit, balance, amount_owed, available_credit, ...}` (strings) |
| `GET v1/system/b2b-customers/user/:user_id` | back-office | | the user's company |
| `GET v1/system/users/:id` · `/:phone` · `/telegram/:telegram_id` | back-office | | user; **`token` is `""` by id**, a shopper token by phone or Telegram id (as on the real API) |
| `GET v1/system/users` | back-office | `?filter=[{columnField:"u.name",operatorValue:"contains",value}]` | users |
| `GET v1/system/products` · `v1/products` | back-office / any | `?filter=[{columnField:"pn.name"\|"name",operatorValue:"contains",value}]&page=&per_page=` | products with `group_deals[]` (`deal_type: "B2B"`, `group_price`, min/max per order); `/products` answers a `p.status` filter with "404 page not found", as observed |
| `POST v1/groups` | shopper | `{group_deals_id, quantity}` | `{id: group_id, group_cart_id, deal_type, status}` |
| `PATCH v1/carts/groups/:group_id` | shopper | `{quantity: <DELTA>, member_id: "00000000-…"}` | new quantity; at 0 the line goes |
| `GET v1/carts/group` | shopper | | open lines `{id, group_id, product_id, quantity, item_total_price, name, measuring_unit, group_deal}` |
| `POST v1/bill/groups` | shopper | `[{cart_id, group_id, location_id, deliver_by_admin, pickup_from_admin, with_packaging}]` | `{subtotal, delivery_charge, packaging_fee, plastic_bag_fee, tax, tax_rate, discount, total, ...}` as strings |
| `GET v1/locations/last_mile` | shopper | | `[{id, name, location_title, contact_phone}]` |
| `GET v2/orders/payment_methods` | shopper | | telebirr, MPesa, ChipChip Wallet, CBE, Awash Bank |
| `POST v2/orders/multiple-group` | shopper | `{account_number, b2b_customer_id, delivery_note, device, group_cart_ids, location_id, payment_method_id, platform, willingness, with_packaging}` | `{order_id (= bill id), bill_id, payment_url: ""}`; refused 400 `"order exceeds available credit limit"` when `balance − amount < −credit_limit` |
| `GET v1/order/group` | shopper | `?page=&per_page=&sort={"field":"o.updated_at","order":"desc"}` | one row per product, `status: PENDING`, `meta_data.total` |

**Matching the two systems:** a company in Admin and its customer in B2B carry the same TIN (`tin` / `tin_number`).

## Agent API (the order bot's inbox, ours)

`Authorization: Bearer <AGENT_TOKEN>`.

| Call | What it does |
|---|---|
| `GET /api/agent/inbox` | Orders ready to prepare (sender quiet 90 s, company known): messages (photos/files as `file_url`, one hour), `sender {name, phone, admin_user_id}`, `company {id, business_name, tin}` from Admin. `?status=all`: the latest 30. |
| `POST /api/agent/inbox/{id}/reply` | `{text}`: the bot asks the customer; their answer joins the same order. |
| `POST /api/agent/inbox/{id}/status` | `{status: proposed\|rejected\|collecting\|asked\|created, note, tell_customer, b2b_order_number, admin_bill_id}`. After placing the order through the two systems' APIs, the agent sets `created` with the references and the confirmation text in `tell_customer`. |
| `GET /api/agent/settings` | Simenesh's answers to the four questions. |

The old `/api/orders`, `/api/agent/preview`, `/api/agent/companies` and `/api/agent/products` are gone: the agent
reads and writes through the fake systems' own APIs instead.

## What is left out, and what differs from the real systems

Left out (not needed for ordering): B2B Edit Order, Add Discount, Payment Evidence, Mark as Delivered, Cancel Order,
QR code, e-receipt, Warehouse, Logistics, Finance, Products, the Customers page's stats/tabs/filters/export/add/edit,
direct table writes through REST, refresh-token login, roles/RLS (the agent account sees every customer, like an
operations user); Admin Add/Edit/Delete Company, Customer Types/Products/Bidding tabs, set credit limit, record
settlement, Settlement Report, the deal picker for products with several B2B deals (each product has one deal here),
"Load More" paging in the product picker, the debounced quantity box (− / + save at once), stock movements, payment
pages.

Differences to know:
- B2B `access_token` is an opaque string, not a JWT; it lasts one hour. Admin tokens last seven days.
- B2B's order is not tied to a warehouse (`warehouse_id` null) and writes no activity log.
- The B2B credit RPC uses the defaults of `credit_settings` (7 grace days, legal stage after 15) instead of a table.
- Admin's bill and checkout charge 15% on the subtotal without naming it in any field (`tax: "0"`), as staging was
  observed to do; delivery, packaging and plastic-bag fees are 0. Every B2B checkout is charged to the company wallet,
  whatever payment method is picked (the real behaviour for non-wallet methods is still an open question).
- Admin's linked-users list includes `user {name, phone}`; the real one may return only ids (the Admin page looks the
  profile up when it is missing).
- The bot reads Admin's linked users from the mock's tables directly; at go-live it reads the real Admin.
- "Add a tester" on **Received** is mock-only: it creates an Admin user for a real Telegram phone and links it.

## Local run

`npm install`, a `.env.local` with the variables, `npm run dev`. Telegram needs a public https address for the webhook,
so the bot itself is tested on the deployed site.
