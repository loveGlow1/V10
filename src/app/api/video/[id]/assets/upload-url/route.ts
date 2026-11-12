/* A one-time address to upload one file of a video to — straight from the
 * browser into the private video-assets bucket, so a 400 MB clip never goes
 * through a function body (Vercel stops request bodies at 4.5 MB).
 *
 *   POST { name, mime, size, durationS? } → { path, token, signedUrl }
 *
 * The kind and the limits are checked here before any address is made, and
 * again from the stored object when the upload is registered (../route.ts).
 * The path is always <owner>/<video>/uploads/<uuid>.<ext>. */

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { MAX_UPLOADS, assetKind, extensionFor, uploadProblem } from "@/lib/video/assets";
import { currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { creditsLabel, prepareCredits } from "@/lib/video/pricing";

import { videoSession } from "../../../shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;

  const body = ((await request.json().catch(() => null)) ?? {}) as { name?: unknown; mime?: unknown; size?: unknown; durationS?: unknown };
  const name = typeof body.name === "string" ? body.name.slice(0, 200) : "upload";
  const mime = typeof body.mime === "string" ? body.mime.slice(0, 100) : "";
  const size = Number(body.size) || 0;
  const durationS = Number(body.durationS) || null;
  const problem = uploadProblem({ mime, size, durationS });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { data: video } = await supabase.from("video_projects").select("id").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });
  const { count } = await supabase.from("video_assets").select("id", { count: "exact", head: true }).eq("video_id", id).neq("kind", "render");
  if ((count ?? 0) >= MAX_UPLOADS) return NextResponse.json({ error: `A video can hold ${MAX_UPLOADS} uploads. Remove one first.` }, { status: 400 });

  /* Preparing it is work: it must be covered before it is sent. */
  const service = createSupabaseServiceClient();
  const balance = service ? await currentBalance(service, userId) : null;
  const price = prepareCredits(assetKind(mime));
  if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < price) {
    return NextResponse.json({ error: `Preparing this upload needs ${creditsLabel(price)}. Top up to upload.` }, { status: 402 });
  }

  const path = `${userId}/${id}/uploads/${randomUUID()}.${extensionFor(mime, name)}`;
  const { data, error } = await supabase.storage.from("video-assets").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Could not prepare the upload. Try again." }, { status: 500 });
  return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
}
