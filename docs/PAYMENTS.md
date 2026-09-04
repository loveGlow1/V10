# Taking payment in cryptocurrency

Plans and credit top-ups are paid for in crypto. This is what has to exist for
the checkout to work end to end, and what each piece is responsible for.

Nothing here is optional-but-nice: with no wallet configured the checkout offers
no currencies at all, and with no settlement secret a payment can be made and
never credited. Both states are visible from `/api/health` — see the last
section.

## The flow

```
 browser                     this app                     the chain / processor
 ───────                     ────────                     ─────────────────────
 open checkout   ─GET──▶ /api/payments/crypto/quote
                          prices the purchase from the plan table,
                          reads live rates, lists the coins it can take
 pick a coin     ─POST─▶ /api/payments/crypto
                          locks the rate, writes a crypto_payments row,
                          returns the address and the exact amount
 pay from wallet ─────────────────────────────────────────▶  send
 "I've sent it"  ─POST─▶ /api/payments/crypto/:id/confirm
                          records the claim. Grants nothing.
                 ◀─POST─  /api/payments/crypto/webhook  ◀── confirmed
                          settle_crypto_payment() grants the credits
 polling         ─GET──▶ /api/payments/crypto/:id
```

Two properties hold the whole thing up:

- **The browser never names a price.** It says *what* is being bought — a paid
  plan, or a number of top-up packs — and the server reads what that costs from
  `credit_plans` / `TOP_UP_PACK`. There is no amount field in any request body,
  and there should never be one.
- **Only the webhook grants.** `settle_crypto_payment` is executable by
  `service_role` alone, and the button in the browser marks an order as
  *claimed*, not paid. A person pressing "I've sent the payment" cannot give
  themselves a plan.

`settle_crypto_payment` is idempotent: the order row is locked, an
already-confirmed order returns the balance untouched. Processors retry, and a
retry must not pay twice.

## Collecting into your own wallets

With static addresses — one per coin, set below — every customer pays into the
same address, and the chain records nothing that says which order a payment was
for. Two people buying Standard both send $25 of Bitcoin to the same place.

So **the amount is the identifier**. Every open order is given an amount no
other open order on that address is using: the create route nudges it up by one
unit at a time until the `crypto_payments_open_amount_idx` unique index accepts
it. On a coin quoted to eight places that costs the payer a fraction of a cent;
on a stablecoin quoted to two it is capped at a quarter of a dollar. Amounts are
freed again as soon as an order settles or expires.

That is what makes the manual step reliable:

```
npm run settle                      # every order still waiting, with its exact amount
npm run settle -- <reference>       # shows the order, asks, then settles it
npm run settle -- <id> <txid> --yes # unprompted, recording the transaction
```

`npm run settle` does not touch the database. It makes the same signed call to
`/api/payments/crypto/webhook` that a processor would, so credits are released
by one code path whoever triggers it. It needs `SUPABASE_SERVICE_ROLE_KEY` to
read orders, `CRYPTO_PAYMENTS_WEBHOOK_SECRET` to sign, and `APP_URL` to reach a
deployment other than `http://localhost:3000`.

**Match the amount exactly before confirming.** It is the only thing tying a
payment to an order; an approximate match is not a match.

### Settling without a webhook

`npm run settle` needs `CRYPTO_PAYMENTS_WEBHOOK_SECRET`. Until that is set on
the deployment, payments can still be settled by hand from **Supabase → SQL
Editor**, which runs as the function's owner and so may call it directly.

What is waiting:

```sql
select id,
       created_at,
       status,
       coalesce(plan_id, packs || ' × top-up pack') as buying,
       amount_usd,
       crypto_amount,
       upper(currency) as coin,
       address
from public.crypto_payments
where status in ('awaiting_payment', 'submitted')
order by created_at desc;
```

Check that a payment of **exactly** `crypto_amount` arrived at `address`, then:

```sql
select * from public.settle_crypto_payment(
  '00000000-0000-0000-0000-000000000000',  -- the id from the list above
  'transaction id from your wallet'        -- optional, kept on the order
);
```

