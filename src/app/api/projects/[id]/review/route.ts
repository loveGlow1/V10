import { NextResponse } from "next/server";

import { reviewDue } from "@/lib/builder/review-round";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";

/* Whether the project's newest build is due its automatic review round.
 *
 *   GET   { due, findings }   read-only; the round itself is asked for through
 *                             /api/build with { review: "latest" }, which checks
 *                             again and claims it. See lib/builder/review-round.ts. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ due: false, findings: 0 });
  const due = await reviewDue(service, owned.projectId);
  return NextResponse.json(
    due.due ? { due: true, findings: due.findings.length } : { due: false, findings: 0, reason: due.reason },
    { headers: { "Cache-Control": "no-store" } },
  );
}
