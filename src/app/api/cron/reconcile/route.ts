import { NextResponse } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addressFunding, btcToSats, fundingTxid } from "@/lib/chain-watch";
import { isOperatorAlertConfigured, sendOperatorAlert } from "@/lib/operator-alert";
import { RECONCILE_SERVICE, recordHeartbeat } from "@/lib/heartbeat";
import { decideOrder } from "@/lib/reconcile-decision";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* The sweep that means nobody has to watch.
 *
 * ── What it is for ─────────────────────────────────────────────────────────
 *
 * Every other path to settlement waits to be told: BTCPay calls back, or a
 * person runs `npm run settle`. Both can stop happening without anything
 * saying so, and when they do the money still arrives — a customer's payment
 * sits confirmed on the chain while their order sits awaiting_payment and
 * their account holds nothing.
 *
 * This asks instead of waiting. It reads the open orders, reads the chain, and
 * settles the ones that were paid. It needs no processor, no callback and no
 * shared secret with anybody: the two things it depends on are the order rows,
 * which are ours, and a public ledger, which is everyone's.
 *
 * That makes it a floor rather than a replacement. When BTCPay is healthy its
 * callback still settles orders within a confirmation, and this finds nothing
 * to do. When BTCPay is gone, or its host was wiped, or its webhook was
 * misconfigured for a week, this is what pays the customers anyway — late,
 * which is survivable, instead of never, which is not.
 *
 * ── Why it is safe to run every minute ─────────────────────────────────────
 *
 * settle_crypto_payment is idempotent and holds every rule about what a
 * payment grants. This decides one thing only — whether an order was paid —
 * and a second delivery of the same answer changes nothing. Two sweeps
 * overlapping, or a sweep racing the webhook, both end with one payout.
 *
 * ── Failing closed ─────────────────────────────────────────────────────────
 *
 * Every uncertainty here resolves towards leaving the order alone:
 *
 *   no answer from the chain  → touch nothing, try again next minute;
 *   less received than asked  → do not settle, and tell a person;
 *   expired but funded        → do not expire, and tell a person.
 *
 * An order left open is a person looking at it. An order wrongly expired is a
 * customer who paid and was told they did not.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* How long a stranded order waits before it is reported again. It is the same
   order every minute until somebody deals with it, and an alert that arrives
   1,440 times a day is an alert nobody reads. */
const REALERT_AFTER_MS = 24 * 60 * 60 * 1000;

/* A ceiling on one sweep. Far past any plausible backlog, and it keeps a run
   bounded no matter what the table holds. */
const MAX_ORDERS_PER_SWEEP = 200;

type OpenOrder = {
  id: string;
  status: string;
  address: string;
  crypto_amount: number;
  amount_usd: number;
  currency: string;
  lightning: boolean;
  expires_at: string;
  alerted_at: string | null;
  shared_address: boolean;
};

/**
 * Whether the caller is allowed to run a sweep.
 *
 * Not a public endpoint: it reads every open order and moves money into
 * accounts. Vercel's scheduler sends `Authorization: Bearer $CRON_SECRET`
 * automatically, and anything else scheduling this — n8n, a laptop, curl —
 * sends the same header, so there is one shape to get right rather than two.
 *
 * With no secret set it refuses rather than opening. A cron endpoint that is
 * public whenever a variable is missing is a cron endpoint that is public.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get("authorization")?.trim() ?? "";
  const sent = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header;

  /* Lengths differ freely here and the comparison is on a value the caller
     supplied, so a plain !== leaks only what the caller already knows. */
  return sent.length > 0 && sent === secret;
}