It returns the account's balance after the grant. Running it twice grants
nothing further — the order is locked and an already-confirmed one returns
untouched — so a double-click cannot pay out twice.

Nothing else settles an order. There is no button in the app that does this, and
that is deliberate: the browser can only record that a payer *says* they have
paid.

## Automatic settlement, with BTCPay

Everything above is the manual path, and it stays. This is how to stop needing
it.

Set `BTCPAY_URL`, `BTCPAY_STORE_ID`, `BTCPAY_API_KEY` and
`BTCPAY_WEBHOOK_SECRET` (see `.env.local.example`) and the flow changes at two
points and nowhere else:

- `/api/payments/crypto` asks BTCPay for an invoice instead of handing out the
  static address. The invoice owns both the address AND the amount, and both are
  stored exactly as given — asking someone for a figure BTCPay is not watching
  for is a payment that arrives and never settles. Amount-nudging is skipped,
  because a per-invoice address makes the amount stop being the identifier.
- `/api/payments/crypto/btcpay` receives the callback and calls
  `settle_crypto_payment`, the same function `npm run settle` reaches.

It is a **separate route** from `/api/payments/crypto/webhook` because the
signatures differ: this app signs `timestamp.hmac` over `${issuedAt}\n${body}`
and checks a five-minute window, while BTCPay signs `sha256=<hmac>` over the raw
body with no timestamp. One verifier accepting both would accept anything valid
under the weaker scheme.

Because BTCPay's signature carries no timestamp, a captured callback can be
replayed forever — so the route treats the signature as the door and re-reads
the invoice from BTCPay for the decision. A replayed body asks the same question
and gets the same answer, which `settle_crypto_payment` then ignores as a
duplicate.

**BTCPay never holds the money.** Configure the store watch-only from an account
xpub/zpub and payments go straight into that wallet; BTCPay only observes. Use a
wallet created for this, not a personal one — an xpub reveals every address and
every balance it will ever derive.

With BTCPay unset, and for any coin but on-chain BTC, the static address and
the nudging are used exactly as before. Check which state a deployment is in
with `/api/health`: `btcpayInvoicing`, `btcpaySettlement`, and
`btcpayReachable` — which asks the instance rather than reading the variables,
because four variables being set says a deployment intends to invoice, not that
it can.

**Configured and failing asks a different question: is anything watching?**

The danger was never the static address. It was writing an order against an
address nothing would notice a payment to — with the invoice as the only sensor,
losing it meant money arriving, `settle_crypto_payment` never being called, and
the order sitting open until a person happened to look.

The sweep changed that. It reads the chain directly and needs no processor, so
the static address is watched whenever the sweep is alive. `/api/payments/crypto`
therefore reads the reconcile heartbeat when BTCPay issues no invoice: alive, and
the order falls back to the static address and the amount-nudging as before;
stale or never run, and the order is refused, because then nothing really is
watching. A customer who cannot pay for two minutes comes back; a customer who
pays and receives nothing does not.

Coinbase Commerce and NOWPayments would each need their own adapter route for
the same reason BTCPay does — the shape of the callback and the signature are
per-processor. The half that grants credits is already written and shared.

## The sweep, which depends on nobody

Both paths above wait to be told: BTCPay calls back, or a person runs
`npm run settle`. Both can stop happening without anything saying so, and the
money still arrives — a payment sits confirmed on a public ledger while the
order sits `awaiting_payment` and the account holds nothing.

`/api/cron/reconcile` asks instead of waiting. It reads the open on-chain BTC
orders, reads the chain through a public Esplora host (mempool.space, falling
back to blockstream.info — no key, no account), and calls
`settle_crypto_payment` for the ones that were paid in full and confirmed.

This is a floor, not a replacement. With BTCPay healthy its callback still
settles within a confirmation and the sweep finds nothing to do. With BTCPay
gone, wiped, or never correctly wired, the sweep pays the customers anyway —
late, which is survivable, rather than never, which is not.

Safe to run every minute: `settle_crypto_payment` is idempotent, so a sweep
racing the webhook still ends in one payout.

Every uncertainty resolves towards leaving the order alone and telling a person:

