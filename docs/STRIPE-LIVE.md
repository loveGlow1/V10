# Stripe in live mode — the full setup

Everything QuickStark needs from Stripe and Vercel to take real payments.
Do the steps in order. Every value below is exact — copy it as written.

> **Before you start:** in the Stripe dashboard, switch the **Test mode**
> toggle (top right) **off**. Every step here is done in **live mode**.

---

## 1. Live API key → Vercel

**Stripe:** Developers → **API keys** → *Secret key* → **Reveal** → copy.
It starts with `sk_live_`.

**Vercel:** Project → **Settings → Environment Variables** → environment
**Production**:

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` (the key you just copied) |

- A key starting `sk_test_` is **ignored on the live site** on purpose (test
  cards are accepted by anyone). Use the live one.
- The publishable key (`pk_live_…`) is **not needed** — every Stripe page
  QuickStark opens is hosted by Stripe.
- Delete any older `STRIPE_SECRET_KEY` value under Production first, so only
  the live one remains.

---

## 2. Live webhook (step 2)

**Stripe:** Developers → **Webhooks** → **Add endpoint** (or *Add destination*
→ *Webhook endpoint*).

| Setting | Value |
|---|---|
| Endpoint URL | `https://www.quickstark.tech/api/payments/stripe/webhook` |
| Description | `QuickStark — cards, plans and top-ups` |
| Events from | **Your account** |
| API version | leave the default |

**Events to send** — select exactly these five:

| Event | What QuickStark does with it |
|---|---|
| `checkout.session.completed` | Saves a card (free credit), or settles a top-up |
| `checkout.session.async_payment_succeeded` | Settles a top-up whose payment cleared later |
| `checkout.session.async_payment_failed` | Logged; nothing is granted |
| `checkout.session.expired` | Abandoned checkout; nothing to do |
| `invoice.paid` | **Monthly plans:** the first month and every renewal |

Then **Add endpoint** → open it → **Signing secret** → **Reveal** → copy
(starts with `whsec_`).

**Vercel** (Production):

| Name | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (the signing secret you just copied) |

> Use the URL **with `www.`** exactly as above. A redirect from the bare
> domain would make Stripe's deliveries fail.

---

## 3. Customer portal (step 3)

This powers **Billing → "Manage or cancel your subscription"**.

**Stripe:** Settings → **Billing → Customer portal** (live mode).

| Section | Setting |
|---|---|
| **Business information** | Headline: `QuickStark.Ai` · Privacy policy: `https://www.quickstark.tech/privacy` · Terms of service: `https://www.quickstark.tech/terms` |
| **Invoices** | **On** — show invoice history |
| **Customer information** | Allow updating: **Email**, **Billing address** |
| **Payment methods** | **On** — customers can update payment methods |
| **Cancellations** | **On** — Cancel: **At end of billing period** · Ask for a reason: **On** (optional) |
| **Subscriptions → switch plans** | **Off** (plans are priced by QuickStark at checkout; a change of plan is a new checkout) |
| **Subscriptions → quantities / promo codes** | **Off** |
| **Default redirect link** | `https://www.quickstark.tech/dashboard` |

Click **Save changes**. (Until it is saved once in live mode, the portal link
fails.)

---

## 4. Payment settings to check

**Stripe:** Settings → **Payments → Payment methods** (live mode):

- **Cards:** On (Visa, Mastercard, Verve-branded Mastercard/Visa, Amex…)
- **Apple Pay / Google Pay:** On (they arrive as cards)
- **Link:** may stay on — QuickStark accepts it
- Everything else (Klarna, Cash App, Amazon Pay, bank debits…): QuickStark
  excludes them on the card page anyway; leaving them on does no harm.

**Settings → Managed Payments:** leave **On** (Stripe handles tax, VAT and
invoices worldwide). QuickStark already opts card-saving pages out of it, as
Stripe requires.

**Settings → Payments → Adaptive Pricing:** leave **On** — Nigerian and other
buyers see local prices; QuickStark values every currency in dollars.

---

## 5. Other Vercel variables (Production)

| Name | Value | Why |
|---|---|---|
| `CRON_SECRET` | any long random string, e.g. from `openssl rand -hex 32` | Runs the daily exchange-rate refresh and the payment-recovery sweep |
| `NEXT_PUBLIC_SITE_URL` | `https://www.quickstark.tech` | Where Stripe sends people back to (optional — this is the default) |

---

## 6. Deploy

1. Merge the branch `claude/laughing-maxwell-l7i4v7` into `main`.
2. Vercel → **Deployments** → latest Production → **Redeploy** (environment
   variables only take effect on a new deployment).

---

## 7. Check it is live

Open **https://www.quickstark.tech/api/health** — full production reads:

```json
"stripe": {
  "mode": "live",
  "liveOnProduction": true,
  "testKeyRefused": false,
  "webhookSecretSet": true
}
```

| If you see | Fix |
|---|---|
| `"mode": "test"`, `"testKeyRefused": true` | Step 1: the Production key is still `sk_test_…` |
| `"mode": "none"` | Step 1: `STRIPE_SECRET_KEY` missing under Production, or not redeployed |
| `"webhookSecretSet": false` | Step 2: `STRIPE_WEBHOOK_SECRET` missing or not starting `whsec_` |
| no `"stripe"` at all | Step 6: the branch is not merged/deployed yet |

Then, signed in to a QuickStark account that has never paid:

1. **Add card** → enter a real card → you return to "Card verified" — **no
   charge** appears on the card.
2. Stripe → **Webhooks** → your endpoint → the `checkout.session.completed`
   delivery shows **200**.
3. (Optional) Buy Standard → Stripe shows an active **subscription** → the
   `invoice.paid` delivery shows **200** → Billing shows "Manage or cancel".

---

## What changes for users the moment this is live

- Accounts that have never paid and have no owner-gifted credit (28 today)
  see **"Add a card"** before they can use the service. Adding it is never
  charged; a new account gets its 5 free credits then.
- Owner-gifted credit keeps working without a card until it is spent.
- Plans bought by card **renew monthly** (or yearly) until cancelled.
