import { NextResponse, after } from "next/server";

import { runVerification } from "@/lib/builder/verify-run";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Runs a web app's test (lib/builder/verify-run.ts) in a time budget of its
 * own. Called by the save route once a build with sign-in has landed, and by
 * the daily backstop for a check that never finished. Answers at once; the
 * test runs after the response. Server-to-server only: CRON_SECRET. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { verificationId?: unknown } | null;
  const id = typeof body?.verificationId === "string" ? body.verificationId : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "No check named." }, { status: 400 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "No service key." }, { status: 503 });
  after(async () => {
    try {
      await runVerification(service, id);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`verify: ${id} failed to run:`, error);
    }
  });
  return NextResponse.json({ started: true }, { status: 202 });
}