| What the chain says | What happens |
| --- | --- |
| No host answered | Nothing. Unknown is not zero — reading it as zero expires paid orders |
| Confirmed ≥ the amount | Settles, with the txid recorded |
| Unconfirmed coin, order live | Marked `submitted` — a payment on its way is not a payment missing |
| Nothing, past expiry | Expired. The ordinary end of an order |
| Coin present, past expiry | **Stranded** — alerted, never guessed at |

A short payment is never resolved automatically. What it is worth in credits is
a judgement, and guessing either shorts the customer or pays out more than
arrived. `decideOrder` in `src/lib/reconcile-decision.ts` holds these rules as a
pure function; `npm run check:reconcile` asserts them.

### Shared addresses are read differently, and it is not optional

An order on a **dedicated** address — one BTCPay derived for that invoice alone
— can be judged by what the address has received in total. Nothing else will
ever pay it, so "received at least what was asked" is the whole question.

An order on the **shared** static address cannot. That address's total is every
order that ever used it added together, so judging one order against it settles
that order the moment anybody has ever paid the address — including orders
nobody paid, and including every future order the instant one real payment
lands. On a shared address the AMOUNT is the identifier. That is what the create
route's nudging exists for, and it means nothing unless the chain is read
payment by payment rather than in total.

`crypto_payments.shared_address` records which kind an order used, written at
creation from whether an invoice was issued. It defaults to true, because exact
matching can only fail to settle while total matching can settle something that
was never paid.

Matched transactions are recorded in `tx_reference` and excluded from later
matching. Amounts are unique among *open* orders, not across history — without
that exclusion, the payment that settled a $25 order last month would settle the
next order nudged to the same figure.

**Scheduling it.** `CRON_SECRET` is required or the endpoint refuses every
caller — a cron endpoint that opens whenever a variable is missing is a public
one. Schedule it from anywhere that can send a header: n8n does it every thirty
minutes here, and a laptop's cron or `curl` works identically.

There is deliberately no `vercel.json` cron. Vercel's scheduler is the obvious
choice and was the first thing tried, but its cron rules are plan-dependent in a
way the code is not — an interval the plan disallows is a configuration error
that fails the whole deployment, taking the app down over a schedule. Keeping
the schedule outside the deployment means the sweep's cadence can never break
the thing it is sweeping.

**Knowing it still runs.** Every completed sweep writes to
`service_heartbeats`, and `/api/health` reports `reconcileStale`,
`reconcileLastRunAt` and `reconcileScheduled`. This is the one number on that
page worth alerting on: a job that has stopped and a job with nothing to do are
silent in identical ways, and settlement quietly not happening costs a customer
rather than a feature. `reconcileScheduled` separates "never wired up" from
"wired up and stopped".

**Stranded orders** are reported in the sweep's own JSON response and in the
log, and emailed if `RESEND_API_KEY` and `ALERT_EMAIL` are set — at most once a
day per order, tracked in `crypto_payments.alerted_at`. Detection never depends
on delivery: an alert that cannot be sent must not stop a sweep from finding the
next problem.

## Environment variables

### Wallets — one per coin you accept

A coin is offered **only** when its address is set. There is no default and no
fallback: an unset variable means that currency does not appear in the checkout.

| Variable | Coin |
| --- | --- |
| `CRYPTO_WALLET_BTC` | Bitcoin |
| `CRYPTO_WALLET_XRP` | XRP |
| `CRYPTO_WALLET_ETH` | Ethereum (ERC-20 address) |
| `CRYPTO_WALLET_LTC` | Litecoin |
| `CRYPTO_WALLET_USDT` | Tether (ERC-20) |
| `CRYPTO_WALLET_USDC` | USD Coin (ERC-20) |
| `CRYPTO_WALLET_SOL` | Solana |
| `CRYPTO_WALLET_DOGE` | Dogecoin |
| `CRYPTO_WALLET_BCH` | Bitcoin Cash |

Two extras:

- `CRYPTO_WALLET_XRP_TAG` — the destination tag for the XRP address. Set it if
  the address is on an exchange or any shared wallet; a payment that arrives
  without the tag is not credited to you, and the checkout shows the tag to the
  payer with that warning attached.
