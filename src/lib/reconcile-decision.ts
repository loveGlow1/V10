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
  /** Paid, in a block, in full. The only action that grants anything.
   *  Carries the transaction that paid it where one could be identified. */
  | { kind: "settle"; txid: string | null }
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
  /* Whether this order's address is shared with other orders, which decides
     how the chain is read for it and is not a detail.

     A DEDICATED address — one BTCPay derived for this invoice alone — can be
     judged by its total, because nothing else will ever pay it. Received at
     least what was asked, and the order is paid.

     A SHARED address cannot. Its total is every order that ever used it added
     together, so judging one order against it settles that order the moment
     anybody has ever paid the address — including orders nobody paid, and
     including every future order the instant one real payment lands. On a
     shared address the AMOUNT is the identifier, which is the entire reason the
     create route nudges amounts apart, and matching has to be exact. */
  sharedAddress: boolean;
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
  /* Transactions already credited to some other order. Only meaningful on a
     shared address, where an old payment of the same amount would otherwise
     match a new order asking for it again — the amounts are unique among OPEN
     orders, not across history. */
  usedTxids: ReadonlySet<string> = new Set(),
): ReconcileAction {
  if (!funding) return { kind: "leave" };

  /* An order asking for nothing cannot be satisfied by a payment, and treating
     0 >= 0 as paid would settle every one of them. It should not be possible —
     the table checks crypto_amount > 0 — so it is a person's problem, not a
     silent skip. */
  if (order.expectedSats <= 0) {
    return { kind: "strand", reason: "the order asks for no coin at all" };
  }

  /* The two readings of "was this paid", per sharedAddress above. */
  const mine = order.sharedAddress
    ? funding.payments.filter((p) => p.sats === order.expectedSats && !usedTxids.has(p.txid))
    : funding.payments;

  const paid = order.sharedAddress
    ? mine.some((p) => p.confirmed)
    : funding.confirmedSats >= order.expectedSats;

  if (paid) return { kind: "settle", txid: mine.find((p) => p.confirmed)?.txid ?? null };

  const incoming = order.sharedAddress
    ? mine.some((p) => !p.confirmed)
    : funding.pendingSats > 0;

  const expired = order.expiresAt < now;

  /* Seen in the mempool. Recorded while the order is still live; once it has
     expired, an unconfirmed payment is a person's problem instead — the rate it
     was quoted at is gone. */
  if (!expired && order.status === "awaiting_payment" && incoming) {
    return { kind: "mark-submitted" };
  }

  if (!expired) return { kind: "leave" };

  /* Nothing for THIS order. On a shared address that is the honest reading even
     when the address holds a fortune: none of it was sent against this order's
     amount, so none of it is this order's. */
  const anything = order.sharedAddress
    ? mine.length > 0
    : funding.confirmedSats > 0 || funding.pendingSats > 0;

  if (!anything) return { kind: "expire" };

  return {
    kind: "strand",
    reason: order.sharedAddress
      ? "expired with a payment of its exact amount that could not be settled"
      : funding.confirmedSats > 0
        ? "expired with a confirmed payment that does not cover the order"
        : "expired with an unconfirmed payment on the address",
  };
}
