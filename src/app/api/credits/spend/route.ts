import { NextResponse } from "next/server";

import {
  CREDIT_ACTIONS,
  creditCostOf,
  type CreditActionId,
  type UsageSignal,
} from "@/app/dashboard/credits";
import { EDIT_MODEL } from "@/lib/builder/edit";
import { isPublishedStatus } from "@/lib/project-status";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Where a charge is actually taken.
 *
 * The browser says what happened — an action, and the usage it produced — and
 * never what it costs. Pricing runs here with the same creditCostOf the
 * composer previews with, and the deduction runs inside the database in one
 * locked transaction, so two requests racing cannot both spend the last credit.
 *
 * The client is not trusted with the cost, but it is not trusted with the usage
 * either: a caller could understate its own token count.
 *
 * Generation now runs server-side, in /api/build, which prices a build from
 * what the orchestrator reports and charges it there. So "generate" is refused
 * here: it was the action worth under-reporting, and it no longer has any
 * reason to arrive from a browser.
 *
 * What is left is chat, whose band tops out at a single credit; runtime, which
 * is free; and publish.
 *
 * Publish is the one that needs care. It is the largest charge on the platform,
 * and it is fifty times cheaper for a project that is already live — so
 * "alreadyPublished" is a signal a caller has every reason to assert and no
 * right to. It is read from the project's stored status here, under the
 * caller's own session, and whatever arrived in the body is discarded. */

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

/* Actions a browser may still price for itself. Deliberately excludes
   "generate": that is charged by /api/build from the build's own report. */
const CLIENT_PRICED_ACTIONS: CreditActionId[] = ["chat", "publish", "runtime"];

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

  if (!CLIENT_PRICED_ACTIONS.includes(body.action)) {
    return NextResponse.json(
      {
        error: `"${body.action}" is charged where the work happens, not from the browser. Builds go through /api/build.`,
        code: "server_priced_action",
      },
      { status: 403 },
    );
  }

  const outputTokens = readCount(body.outputTokens);
  const filesTouched = readCount(body.filesTouched);
  const projectId = typeof body.projectId === "string" ? body.projectId : null;

  /* A publish is priced from the project's stored status, never from the body.
     Read under the caller's own session, so RLS answers it: a project id that
     is not theirs comes back empty and is refused rather than priced. */
  let alreadyPublished = false;
  if (body.action === "publish") {
    if (!projectId) {
      return NextResponse.json(
        { error: "A publish needs a project to belong to." },
        { status: 400 },
      );
    }

    const { data: project, error: lookupError } = await supabase
      .from("projects")
      .select("id, status")
      .eq("id", projectId)
      .maybeSingle();

    if (lookupError) {
      // eslint-disable-next-line no-console
      console.error("spend: could not read the project:", lookupError);
      return NextResponse.json({ error: "Could not read that project." }, { status: 500 });
    }
    if (!project) {
      return NextResponse.json({ error: "That app is not in your account." }, { status: 404 });
    }

    alreadyPublished = isPublishedStatus(project.status);
  }

  /* EDIT_MODEL rather than anything the caller sent. A model id is worth money
     now, and this route's whole premise is that the browser is not trusted with
     the cost — taking a model id from it would hand back exactly the lever that
     premise removes. Chat is the only priced action that reaches here; publish
     is flat and unscaled. */
  const cost = creditCostOf(body.action, {
    outputTokens,
    filesTouched,
    alreadyPublished,
    modelId: EDIT_MODEL,
  });

  const { data, error } = await supabase.rpc("spend_credits", {
    p_action: body.action,
    p_cost: cost,
    p_description: typeof body.description === "string" ? body.description.slice(0, 200) : null,
    p_project_id: projectId,
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
