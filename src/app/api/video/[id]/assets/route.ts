/* A video's uploads — its own clips, sound and pictures.
 *
 *   POST   { path, name, mime, size, durationS?, width?, height?, role? }
 *          registers a file uploaded through ./upload-url: the stored
 *          object's own content type decides its kind (the browser's word is
 *          not taken), the row is filed as processing, and its preparation
 *          (probe, working copy, poster) is started in its own route
 *   DELETE ?asset=<id>
 *          removes the upload and every file made from it
 *
 * Under the owner's session; RLS scopes every row. */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { assetKind, uploadProblem } from "@/lib/video/assets";
import { falToken } from "@/lib/video/fal";

import { videoSession } from "../../shared";

/* A picture can stand for the product, the person or the source photo. */
const ROLES = ["product", "person", "photo", "reference"] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const path = typeof body.path === "string" ? body.path : "";
  if (!path.startsWith(`${userId}/${id}/uploads/`) || path.includes("..")) return NextResponse.json({ error: "Not an upload of this video." }, { status: 400 });

  const { data: video } = await supabase.from("video_projects").select("id").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  /* The stored object says what it is. */
  const service = createSupabaseServiceClient() ?? supabase;
  const folder = path.replace(/\/[^/]+$/, "");
  const file = path.slice(folder.length + 1);
  const { data: listed } = await service.storage.from("video-assets").list(folder, { search: file, limit: 5 });
  const object = (listed ?? []).find((entry) => entry.name === file);
  if (!object) return NextResponse.json({ error: "The upload did not arrive. Try again." }, { status: 400 });
  const meta = (object.metadata ?? {}) as { mimetype?: string; size?: number };
  const mime = String(meta.mimetype || body.mime || "");
  const size = Number(meta.size) || Number(body.size) || 0;
  const problem = uploadProblem({ mime, size, durationS: Number(body.durationS) || null });
  if (problem) {
    await service.storage.from("video-assets").remove([path]);
    return NextResponse.json({ error: problem }, { status: 400 });
  }
  const kind = assetKind(mime);
  const role = ROLES.find((r) => r === body.role);
  const number = (value: unknown) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

  const { data: row, error } = await supabase
    .from("video_assets")
    .insert({
      video_id: id,
      user_id: userId,
      kind: kind === "image" && role ? role : kind,
      storage_path: path,
      mime: mime.slice(0, 100),
      name: (typeof body.name === "string" ? body.name : "").slice(0, 200),
      source: "upload",
      status: "processing",
      size_bytes: size,
      duration_s: number(body.durationS),
      width: number(body.width) ? Math.round(Number(body.width)) : null,
      height: number(body.height) ? Math.round(Number(body.height)) : null,
    })
    .select("id")
    .single();
  if (error || !row) return NextResponse.json({ error: "The upload could not be saved." }, { status: 500 });

  /* Prepared in a route of its own, with its own time budget. */
  const origin = new URL(request.url).origin;
  const started = await fetch(`${origin}/api/video/${id}/assets/prepare?asset=${row.id}&t=${falToken(id, 0, `asset:${row.id}`)}`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => null);
  if (!started?.ok) {
    /* Usable as uploaded, with what the browser measured. */
    await supabase.from("video_assets").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", row.id);
  }
  return NextResponse.json({ id: row.id, kind });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase } = session;
  const assetId = new URL(request.url).searchParams.get("asset") ?? "";
  const { data: asset } = await supabase
    .from("video_assets")
    .select("id, kind, storage_path, working_path, poster_path")
    .eq("id", assetId)
    .eq("video_id", id)
    .maybeSingle();
  if (!asset || asset.kind === "render") return NextResponse.json({ error: "No such upload." }, { status: 404 });
  const files = [asset.storage_path, asset.working_path, asset.poster_path].filter((p, i, all): p is string => typeof p === "string" && Boolean(p) && all.indexOf(p) === i);
  await supabase.storage.from("video-assets").remove(files);
  await supabase.from("video_assets").delete().eq("id", asset.id);
  return NextResponse.json({ ok: true });
}