/* A status change, and whether it actually happened.
 *
 * Split out because the first version of this sweep did not ask. It counted
 * the changes it had DECIDED on, reported five orders expired, and five orders
 * sat untouched in the database — an unchecked error and a matched-nothing
 * update are indistinguishable from a success when nobody looks at the result,
 * and a sweep whose whole purpose is to notice things nobody is watching must
 * not be the thing nobody is watching.
 *
 * `.select("id")` is what makes the three cases separable: PostgREST returns
 * the rows it changed, so zero rows back is a filter that matched nothing
 * rather than a write that failed, and the two want different fixes.
 */
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
    /* No error and nothing changed. Something else moved the row between the
       read and the write, or the write was silently filtered. Either way it is
       not the success the counter would otherwise have claimed. */
    return { ok: false, why: `no row matched id=${id} in status ${from.join("/")}` };
  }

  return { ok: true };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const service = createSupabaseServiceClient();

  if (!service) {
    return NextResponse.json(
      { error: "Reconciliation needs the service key." },
      { status: 503 },
    );
  }

  const { data, error } = await service
    .from("crypto_payments")
    .select(
      "id, status, address, crypto_amount, amount_usd, currency, lightning, expires_at, alerted_at, shared_address",
    )
    /* On-chain BTC only. Lightning carries its own proof of payment and no
       address to read, and the other coins are not watched here yet. */
    .eq("currency", "btc")
    .eq("lightning", false)
    .in("status", ["awaiting_payment", "submitted"])
    .order("created_at", { ascending: true })
    .limit(MAX_ORDERS_PER_SWEEP);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("reconcile: could not read the open orders:", error);
    return NextResponse.json({ error: "Could not read the open orders." }, { status: 500 });
  }

  const orders = (data ?? []) as OpenOrder[];
  const now = Date.now();

  let settled = 0;
  let seen = 0;
  let expired = 0;
  let unreadable = 0;
  const stranded: { id: string; reason: string; expectedSats: number; receivedSats: number }[] = [];
  /* Writes this sweep meant to make and could not. Never empty silently: an
     unreported failed write is the whole reason this field exists. */
  const failures: { id: string; action: string; why: string }[] = [];

  /* Transactions already credited to something. Only shared addresses need
     this: there the amount identifies the order, and amounts are unique among
     OPEN orders rather than across all history — so a payment that settled a
     $25 order last month would match the next $25 order asking for the same
     nudged figure. Read once for the whole sweep. */
  const { data: spent } = await service
    .from("crypto_payments")
    .select("tx_reference")
    .eq("status", "confirmed")
    .not("tx_reference", "is", null);

  const usedTxids = new Set(
    (spent ?? [])
      .map((row) => (row as { tx_reference: string | null }).tx_reference)
      .filter((id): id is string => typeof id === "string"),
  );

  for (const order of orders) {
    const funding = await addressFunding(order.address);

    /* Nobody answered. Not zero — unknown. Counted so a sweep that is not
       actually watching anything shows up as a number rather than as silence. */
    if (!funding) {
      unreadable += 1;
      continue;
    }

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

    if (action.kind === "leave") continue;

    if (action.kind === "settle") {
      /* The transaction the decision actually matched, where it could name one.
         On a shared address that is the payment carrying this order's exact
         amount — which is also what keeps it from being counted twice, since
         the next sweep reads it back as spent. */
      const txid = action.txid ?? (await fundingTxid(order.address));

      const { error: settleError } = await service.rpc("settle_crypto_payment", {
        p_payment_id: order.id,
        p_tx_reference: txid,
      });

      if (settleError) {
        // eslint-disable-next-line no-console
        console.error("reconcile: settlement failed for", order.id, settleError);
        stranded.push({
          id: order.id,
          reason: "paid on chain, but settlement failed",
          expectedSats,
          receivedSats: funding.confirmedSats,
        });
        continue;
      }

      if (txid) usedTxids.add(txid);
      settled += 1;
      continue;
    }

    if (action.kind === "mark-submitted") {
      /* Guarded on the status it was read at, so a webhook that settled this
         order mid-sweep is not walked backwards into submitted. */
      const result = await changeStatus(service, order.id, ["awaiting_payment"], {
        status: "submitted",
        submitted_at: new Date().toISOString(),
      });

      if (result.ok) seen += 1;
      else failures.push({ id: order.id, action: "mark-submitted", why: result.why });

      continue;
    }

    if (action.kind === "expire") {
      const result = await changeStatus(
        service,
        order.id,
        ["awaiting_payment", "submitted"],
        { status: "expired" },
      );

      if (result.ok) expired += 1;
      else failures.push({ id: order.id, action: "expire", why: result.why });

      continue;
    }

    stranded.push({
      id: order.id,
      reason: action.reason,
      expectedSats,
      receivedSats: funding.confirmedSats,
    });
  }

  /* Tell a person, at most once a day per order. */
  const toAlert = stranded.filter((item) => {
    const order = orders.find((candidate) => candidate.id === item.id);
    if (!order?.alerted_at) return true;
    return now - new Date(order.alerted_at).getTime() > REALERT_AFTER_MS;
  });

  if (toAlert.length > 0) {
    const lines = toAlert.map(
      (item) =>
        `• ${item.id}\n  ${item.reason}\n  expected ${item.expectedSats} sats, received ${item.receivedSats} sats`,
    );

    const delivered = await sendOperatorAlert(
      `${toAlert.length} crypto payment${toAlert.length === 1 ? "" : "s"} need a look`,
      `These orders have coin on their address that could not be settled automatically.\n\n${lines.join("\n\n")}\n\nSettle one by hand with: npm run settle -- <payment id>\n`,
    );

    /* Marked whether or not the email got through. A failed send is already in
       the log and in this response; re-sending it every minute would bury the
       next real one. */
    void delivered;

    const { error: markError } = await service
      .from("crypto_payments")
      .update({ alerted_at: new Date().toISOString() })
      .in("id", toAlert.map((item) => item.id));

    if (markError) {
      /* Not fatal — the alert went out, and the worst case is sending it again
         tomorrow. Still reported: a mark that never lands turns a daily
         reminder into a per-sweep one, which is how an inbox learns to ignore
         it. */
      // eslint-disable-next-line no-console
      console.error("reconcile: could not record the alert:", markError);
      failures.push({ id: "(alert marks)", action: "record-alert", why: markError.message });
    }
  }

  const summary = {
    checked: orders.length,
    settled,
    seen,
    expired,
    /* Chain hosts that did not answer this run. Persistently non-zero means
       the sweep is not actually watching anything. */
    unreadable,
    stranded,
    /* Changes this sweep decided on and could not make. Anything here means the
       counters above are lower than the work that was due, and the reason is
       carried rather than logged out of reach. */
    failures,
    alertsConfigured: isOperatorAlertConfigured(),
  };

  /* Said out loud, so that a sweep which stops running stops being silent. See
     heartbeat.ts — this is the record /api/health reads to answer "is
     settlement still happening" without anybody opening the database. */
  await recordHeartbeat(service, RECONCILE_SERVICE, summary);

  return NextResponse.json(summary);
}
