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
 * Every function here answers "not configured" rather than throwing, and the
 * checkout falls back to the static address it has always used. That is what
 * lets this ship before the BTCPay instance exists, and what keeps a BTCPay
 * outage from taking payments down entirely — the old path is still there, and
 * `npm run settle` still settles.
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
 * Returns null on any failure. The caller falls back to the static address —
 * a checkout that refuses because a payment processor is having a bad morning
 * is worse than a checkout that settles by hand.
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
      paymentMethod?: unknown;
    }[];

    /* On-chain BTC, not Lightning: the row stores one address and the Lightning
       path in this app is a separate branch with its own field. */
    const onChain = paid.find(
      (method) => typeof method.paymentMethod === "string" && method.paymentMethod === "BTC",
    ) ?? paid[0];

    const address = typeof onChain?.destination === "string" ? onChain.destination : null;
    const cryptoAmount = Number(onChain?.amount);
    const rateUsd = Number(onChain?.rate);

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
