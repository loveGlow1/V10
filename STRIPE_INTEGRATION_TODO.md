# Stripe Checkout — Integration TODO

This file is the single source of truth for what is left to do before Stripe Checkout goes live.

## Values to Replace

**No placeholders remain.** All four sample values are now real; this table records what they are set to.

**Files:**
- [src/app/api/payments/stripe/checkout/route.ts](src/app/api/payments/stripe/checkout/route.ts)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | `payment` | Nothing to do: plans are one month paid once, matching crypto. Switch to `"subscription"` only if you build auto-renewal (then `payment_method_collection: "always"` is added automatically). |
| line_items | inline `price_data`, priced on the server from `PLANS` / `TOP_UP_PACK` in [src/app/dashboard/credits.ts](src/app/dashboard/credits.ts) (Standard $25, Pro $150, top-up $15 / 50 credits) | Nothing to do: no Stripe Products or Price IDs are needed. Change a price in `credits.ts` (and `credit_plans` in `supabase/schema.sql`) and card and crypto both follow. |

`success_url` and `cancel_url` are set to real values: both return to `${SITE_URL}/dashboard` (`?checkout=success&session_id=…` / `?checkout=cancelled`). `SITE_URL` comes from [src/lib/site.ts](src/lib/site.ts) (`NEXT_PUBLIC_SITE_URL`, defaulting to `https://www.quickstark.tech`).

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**
- [src/app/api/payments/stripe/checkout/route.ts](src/app/api/payments/stripe/checkout/route.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted_page` (installed `stripe` SDK is 22.x; SDKs below 21.0.0 would need `hosted`) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `false` |
| payment_method_collection | `always` (only sent when mode is `subscription`) |
| submit_type | `auto` |
| integration_identifier | `hosted_web_0001` |
| origin_context | `web` |

## Setup

1. **Dependency** — `stripe` has been added to `package.json`. Run `npm install`.
2. **Environment variables**
   - `STRIPE_SECRET_KEY` (server-only, no `NEXT_PUBLIC_` prefix). Get it from https://dashboard.stripe.com/test/apikeys and set it in **Vercel → Project Settings → Environment Variables** (and `.env.local` for local dev). Do **not** put it in `.env` — that file is committed. Without it the endpoint returns 503.
   - `STRIPE_WEBHOOK_SECRET` (server-only, `whsec_...`). Create a webhook endpoint at https://dashboard.stripe.com/workbench/webhooks pointing to `https://<your-domain>/api/payments/stripe/webhook`, subscribed to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`, then copy its signing secret into Vercel. Without it (or without `STRIPE_SECRET_KEY`) the webhook returns 503 and Stripe retries.
   - No publishable key is needed: hosted Checkout is a server-side redirect.
3. **API version** — the Stripe client is initialised without an explicit API version, so it uses the SDK's pinned default.
4. **Database** — ✅ done on 2026-09-29: `settle_stripe_checkout(session_id, user_id, credits, plan_id)` (top-ups and plans) is applied to the production Supabase project (`esuatccbicekcohzgcvd`), executable by `service_role` only. (It is also in [supabase/schema.sql](supabase/schema.sql) for fresh setups.) The webhook also needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel, which the crypto checkout already uses.

## New Files

```
src/app/api/payments/stripe/checkout/route.ts   POST → creates a Checkout Session, 303-redirects to Stripe
src/app/api/payments/stripe/webhook/route.ts    POST ← Stripe events; verifies the signature, grants credits on a paid session
supabase/schema.sql (appended)                  settle_stripe_checkout(): idempotent credit grant, service_role only
STRIPE_INTEGRATION_TODO.md                      this file
```

`.env.local.example` also gained commented `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` entries.

## How It Works

1. The dashboard's billing sheet has **two separate gateways**: **Pay $X with card** / **Card** (Stripe) and **Pay with crypto** / **Crypto** (the existing crypto sheet, unchanged), for both plans and the $15 top-up. The card button `POST`s `{ purchase }` to `/api/payments/stripe/checkout`, which requires a signed-in user, prices it on the server and answers `{ url }`; the browser then goes to that Stripe page. Refusals (400 / 401 / 503) are shown in the sheet. Neither gateway depends on the other.
2. The route calls `stripe.checkout.sessions.create(...)` with the user's id and what they bought (`kind` = `plan` + `plan_id`, or `topup` + `credits`) in the session metadata. Plans are sold the way the crypto checkout sells them: **one month, paid once** (`mode: payment`), not an auto-renewing subscription.
3. The customer pays on the Stripe-hosted page.
4. Stripe sends the customer back to the dashboard (`success_url` or `cancel_url`).
5. Separately, Stripe POSTs `checkout.session.completed` to `/api/payments/stripe/webhook`. The route verifies the `Stripe-Signature` header and, when the session is paid, calls `settle_stripe_checkout`: for a top-up it adds the credits to the top-up bucket; for a plan it moves the account to that plan and opens a new cycle with the plan's monthly credits (same rules as `settle_crypto_payment`). Either way it writes a `credit_ledger` row. Delayed payment methods (bank debits) arrive as `payment_status: "unpaid"` and are credited on `checkout.session.async_payment_succeeded` instead. Crediting is idempotent on the session id (the ledger row's `dedupe_key` is `stripe:<session id>`), so re-delivered events never grant twice.


## Testing

Use test-mode keys (`sk_test_...`) and these cards with any future expiry, any CVC and any postal code:

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |
| `4000 0000 0000 9995` | Declined (insufficient funds) |

More: https://docs.stripe.com/testing

**Testing the webhook locally** with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/payments/stripe/webhook   # prints a whsec_… — use it as STRIPE_WEBHOOK_SECRET in .env.local
stripe trigger checkout.session.completed
```

## Next Steps

- **Success / cancel pages** — build them and point the URLs at them.
- **Fulfillment**: done for plans (one month) and top-ups. If you later want plans to auto-renew by card, that needs Stripe subscriptions (`mode: subscription`, `invoice.paid` renewals, cancellation). Never grant anything from the success page.
- **Order tracking** — each paid session is in `credit_ledger` (`dedupe_key = 'stripe:<session id>'`). Persist the Stripe `customer` ID if you want to reuse saved cards or add subscriptions.
- **Refunds** — refunding in Stripe does not remove credits. Handle `charge.refunded` if that matters.
- **Go live** — swap to live keys and re-create prices in live mode.

## Resources

- Stripe support: https://support.stripe.com
- Stripe MCP server: https://docs.stripe.com/mcp
- Checkout docs: https://docs.stripe.com/payments/checkout