- `CRYPTO_LIGHTNING_BTC`, `CRYPTO_LIGHTNING_LTC` — a Lightning address or LNURL.
  Set one and the Lightning toggle appears on that coin; leave it unset and the
  toggle is not offered at all.

### Rates

| Variable | What it does |
| --- | --- |
| _(none)_ | Prices come from CoinGecko's public API, cached for 60 seconds |
| `COINGECKO_API_KEY` | Sent as `x-cg-demo-api-key`; raises the rate limit |
| `CRYPTO_RATES_URL` | Point the lookup at a different `simple/price`-shaped endpoint |
| `CRYPTO_RATE_BTC`, `CRYPTO_RATE_ETH`, … | Pin one coin's rate, in USD per coin |

A pinned rate is used exactly as given and never cached — for a staging
deployment with no outbound network, or a business pricing from its own desk.

If a rate cannot be read, the coin is left out of the quote; if none can be
read, the checkout says live prices are unavailable. It never falls back to a
figure nobody checked, because whatever figure it invented is the amount of real
Bitcoin somebody would then send.

### Settlement

| Variable | What it does |
| --- | --- |
| `CRYPTO_PAYMENTS_WEBHOOK_SECRET` | The shared secret every settlement callback is signed with |
| `SUPABASE_SERVICE_ROLE_KEY` | Already required by the builder; the payment routes write orders and settle them with it |

## The settlement callback

`POST /api/payments/crypto/webhook`

```json
{
  "paymentId": "5f1d…",
  "status": "confirmed",
  "txReference": "0xabc…",
  "reason": "underpaid"
}
```

`status` is `confirmed`, `failed` or `expired`. `txReference` and `reason` are
optional. The callback says *which* order settled; it never says what the order
was worth — the row already knows.

Every request must carry:

```
x-crypto-signature: <issuedAt>.<hex hmac-sha256>
```

where the signed payload is `${issuedAt}\n${rawBody}` — the exact bytes of the
body, not a re-serialisation of the parsed object — keyed with
`CRYPTO_PAYMENTS_WEBHOOK_SECRET`. Signatures more than five minutes old are
refused. `signSettlement()` in `src/lib/crypto-payments-server.ts` produces one
the same way the verifier expects it, which is the easiest way to test the
endpoint or to implement the sending side.

Unsigned callbacks are refused, and so is *every* callback when the secret is
unset: a webhook that waves callers through when it is misconfigured is a free
credit dispenser.

Statuses other than `confirmed` only ever move an order that is still open, so a
late `expired` cannot undo a payment that has already been credited.

## Database

`supabase/schema.sql` carries `crypto_payments` and `settle_crypto_payment()`.
Re-run the file — it is safe to run more than once.

The table is read-only from the browser: owners can select their own orders and
there is no insert, update or delete policy at all, because a client that could
write it could mark its own order confirmed.

## Checking a deployment

```
npm run check:payments                      # this machine's configuration
npm run check:payments https://your-site    # and that deployment's /api/health
```

It verifies each wallet address it can — anything Base58Check has a checksum, and
a checksum catches the one mistake that cannot be undone — reads a live price for
every coin on offer, and says which of the four silent failures you are in:

| What is missing | What the customer sees |
| --- | --- |
| A wallet | "Crypto payments are not switched on for this deployment" |
| A readable rate | "Live crypto prices are unavailable right now" |
| `SUPABASE_SERVICE_ROLE_KEY` | The coin list renders, then Pay fails |
| `CRYPTO_PAYMENTS_WEBHOOK_SECRET` | Nothing. It all works, and nobody is credited. |

That last row is why the script exists: it is the only failure that looks like
success from every screen.

`GET /api/health` answers the configuration half on its own:

```json
{
  "cryptoCheckoutConfigured": true,   // at least one wallet is set
  "cryptoSettlementConfigured": true  // the callback secret is set
}
```

The second one is the failure worth watching for: a checkout with wallets but no
settlement secret looks perfect right up until somebody pays and is never
credited.
