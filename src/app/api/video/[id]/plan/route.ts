/* The Creative Director's production plan — Steps 3 and 4, and every
 * revision after.
 *
 *   {}               plan it (first time) or plan it again
 *   { note }         revise the current plan: "make the hook funnier"
 *   { plan }         a person's own edits to the scenes, checked and kept
 *
 * Every result is a new numbered version; nothing is overwritten. A model
 * plan costs one credit, charged after it is delivered; saving your own edits
 * is free. Each plan passes the shared QA and repair (lib/video/plan.ts)
 * before it is stored. */

import { planVideo } from "@/lib/video/plan-video";

import { videoSession } from "../../shared";
import { refuseWithoutCard } from "@/lib/card-gate";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* The Creative Director writes a whole production plan in one call. */
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  /* Planning runs the director and is charged: no card, no service, for an
     account that has never paid. */
  const noCard = await refuseWithoutCard(createSupabaseServiceClient(), userId);
  if (noCard) return noCard;
  const body = ((await request.json().catch(() => null)) ?? {}) as { note?: unknown; plan?: unknown };
  return planVideo(supabase, userId, id, body);
}
