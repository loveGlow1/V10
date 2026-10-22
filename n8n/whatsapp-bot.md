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
| **WhatsApp Bot — Daily Summary** | 08:00 Lagos: one report per business to its `alert_numbers` (WhatsApp) and `alert_email`, from `bot_events`. |
| **WhatsApp Bot — Error Alerts** | Error workflow: WhatsApps and emails the platform owner when a run fails (email = `alert_email` of the business whose instance sends alerts). |
| **WhatsApp Bot — Edit a Business** | n8n-login form: find a business, change prices, products, details or pause it on a pre-filled page, save in one click. |
| **WhatsApp Bot — Setup / Move** | One-click setup on a new n8n: creates the data tables, saves `wa_settings`, repoints every business's WhatsApp. See MAP.md → *Move to a new n8n*. |

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
- `contact_email`: shown on its own line on the "Talk to a person" reply
- `contact_phone`: text line, shown on its own line under the email
- `daily_summary`: whether the business gets the morning report
- `active`: false stops the bot without deleting anything

`inventory`: `item_name`, `price`, `quantity`, `description`, `payment_url`
(any checkout link: Stripe, Paystack…).

## Email

Every alert, the daily report and error alerts also go by email through one Gmail login in n8n (credential named **Gmail account**). The three email steps (Engine → Email Alert, Daily Summary → Email Summary, Error Alerts → Email the Owner) stay switched off until that login exists; after adding it, select it on those three steps and switch them on.

## Settings

The Evolution address, Supabase project ref, engine webhook URL and the owner's
alert number live in the n8n data table `wa_settings`, filled in by Setup / Move.
No workflow has them written in.

## State

- Per-customer conversation state (session, handoff to a person, rate limit,
  lead/follow-up times) is in the n8n data table `wa_contacts`, keyed by
  `instance:phone`, so the same customer can talk to several businesses.
- Alerts are logged to Supabase `bot_events`.

## Files in `n8n/whatsapp/`

- `MAP.md`: the configuration map, readable on GitHub (diagram included).
- `WhatsApp-Bot-Configuration-Map.pdf`: the same map as a printable PDF.
- `WhatsApp-Bot-What-It-Does.pdf`: two-page overview of what the system does, for sharing.
- `WhatsApp-Assistant-Dashboard-Architecture.pdf`: plan for a business dashboard (self sign-up, one-click setup, owners control their bot and inventory), comparing adding it to quickstark.tech with a separate site, plus the AI usage cost calculation, credit pricing and how to implement credits.
- `1-setup-move.workflow.json` … `6-edit-a-business.workflow.json`: all six workflows, importable into any n8n (Workflows → Import from file). Logins are matched by name; data tables by name.
- `schema.sql`: creates `clients`, `inventory` and `bot_events` on a fresh Supabase project.
