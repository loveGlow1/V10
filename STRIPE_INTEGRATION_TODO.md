# Stripe Checkout — Integration TODO

This file is the single source of truth for what is left to do before Stripe Checkout goes live.

## Values to Replace

The following values are placeholders and must be updated before going live.

**Files containing placeholders:**
- [src/app/api/payments/stripe/checkout/route.ts](src/app/api/payments/stripe/checkout/route.ts)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | `payment` | Set to `"payment"` for one-time charges or `"subscription"` for recurring billing. `payment_method_collection` is added automatically only when mode is `"subscription"`. |
| success_url | `${SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}` | Your actual post-payment success page URL. Keep the `{CHECKOUT_SESSION_ID}` template. No `/success` page exists yet. |
| cancel_url | `${SITE_URL}/cancel` | Your actual cancel/return page URL. No `/cancel` page exists yet. |
| line_items[].price | `price_...` | Your actual Stripe Price ID from the Dashboard (https://dashboard.stripe.com/prices) or API. |

`SITE_URL` comes from [src/lib/site.ts](src/lib/site.ts) (`NEXT_PUBLIC_SITE_URL`, defaulting to `https://www.quickstark.tech`).

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

## New Files

```
src/app/api/payments/stripe/checkout/route.ts   POST → creates a Checkout Session, 303-redirects to Stripe
src/app/api/payments/stripe/webhook/route.ts    POST ← Stripe events; verifies the signature, handles checkout.session.*
STRIPE_INTEGRATION_TODO.md                      this file
```

`.env.local.example` also gained commented `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` entries.

## How It Works

1. The browser submits a form (or `fetch`) with `POST /api/payments/stripe/checkout`, e.g.
   ```html
   <form action="/api/payments/stripe/checkout" method="POST"><button>Checkout</button></form>
   ```
2. The route calls `stripe.checkout.sessions.create(...)` and responds with a `303` to `session.url`.
3. The customer pays on the Stripe-hosted page.
4. Stripe redirects to `success_url` (with the session ID) or `cancel_url`.
5. Separately, Stripe POSTs `checkout.session.completed` to `/api/payments/stripe/webhook`. The route verifies the `Stripe-Signature` header and calls `fulfill()` when the session is paid. Delayed payment methods (bank debits) arrive as `payment_status: "unpaid"` and are fulfilled on `checkout.session.async_payment_succeeded` instead.

No button in the UI calls this endpoint yet — wire one into the pricing/checkout UI.

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

- **Products & prices** — create them in the Dashboard and replace `price_...`; decide `payment` vs `subscription`.
- **Success / cancel pages** — build them and point the URLs at them.
- **Fulfillment** — the webhook is in place, but `fulfill()` in [src/app/api/payments/stripe/webhook/route.ts](src/app/api/payments/stripe/webhook/route.ts) only logs the session. Replace it with the real grant (credits, plan, access). It must be idempotent on `session.id`, because Stripe can deliver an event more than once. For credits, follow the idempotent-settlement pattern already used by `/api/payments/crypto/webhook` (see `docs/PAYMENTS.md`). Never grant anything from the success page.
- **Order tracking** — associate the session with the signed-in user (e.g. `client_reference_id` or `metadata`) and persist `customer` / `subscription` IDs in Supabase once fulfillment exists.
- **Auth** — the endpoint currently takes no session; decide whether checkout requires a signed-in user.
- **Go live** — swap to live keys and re-create prices in live mode.

## Resources

- Stripe support: https://support.stripe.com
- Stripe MCP server: https://docs.stripe.com/mcp
- Checkout docs: https://docs.stripe.com/payments/checkout
