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

`GET /api/health` answers both halves:

```json
{
  "cryptoCheckoutConfigured": true,   // at least one wallet is set
  "cryptoSettlementConfigured": true  // the callback secret is set
}
```

The second one is the failure worth watching for: a checkout with wallets but no
settlement secret looks perfect right up until somebody pays and is never
credited.
