import type { SupabaseClient } from "@supabase/supabase-js";

import { addressFunding, btcToSats, fundingTxid } from "./chain-watch";
import { decideOrder } from "./reconcile-decision";

/* Reconciling ONE order against the chain.
 *
 * Two callers, and they must not drift apart. The batch sweep runs every half
 * hour over every open order; the checkout screen asks about a single order
 * while somebody sits watching it. If those two ever disagreed about what
 * counts as paid, which one a customer got would depend on whether they kept
 * the tab open — so there is one implementation and both use it.
 *
 * Nothing here decides anything. decideOrder does, purely and under test; this
 * fetches what that decision needs, carries it out, and reports what actually
 * happened rather than what was intended.
 */

export const RECONCILABLE_COLUMNS =
  "id, status, address, crypto_amount, expires_at, alerted_at, shared_address, chain_checked_at" as const;

export type ReconcilableOrder = {
  id: string;
  status: string;
  address: string;
  crypto_amount: number;
  expires_at: string;
  alerted_at: string | null;
  shared_address: boolean;
  chain_checked_at: string | null;
};

export type ReconcileOutcome =
  | { kind: "settled"; txid: string | null }
  | { kind: "submitted" }
  | { kind: "expired" }
  | { kind: "stranded"; reason: string; expectedSats: number; receivedSats: number }
  /* Read, and correctly left as it is. */
  | { kind: "unchanged" }
  /* No chain host answered. Not the same as nothing having arrived. */
  | { kind: "unreadable" }
  | { kind: "failed"; action: string; why: string };

/* A status change, and whether it actually happened.
 *
 * Asked rather than assumed, because the first version of the sweep did not
 * ask: it counted the changes it had DECIDED on, reported five orders expired,
 * and five orders sat untouched. An unchecked error and an update that matched
 * nothing are indistinguishable from success when nobody looks at the result.
 *
 * `.select("id")` is what separates the three cases — PostgREST returns the
 * rows it changed, so zero rows back is a filter that matched nothing rather
 * than a write that failed, and those want different fixes. */
async function changeStatus(
  service: SupabaseClient,
  id: string,
  from: string[],
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const { data, error } = await service
    .from("crypto_payments")
    .update(patch)
    .eq("id", id)
    .in("status", from)
    .select("id");

  if (error) {
    // eslint-disable-next-line no-console
    console.error("reconcile: could not update", id, error);
    return { ok: false, why: error.message };
  }

  if (!data || data.length === 0) {
    return { ok: false, why: `no row matched id=${id} in status ${from.join("/")}` };
  }

  return { ok: true };
}

/**
 * Transactions already credited to some other order.
 *
 * Only shared addresses need this, and they need it badly: there the amount
 * identifies the order, and amounts are unique among OPEN orders rather than
 * across all history. Without it, the payment that settled a $25 order last
 * month settles the next order nudged to the same figure — for free, and
 * repeatedly.
 */
export async function loadUsedTxids(service: SupabaseClient): Promise<Set<string>> {
  const { data } = await service
    .from("crypto_payments")
    .select("tx_reference")
    .eq("status", "confirmed")
    .not("tx_reference", "is", null);

  return new Set(
    (data ?? [])
      .map((row) => (row as { tx_reference: string | null }).tx_reference)
      .filter((id): id is string => typeof id === "string"),
  );
}

/**
 * Reads the chain for one order and acts on what it says.
 *
 * `usedTxids` is mutated on a settlement, so that within one sweep a payment
 * cannot be credited to two orders asking the same amount.
 */
export async function reconcileOrder(
  service: SupabaseClient,
  order: ReconcilableOrder,
  usedTxids: Set<string>,
  now: number,
): Promise<ReconcileOutcome> {
  const funding = await addressFunding(order.address);

  if (!funding) return { kind: "unreadable" };

  /* Recorded whether or not anything changed: the point is that the chain WAS
     asked, which is what the checkout screen's throttle reads. Failure to
     record is not worth failing a settlement over. */
  await service
    .from("crypto_payments")
    .update({ chain_checked_at: new Date(now).toISOString() })
    .eq("id", order.id);

  const expectedSats = btcToSats(Number(order.crypto_amount));

  const action = decideOrder(
    {
      status: order.status,
      expectedSats,
      expiresAt: new Date(order.expires_at).getTime(),
      sharedAddress: order.shared_address,
    },
    funding,
    now,
    usedTxids,
  );

  if (action.kind === "leave") return { kind: "unchanged" };

  if (action.kind === "settle") {
    /* The transaction the decision matched, where it could name one. On a
       shared address that is the payment carrying this order's exact amount,
       which is also what stops it being counted twice. */
    const txid = action.txid ?? (await fundingTxid(order.address));

    const { error } = await service.rpc("settle_crypto_payment", {
      p_payment_id: order.id,
      p_tx_reference: txid,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error("reconcile: settlement failed for", order.id, error);
      return {
        kind: "stranded",
        reason: "paid on chain, but settlement failed",
        expectedSats,
        receivedSats: funding.confirmedSats,
      };
    }

    if (txid) usedTxids.add(txid);
    return { kind: "settled", txid };
  }

  if (action.kind === "mark-submitted") {
    /* Guarded on the status it was read at, so a settlement landing mid-flight
       is not walked backwards into submitted. */
    const result = await changeStatus(service, order.id, ["awaiting_payment"], {
      status: "submitted",
      submitted_at: new Date(now).toISOString(),
    });

    return result.ok ? { kind: "submitted" } : { kind: "failed", action: "mark-submitted", why: result.why };
  }

  if (action.kind === "expire") {
    const result = await changeStatus(service, order.id, ["awaiting_payment", "submitted"], {
      status: "expired",
      failure_reason: "The quoted rate expired before payment.",
    });

    return result.ok ? { kind: "expired" } : { kind: "failed", action: "expire", why: result.why };
  }

  return {
    kind: "stranded",
    reason: action.reason,
    expectedSats,
    receivedSats: funding.confirmedSats,
  };
}
