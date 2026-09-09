import { NextResponse } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RECONCILABLE_COLUMNS,
  loadUsedTxids,
  reconcileOrder,
  type ReconcilableOrder,
} from "@/lib/reconcile-order";
import {
  alertOncePerDay,
  isOperatorAlertConfigured,
  sendOperatorAlert,
} from "@/lib/operator-alert";
import { RECONCILE_SERVICE, recordHeartbeat } from "@/lib/heartbeat";
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
    .select(RECONCILABLE_COLUMNS)
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

  const orders = (data ?? []) as ReconcilableOrder[];
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
  const usedTxids = await loadUsedTxids(service);

  for (const order of orders) {
    const outcome = await reconcileOrder(service, order, usedTxids, now);

    if (outcome.kind === "unreadable") unreadable += 1;
    else if (outcome.kind === "settled") settled += 1;
    else if (outcome.kind === "submitted") seen += 1;
    else if (outcome.kind === "expired") expired += 1;
    else if (outcome.kind === "stranded") {
      stranded.push({
        id: order.id,
        reason: outcome.reason,
        expectedSats: outcome.expectedSats,
        receivedSats: outcome.receivedSats,
      });
    } else if (outcome.kind === "failed") {
      failures.push({ id: order.id, action: outcome.action, why: outcome.why });
    }
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
  const { gapMs, clockMissing } = await recordHeartbeat(service, RECONCILE_SERVICE, summary);

  /* ── Two things that were reported and never told to anybody ──────────────

     Both of these were already visible before this: failures came back in this
     response, and a dead clock showed as a widening gap in a timestamp. Both
     were visible in the way everything that broke today was visible — to
     somebody who went and looked. Nothing looks. */

  if (failures.length > 0) {
    /* The sweep decided something and could not carry it out. This is the exact
       shape of the morning's bug — updates that reported success and changed
       nothing — and until now the report went into a response that whichever
       clock called it simply discarded. */
    await alertOncePerDay(
      service,
      "sweep-failures",
      `Reconciliation sweep could not write ${failures.length} change${failures.length === 1 ? "" : "s"}`,
      `The sweep decided on changes it could not make. Orders may be paid and uncredited.\n\n`
        + failures.map((f) => `• ${f.id}\n  ${f.action}: ${f.why}`).join("\n\n")
        + `\n\nCheck /api/health for reconcileStale, and the app logs for the underlying error.\n`,
    );
  }

  if (clockMissing) {
    /* A stopped scheduler cannot report itself, so the surviving one does it.
       This only fires while at least one clock still runs — which is precisely
       the case that produces no other symptom, because the survivor quietly
       covers for the dead one and nothing looks wrong from outside. */
    const minutes = gapMs === null ? "?" : Math.round(gapMs / 60_000);

    await alertOncePerDay(
      service,
      "clock-gap",
      "A payment sweep scheduler has stopped",
      `The last sweep was ${minutes} minutes ago. Two schedulers call this — pg_cron `
        + `every 15 minutes and n8n every 30 — so a gap this large means one has stopped `
        + `firing.\n\nNothing is broken yet: the surviving clock is covering, which is why `
        + `there is no other symptom. But there is no redundancy left, and if it stops too, `
        + `Bitcoin checkout closes after two hours.\n\n`
        + `pg_cron:  select status, start_time from cron.job_run_details\n`
        + `          where jobname = 'reconcile-crypto-payments' order by start_time desc limit 5;\n`
        + `n8n:      the Executions tab on "Payment Reconciliation Sweep"\n`,
    );
  }

  return NextResponse.json({
    ...summary,
    /* Minutes since the previous sweep, and whether that gap says a scheduler
       has stopped. Reported alongside the counters because a sweep that is
       running alone is worth seeing even when it had nothing to do. */
    minutesSinceLastSweep: gapMs === null ? null : Math.round(gapMs / 60_000),
    clockMissing,
  });
}
