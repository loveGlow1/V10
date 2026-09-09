import { createHmac, timingSafeEqual } from "node:crypto";

/* BTCPay Server, which is the thing that watches the chain.
 *
 * ── What it replaces ───────────────────────────────────────────────────────
 *
 * Before this, an order was written against ONE static receiving address, the
 * amount was nudged a satoshi at a time until it was unique among open orders,
 * and nothing noticed when the money arrived. Settlement was a person: read the
 * wallet, match the amount by eye, run `npm run settle`. A customer who paid at
 * three in the morning held zero credits until somebody woke up.
 *
 * BTCPay issues one address per invoice and calls back when it is paid, which
 * removes both problems at once — the address IS the identifier, so the amount
 * no longer has to be, and the callback is the sensor nothing else provided.
 *
 * ── What it does not do ────────────────────────────────────────────────────
 *
 * It never holds the money. The store is configured watch-only from an
 * account xpub/zpub, so funds are paid straight into the wallet that key
 * belongs to and BTCPay only observes. There is no custody to lose and no
 * payout step to wait on.
 *
 * ── Optional on purpose ────────────────────────────────────────────────────
 *
 * Every function here answers "not configured" rather than throwing, and on a
 * deployment with no BTCPay at all the checkout falls back to the static
 * address it has always used. That is what lets this ship before the instance
 * exists, and `npm run settle` still settles those.
 *
 * Configured-and-failing is a different case and is NOT fallen back from: see
 * the refusal in api/payments/crypto/route.ts. An invoice is what watches for
 * the payment, so quietly writing an order without one takes money nothing is
 * watching for.
 */

export type BtcPayInvoice = {
  /** BTCPay's own id, echoed back on every webhook about this invoice. */
  id: string;
  /** The address THIS invoice is to be paid to. One per invoice. */
  address: string;
  /** How much, in the coin, exactly as BTCPay will expect it. */
  cryptoAmount: number;
  /** The rate BTCPay priced it at, in USD per whole coin. */
  rateUsd: number;
};

function config() {
  const url = process.env.BTCPAY_URL?.trim().replace(/\/+$/, "");
  const storeId = process.env.BTCPAY_STORE_ID?.trim();
  const apiKey = process.env.BTCPAY_API_KEY?.trim();
  return url && storeId && apiKey ? { url, storeId, apiKey } : null;
}

/** Whether this deployment can issue BTCPay invoices at all. */
export const isBtcPayConfigured = () => config() !== null;

/** Whether settlement callbacks from BTCPay can be verified. Separate from the
 *  above, and it fails separately: an instance that can issue invoices but
 *  cannot prove its callbacks is an instance that must not settle anything. */
export const isBtcPayWebhookConfigured = () =>
  Boolean(process.env.BTCPAY_WEBHOOK_SECRET?.trim());

function headers(apiKey: string) {
  return { "content-type": "application/json", authorization: `token ${apiKey}` };
}

/**
 * Opens an invoice and returns the address to send to.
 *
 * `orderId` is OUR crypto_payments id, carried in the invoice metadata so a
 * callback can be traced back to the order without a second lookup table. The
 * row is inserted with that id afterwards, which is why the caller generates it
 * rather than letting the database.
 *
 * Two calls rather than one: creating an invoice does not return an address,
 * because BTCPay does not derive one until it knows which payment method is
 * being used. The second call asks.
 *
 * Returns null on any failure, and the caller refuses the order rather than
 * writing one to an address nothing is watching. Refusing is the kinder half
 * of that trade: two minutes of "try again" against a customer who pays and
 * receives nothing.
 */
