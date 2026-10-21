/* The project's terminal: the sandbox its shells run in.
 *
 * POST    open (or resume) it and get a URL to connect the terminal to — a
 *         fresh, short-lived token every time, so a reconnect asks again.
 *         ?sync=1 also writes the project's current files into it.
 * PATCH   keep it from pausing while somebody is working.
 * DELETE  end it: every shell and process, for a fresh start.
 *
 * Owner-only, under the caller's own session. What goes into the sandbox is
 * the project's own files and the public half of its environment; the
 * platform's keys never do. See lib/terminal/sandbox.ts. */

import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import { envFor, resolveBackend } from "@/lib/builder/backend/connection";
import { currentTree } from "@/lib/builder/store-tree";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { endSession, keepAlive, openSession, terminalConfigured } from "@/lib/terminal/sandbox";

import { ownedProject } from "../backend/owned";
import { refuseWithoutCard } from "@/lib/card-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UNCONFIGURED = NextResponse.json(
  { error: "The terminal isn't set up on this deployment yet (E2B_API_KEY).", unconfigured: true },
  { status: 503 },
);

/* A sandbox provider that says the account is full or busy, said plainly. */
function failure(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/rate limit|quota|limit|concurrent|402|429/i.test(text)) {
    return NextResponse.json(
      { error: "Terminal capacity reached on the hosting account. Please try again later or contact support.", code: "QUOTA_REACHED" },
      { status: 409 },
    );
  }
  console.error("[terminal]", text);
  return NextResponse.json({ error: "The terminal could not start. Try again in a moment." }, { status: 502 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;
  /* A sandbox is paid for by the minute: no card, no service, for an account
     that has never paid. */
  const noCard = await refuseWithoutCard(createSupabaseServiceClient(), owned.userId);
  if (noCard) return noCard;

  /* Development only: a bridge running on this machine instead of a sandbox
     (python3 bridge.py with QS_BRIDGE_KEY), so the terminal can be worked on
     without an E2B account. Never in production. */
  const devBridge = process.env.NODE_ENV !== "production" ? process.env.TERMINAL_DEV_BRIDGE_URL : undefined;
  if (devBridge) {
    const exp = String(Math.floor(Date.now() / 1000) + 60);
    const token = createHmac("sha256", process.env.TERMINAL_DEV_BRIDGE_KEY ?? "").update(exp).digest("hex");
    return NextResponse.json({ sandboxId: "dev", url: `${devBridge}/?exp=${exp}&token=${token}`, portUrl: "http://localhost:{port}", created: false });
  }

  if (!terminalConfigured()) return UNCONFIGURED.clone();

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });

  const sync = new URL(request.url).searchParams.get("sync") === "1";
  const [current, backend] = await Promise.all([
    currentTree(service, owned.projectId),
    resolveBackend(service, owned.projectId),
  ]);
  /* NEXT_PUBLIC_ values only: what any visitor of the built site is sent anyway. */
  const env = backend && backend.mode !== "none" && backend.url && backend.anonKey ? envFor(backend) : {};

  try {
    const session = await openSession({
      projectId: owned.projectId,
      userId: owned.userId,
      files: current.sourceMissing ? [] : current.tree,
      env,
      sync,
    });
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;
  if (!terminalConfigured()) return UNCONFIGURED.clone();
  try {
    const alive = await keepAlive(owned.projectId, owned.userId);
    return NextResponse.json({ alive }, { status: alive ? 200 : 404 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;
  if (!terminalConfigured()) return UNCONFIGURED.clone();
  try {
    await endSession(owned.projectId, owned.userId);
    return NextResponse.json({ ended: true });
  } catch (error) {
    return failure(error);
  }
}
