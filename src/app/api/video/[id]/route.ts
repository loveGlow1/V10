/* One video: the project, its latest plan, every version, its references,
   whether the engines its plan needs are connected, and the current render —
   each job's clip or voice line as a short-lived signed URL. See
   lib/video/state.ts. */

import { videoState } from "@/lib/video/state";

import { videoSession } from "../shared";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  return videoState(session.supabase, id, new URL(request.url).origin);
}