export async function createBtcPayInvoice(input: {
  orderId: string;
  amountUsd: number;
  /** Minutes the quote is good for. Kept in step with RATE_LOCK_MINUTES so the
   *  invoice and the row expire together rather than one outliving the other. */
  expiryMinutes: number;
  receiptEmail?: string | null;
}): Promise<BtcPayInvoice | null> {
  const conf = config();
  if (!conf) return null;

  try {
    const created = await fetch(`${conf.url}/api/v1/stores/${conf.storeId}/invoices`, {
      method: "POST",
      headers: headers(conf.apiKey),
      body: JSON.stringify({
        amount: input.amountUsd.toFixed(2),
        currency: "USD",
        /* orderId is what the callback is matched on. buyerEmail is only a
           receipt convenience and is dropped when we do not have one. */
        metadata: {
          orderId: input.orderId,
          ...(input.receiptEmail ? { buyerEmail: input.receiptEmail } : {}),
        },
        checkout: {
          expirationMinutes: input.expiryMinutes,
          /* One confirmation. The default speed policy waits for more, which is
             an hour a customer spends looking at a spinner for a $25 order. */
          speedPolicy: "MediumSpeed",
        },
      }),
    });

    if (!created.ok) {
      // eslint-disable-next-line no-console
      console.error("btcpay: could not create an invoice:", created.status, await created.text());
      return null;
    }

    const invoice = (await created.json()) as { id?: unknown };
    const id = typeof invoice.id === "string" ? invoice.id : null;
    if (!id) return null;

    const methods = await fetch(
      `${conf.url}/api/v1/stores/${conf.storeId}/invoices/${id}/payment-methods`,
      { headers: headers(conf.apiKey) },
    );

    if (!methods.ok) {
      // eslint-disable-next-line no-console
      console.error("btcpay: invoice has no payment methods:", methods.status);
      return null;
    }

    const paid = (await methods.json()) as {
      destination?: unknown;
      amount?: unknown;
      rate?: unknown;
      /* BTCPay 1.x. */
      paymentMethod?: unknown;
      /* BTCPay 2.x, where "BTC" became "BTC-CHAIN" and "BTC-LN". */
      paymentMethodId?: unknown;
    }[];

    /* On-chain BTC, and only on-chain: this app stores one address per order and
       treats Lightning as a separate branch with its own field.
     *
     * Both spellings, because the name changed. BTCPay 1.x said
     * `paymentMethod: "BTC"`; 2.x says `paymentMethodId: "BTC-CHAIN"` — verified
     * against a real 2.4.4 response, which is also where the rest of these field
     * names come from.
     *
     * The old code matched 1.x only and leaned on a `?? paid[0]` fallback, which
     * hid the mismatch completely: with one payment method enabled the first
     * entry IS the on-chain one, so it worked by accident. Turn Lightning on and
     * it would have started handing out a Lightning destination as though it
     * were an address. Matching explicitly and refusing when nothing matches is
     * the difference between working and appearing to work. */
    const isOnChain = (method: (typeof paid)[number]) => {
      const id = method.paymentMethodId ?? method.paymentMethod;
      return typeof id === "string" && (id === "BTC" || id === "BTC-CHAIN");
    };

    const onChain = paid.find(isOnChain);

    if (!onChain) {
      // eslint-disable-next-line no-console
      console.error(
        "btcpay: no on-chain BTC payment method on the invoice:",
        paid.map((method) => method.paymentMethodId ?? method.paymentMethod),
      );
      return null;
    }

    /* All three arrive as STRINGS — "0.00030822", "81111.12" — so they go
       through Number() rather than being trusted as numbers. */
    const address = typeof onChain.destination === "string" ? onChain.destination : null;
    const cryptoAmount = Number(onChain.amount);
    const rateUsd = Number(onChain.rate);

    if (!address || !Number.isFinite(cryptoAmount) || cryptoAmount <= 0) return null;

    return {
      id,
      address,
      cryptoAmount,
      /* BTCPay's rate when it gave one, ours otherwise — the caller passes its
         own as the fallback, so a missing rate is cosmetic rather than fatal. */
      rateUsd: Number.isFinite(rateUsd) && rateUsd > 0 ? rateUsd : 0,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("btcpay: invoice request failed:", error);
    return null;
  }
}

/** The header BTCPay signs its callbacks with. */
export const BTCPAY_SIGNATURE_HEADER = "btcpay-sig";

/**
 * Whether this callback really came from the configured BTCPay store.
 *
 * BTCPay signs the RAW BODY with the webhook secret and sends it as
 * `sha256=<hex>`. Note the difference from this app's own settlement
 * signature, which covers a timestamp as well and so cannot be replayed a day
 * later: BTCPay's has no timestamp, which is why the handler re-reads the
 * invoice from BTCPay rather than trusting the body it was handed.
 *
 * Refuses when no secret is set. An unverifiable callback that grants credits
 * is the whole thing this exists to prevent.
 */
export function verifyBtcPayWebhook(rawBody: string, signature: unknown): boolean {
  const secret = process.env.BTCPAY_WEBHOOK_SECRET?.trim();
  if (!secret || typeof signature !== "string") return false;

  const sent = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(sent, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Reads an invoice back from BTCPay.
 *
 * The callback says an invoice settled; this asks BTCPay whether that is true.
 * A valid signature proves the body was written by someone holding the secret,
 * not that the body is current — and since BTCPay's signature carries no
 * timestamp, a captured callback can be replayed. Settling from the answer to
 * this question rather than from the delivered body closes that.
 */
export async function readBtcPayInvoice(
  invoiceId: string,
): Promise<{ status: string; orderId: string | null } | null> {
  const conf = config();
  if (!conf) return null;

  try {
    const response = await fetch(
      `${conf.url}/api/v1/stores/${conf.storeId}/invoices/${invoiceId}`,
      { headers: headers(conf.apiKey) },
    );
    if (!response.ok) return null;

    const invoice = (await response.json()) as {
      status?: unknown;
      metadata?: { orderId?: unknown };
    };

    const orderId =
      typeof invoice.metadata?.orderId === "string" ? invoice.metadata.orderId : null;

    return { status: String(invoice.status ?? ""), orderId };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("btcpay: could not read the invoice back:", error);
    return null;
  }
}

/**
 * Whether the configured BTCPay is actually answering, right now.
 *
 * Separate from isBtcPayConfigured on purpose, and the difference is the whole
 * point: four environment variables being set says a deployment INTENDS to
 * invoice, not that it can. Those two came apart in the worst possible way on
 * a shared instance that was wiped without notice — the variables stayed set,
 * every health check stayed green, and invoice creation had been failing for
 * as long as it took someone to notice by hand.
 *
 * So this asks the store about itself. Cheap, unauthenticated of nothing (the
 * key is sent, and a 401 is as much a failure as a timeout — a revoked key
 * takes payments down exactly as a dead host does), and short-fused: a health
 * check that hangs is a health check nobody runs.
 *
 * "unconfigured" is not a failure. It is the deployment that never had BTCPay,
 * whose checkout falls back to the static address by design.
 */
export async function btcPayReachable(
  timeoutMs = 4000,
): Promise<"ok" | "unreachable" | "unconfigured"> {
  const conf = config();
  if (!conf) return "unconfigured";

  try {
    const response = await fetch(`${conf.url}/api/v1/stores/${conf.storeId}`, {
      headers: headers(conf.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error("btcpay: store is not answering:", response.status);
      return "unreachable";
    }

    return "ok";
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("btcpay: store probe failed:", error);
    return "unreachable";
  }
}
