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
import { withStop } from "@/lib/ai/llm";
import { editVideo, setSound } from "@/lib/video/apply-edit";
import { soundCommand } from "@/lib/video/sound";

import { videoSession } from "../../shared";
import { refuseWithoutCard } from "@/lib/card-gate";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* The Creative Director writes a whole production plan in one call. */
export const maxDuration = 300;

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
  /* Stop in the studio aborts this request; every model call it makes stops
     with it, and nothing it would have saved or charged is. */
  return withStop(request.signal, () => respond(request, supabase, userId, id, body));
}

async function respond(
  request: Request,
  supabase: Awaited<ReturnType<typeof videoSession>> extends infer S ? (S extends { supabase: infer C } ? C : never) : never,
  userId: string,
  id: string,
  body: { note?: unknown; plan?: unknown },
): Promise<Response> {
  /* A video already made is edited, not planned again: only the part the
     message names changes (a line of on-screen text, one scene's look, the
     music), every other clip and voice line is reused as it is — same file,
     same face, no new charge — and only what changed is made. Null means it
     is not an edit (nothing made yet, or a different video): plan it. */
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note && body.plan === undefined) {
    const { data: owned } = await supabase.from("video_projects").select("id").eq("id", id).maybeSingle();
    const writer = createSupabaseServiceClient();
    if (owned && writer) {
      const origin = new URL(request.url).origin;
      const audio = soundCommand(note);
      const edited = audio
        ? await setSound({ writer, userId, videoId: id, audio, origin })
        : await editVideo({ writer, userId, videoId: id, instruction: note, origin, model: (body as { model?: unknown }).model });
      if (edited) {
        return edited.ok
          ? Response.json({ edited: true, message: edited.message })
          : Response.json({ error: edited.message }, { status: 422 });
      }
    }
  }
  return planVideo(supabase, userId, id, body);
}
