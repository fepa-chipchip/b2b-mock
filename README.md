# B2B order mock (staging)

A stand-in for ChipChip B2B and ChipChip Admin, used to test the B2B order agent before it touches the real systems.

- **Order bot (Telegram):** customers' staff send an order in any form (a list, a photo, a file). The bot links each
  person to their company by phone number, groups their messages into one order, and asks which company when the
  person orders for several.
- **Agent API:** the Zeami agent reads the orders, prices them and, after Simenesh's yes in her Zeami private chat,
  creates them here. The bot then confirms to the customer.
- **Pages for Simenesh** (password): the orders as B2B and Admin would hold them, what customers sent, the four open
  questions as settings the mock follows, the test customers. ✅ / ❌ and a comment everywhere.

Every company and person is invented. Product names and units follow ChipChip's catalogue; prices are samples.

## Set up (once)

1. **Supabase**: new project → SQL Editor → paste `supabase/schema.sql` → Run.
2. **Bot**: @BotFather → `/newbot` → keep the token.
3. **Vercel**: import this repo, then add the variables in `.env.example` (Settings → Environment Variables).
   `TELEGRAM_WEBHOOK_SECRET` and `AGENT_TOKEN` are any long random strings. Redeploy.
4. Open the site → **Customers** → *Order bot connection* → **Connect the bot**.
5. Add the testers' Telegram phone numbers on **Customers**. Each opens the bot, presses Start and shares their number.

## Agent API

`Authorization: Bearer <AGENT_TOKEN>` on every call. Reads are GET; the two writes are POST.

| Call | What it does |
|---|---|
| `GET /api/agent/inbox` | Orders ready to prepare: the sender has been quiet 90 s and the company is known. Each message has its text and, for a photo or file, a `file_url` valid one hour. `?status=all` lists the latest 30. |
| `GET /api/agent/products?q=` | Products matching a name or another spelling (English or Amharic): unit, B2B price, Admin price, minimum. |
| `GET /api/agent/companies` · `/{id}` | Companies with delivery places; one company's people and credit in both systems. |
| `GET /api/agent/settings` | Simenesh's answers to the four questions. |
| `GET /api/agent/preview?company_id=&location_id=&delivery_date=YYYY-MM-DD&items=ID:QTY,ID:QTY&notes=` | The order priced and credit-checked as the settings say, nothing created. Build the approval card from it. |
| `POST /api/orders` | `{inbox_id, company_id, location_id, delivery_date, notes, items:[{product_id, quantity}]}`. Creates it in B2B, Admin or both; 409 `credit_refused` when credit does not allow it; the same `inbox_id` twice creates nothing more. The bot confirms to the customer. |
| `POST /api/agent/inbox/{id}/reply` | `{text}`: the bot asks the customer something; their answer joins the same order. |
| `POST /api/agent/inbox/{id}/status` | `{status: proposed|rejected|collecting, note, tell_customer}`: `proposed` while the card waits for Simenesh; `rejected` after her no (`tell_customer` is sent by the bot). |

## Local run

`npm install`, a `.env.local` with the variables, `npm run dev`. Telegram needs a public https address for the webhook,
so the bot itself is tested on the deployed site.
