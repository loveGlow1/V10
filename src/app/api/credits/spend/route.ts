import { NextResponse } from "next/server";

import {
  CREDIT_ACTIONS,
  creditCostOf,
  type CreditActionId,
  type UsageSignal,
} from "@/app/dashboard/credits";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Where a charge is actually taken.
 *
 * The browser says what happened — an action, and the usage it produced — and
 * never what it costs. Pricing runs here with the same creditCostOf the
 * composer previews with, and the deduction runs inside the database in one
 * locked transaction, so two requests racing cannot both spend the last credit.
 *
 * The client is not trusted with the cost, but it is not trusted with the usage
 * either: a caller could understate its own token count. That is only closed
 * once generation runs server-side too (roadmap phase 1), at which point this
 * route's caller becomes the generation handler rather than the page, and the
 * usage comes off the model response instead of the request body. The shape
 * here does not change when that happens. */

export const runtime = "nodejs";
/* Charges must never be served from a cache. */
export const dynamic = "force-dynamic";

type SpendRequest = {
  action: CreditActionId;
  description?: string;
  projectId?: string;
} & UsageSignal;

function isCreditAction(value: unknown): value is CreditActionId {
  return typeof value === "string" && value in CREDIT_ACTIONS;
}

/** A non-negative integer, or undefined for anything else a caller sends. */
function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Credits are unavailable because Supabase is not configured." },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to spend credits." }, { status: 401 });
  }

  let body: SpendRequest;
  try {
    body = (await request.json()) as SpendRequest;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!isCreditAction(body?.action)) {
    return NextResponse.json(
      { error: `Unknown action. Expected one of: ${Object.keys(CREDIT_ACTIONS).join(", ")}.` },
      { status: 400 },
    );
  }

  const outputTokens = readCount(body.outputTokens);
  const filesTouched = readCount(body.filesTouched);
  const cost = creditCostOf(body.action, { outputTokens, filesTouched });

  const { data, error } = await supabase.rpc("spend_credits", {
    p_action: body.action,
    p_cost: cost,
    p_description: typeof body.description === "string" ? body.description.slice(0, 200) : null,
    p_project_id: typeof body.projectId === "string" ? body.projectId : null,
    p_output_tokens: outputTokens ?? null,
    p_files_touched: filesTouched ?? null,
  });

  if (error) {
    /* 53400 is the configuration_limit_exceeded the function raises when the
       pool cannot cover the charge. It is the one failure the user can act on —
       top up or upgrade — so it gets its own status rather than a generic 500. */
    if (error.code === "53400") {
      return NextResponse.json(
        { error: "Not enough credits for this action.", cost, code: "insufficient_credits" },
        { status: 402 },
      );
    }

    // eslint-disable-next-line no-console
    console.error("spend_credits failed:", error);
    return NextResponse.json({ error: "Could not record the charge." }, { status: 500 });
  }

  /* The row the function returns is the balance after the charge, so the caller
     never has to re-read it. */
  const balance = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    cost,
    balance: {
      planId: balance?.plan_id,
      daily: Number(balance?.daily ?? 0),
      rollover: Number(balance?.rollover ?? 0),
      monthly: Number(balance?.monthly ?? 0),
      topUp: Number(balance?.top_up ?? 0),
    },
  });
}
