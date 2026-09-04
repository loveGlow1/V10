/* What to do about one open order, given what the chain says about it.
 *
 * Pulled out of the sweep route and made pure, because this is the part where
 * being wrong costs money in both directions: settle an order nobody paid and
 * credits are given away; expire an order somebody did pay and a customer is
 * told their money never arrived. Neither is a thing to discover in production.
 *
 * Everything here fails towards "leave it alone and tell a person". An order
 * left open is somebody looking at it, which is recoverable. An order wrongly
 * closed is a support conversation that starts with the customer being right.
 */

import type { AddressFunding } from "./chain-watch";

export type ReconcileAction =
  /** Paid, in a block, in full. The only action that grants anything. */
  | { kind: "settle" }
  /** Coin is in the mempool. Not settled — but not nothing, either. */
  | { kind: "mark-submitted" }
  /** The quote ran out and nobody paid. The ordinary end of an order. */
  | { kind: "expire" }
  /** Coin on the address that does not settle the order. Needs a person. */
  | { kind: "strand"; reason: string }
  /** Still live, or unknowable. Touch nothing. */
  | { kind: "leave" };

export type ReconcileOrder = {
  status: string;
  /** What the order asks for, in satoshis. */
  expectedSats: number;
  /** When the rate lock runs out. */
  expiresAt: number;
};

/**
 * `funding` is null when no chain host answered.
 *
 * That is the case worth naming separately, because the obvious reading of it
 * is the dangerous one: an unanswered query looks exactly like an address that
 * has received nothing, and treating it that way expires paid orders every time
 * a block explorer has a bad minute.
 */
export function decideOrder(
  order: ReconcileOrder,
  funding: AddressFunding | null,
  now: number,
): ReconcileAction {
  if (!funding) return { kind: "leave" };

  /* An order asking for nothing cannot be satisfied by a payment, and treating
     0 >= 0 as paid would settle every one of them. It should not be possible —
     the table checks crypto_amount > 0 — so it is a person's problem, not a
     silent skip. */
  if (order.expectedSats <= 0) {
    return { kind: "strand", reason: "the order asks for no coin at all" };
  }

  if (funding.confirmedSats >= order.expectedSats) return { kind: "settle" };

  const expired = order.expiresAt < now;

  /* Seen in the mempool. Recorded while the order is still live; once it has
     expired, an unconfirmed payment is a person's problem instead — the rate it
     was quoted at is gone. */
  if (!expired && order.status === "awaiting_payment" && funding.pendingSats > 0) {
    return { kind: "mark-submitted" };
  }

  if (!expired) return { kind: "leave" };

  if (funding.confirmedSats === 0 && funding.pendingSats === 0) return { kind: "expire" };

  return {
    kind: "strand",
    reason:
      funding.confirmedSats > 0
        ? "expired with a confirmed payment that does not cover the order"
        : "expired with an unconfirmed payment on the address",
  };
}
