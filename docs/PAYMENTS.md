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

If you later move to a processor (BTCPay, Coinbase Commerce, NOWPayments), it
issues a fresh address per order and calls that same webhook itself — the
manual step and the distinct-amount nudging both become unnecessary, and
nothing else about the flow changes.

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
