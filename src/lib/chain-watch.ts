/* Reading the Bitcoin chain directly, without asking anyone's permission.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Settlement used to have exactly one sensor: BTCPay's callback. That is a
 * single point of failure in the shape that hurts most — it fails silently and
 * on the far side of the money. A customer sends coin, the callback that was
 * going to notice never arrives, and the order sits awaiting_payment while the
 * payment sits confirmed on a public ledger anyone can read.
 *
 * So read it. The chain is the record; a processor is only ever a convenience
 * on top of it. Nothing here needs an account, a key, or a contract with
 * anybody, which is the entire point: there is no arrangement to lose.
 *
 * ── Esplora ────────────────────────────────────────────────────────────────
 *
 * Both hosts below speak the same API (Blockstream's Esplora), so the fallback
 * costs one constant rather than a second client. Neither is trusted more than
 * the other and neither needs to be: the question asked is "how much has this
 * address received", the answer is a number from a public ledger, and a host
 * that lies about it can only lie downward — which fails closed, leaving the
 * order open for a person to look at rather than crediting one that was never
 * paid.
 *
 * Confirmed only. Esplora reports mempool and chain totals separately, and
 * only the chain total — a transaction in a block — settles. The mempool total
 * is still worth having: it is the difference between a customer whose payment
 * is visibly on its way and one whose payment is nowhere, and those deserve
 * different screens.
 */

/** Esplora hosts, tried in order. Public, keyless, and interchangeable. */
const ESPLORA_HOSTS = ["https://mempool.space/api", "https://blockstream.info/api"] as const;

const SATS_PER_BTC = 100_000_000;

/** BTC as the order records it → satoshis as the chain counts them. */
export const btcToSats = (btc: number) => Math.round(btc * SATS_PER_BTC);

export type AddressFunding = {
  /** Received in confirmed transactions. This is what may settle an order. */
  confirmedSats: number;
  /** Received but still unconfirmed. Never settles; says a payment is coming. */
  pendingSats: number;
};

type EsploraStats = { funded_txo_sum?: unknown };
type EsploraAddress = { chain_stats?: EsploraStats; mempool_stats?: EsploraStats };

const sum = (stats: EsploraStats | undefined) => {
  const value = Number(stats?.funded_txo_sum);
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * How much this address has received, ever.
 *
 * Null means nobody answered — which is not the same as zero and must never be
 * treated as it. An address that reads zero because both hosts were down would
 * expire an order that was paid.
 */
export async function addressFunding(
  address: string,
  timeoutMs = 8000,
): Promise<AddressFunding | null> {
  for (const host of ESPLORA_HOSTS) {
    const body = (await fetchJson(
      `${host}/address/${encodeURIComponent(address)}`,
      timeoutMs,
    )) as EsploraAddress | null;

    if (!body) continue;

    return {
      confirmedSats: sum(body.chain_stats),
      pendingSats: sum(body.mempool_stats),
    };
  }

  // eslint-disable-next-line no-console
  console.error("chain-watch: no Esplora host answered for", address);
  return null;
}

/**
 * The most recent confirmed transaction id paying this address.
 *
 * Only for the record kept on a settled order, so a disputed payment can be
 * looked up rather than argued over. Best-effort by design: an order that
 * settles without one is still settled, and refusing to credit a paid customer
 * because a block explorer was slow would be absurd.
 */
export async function fundingTxid(address: string, timeoutMs = 8000): Promise<string | null> {
  for (const host of ESPLORA_HOSTS) {
    const body = await fetchJson(`${host}/address/${encodeURIComponent(address)}/txs`, timeoutMs);
    if (!Array.isArray(body)) continue;

    for (const tx of body) {
      const record = tx as { txid?: unknown; status?: { confirmed?: unknown } };
      if (record.status?.confirmed === true && typeof record.txid === "string") return record.txid;
    }
  }

  return null;
}
