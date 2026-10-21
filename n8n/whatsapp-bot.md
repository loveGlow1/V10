# WhatsApp bot (multi-business)

One n8n engine answers WhatsApp for every business. Each business is a row in
Supabase `clients` plus its products in `inventory`; nothing about a business
lives in the workflow.

Runs on the n8n instance `dynamit3.app.n8n.cloud`, with WhatsApp through the
Evolution API on Railway (`evolution-api-production-4056.up.railway.app`).

## Workflows

| Workflow | What it does |
| --- | --- |
| **WhatsApp Bot — Engine (all businesses)** | Webhook from Evolution → finds the business by `instance_name` → menu, stock desk, AI answers (text, photos, voice notes), handoff to a person, alerts, events log, hourly follow-ups. |
| **WhatsApp Bot — Add a Business** | n8n-login form. Saves the business and its products, creates its Evolution instance with the engine webhook, shows the QR code to scan. |
| **WhatsApp Bot — Daily Summary** | 08:00 Lagos: one WhatsApp report per business to its `alert_numbers`, from `bot_events`. |
| **WhatsApp Bot — Error Alerts** | Error workflow: WhatsApps the platform owner when a run fails. |

## Adding a business

1. Open the **Add a Business** form (n8n login required).
2. Fill it in and submit.
3. Scan the QR code with the business phone: WhatsApp → Linked devices → Link a device.

The bot is live as soon as WhatsApp connects. No workflow changes are needed.

## What each business can change (Supabase)

`clients`:

- `business_name`, `tagline`, `website`, `currency`
- `about`: shown for the "About" menu option and given to the AI
- `faqs`: hours, location, delivery, how to pay; given to the AI
- `tone`: how the AI should sound
- `menu`: up to 4 options `{"emoji","label","action":"about|services|ask","question"}`. Null uses the default menu. Option 5 is always "Talk to a person".
- `ai_prompt`: full custom AI instructions. Null builds them from the fields above.
- `services_note`: extra line under the products list
- `alert_numbers`, `alert_email`: where alerts go
- `daily_summary`: whether the business gets the morning report
- `active`: false stops the bot without deleting anything

`inventory`: `item_name`, `price`, `quantity`, `description`, `payment_url`
(any checkout link: Stripe, Paystack…).

## State

- Per-customer conversation state (session, handoff to a person, rate limit,
  lead/follow-up times) is in the n8n data table `wa_contacts`, keyed by
  `instance:phone`, so the same customer can talk to several businesses.
- Alerts are logged to Supabase `bot_events`.

## Files in `n8n/whatsapp/`

- `WhatsApp-Bot-Configuration-Map.pdf`: the full map: accounts, every engine step, behaviour, settings, adding a business by form or by hand, rebuilding, troubleshooting.
- `engine.workflow.json`: the engine, importable into any n8n (Workflows → Import from file). Credentials and the `wa_contacts` data table need picking after import.
- `schema.sql`: creates `clients`, `inventory` and `bot_events` on a fresh Supabase project.
