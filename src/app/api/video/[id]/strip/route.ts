/* A clip's filmstrip for the timeline (lib/video/filmstrip.ts): `n` frames
 * along [a, a + d] seconds of the clip at `src`, side by side in one JPEG.
 *
 * Only for the person's own video, and only for a clip of that video: a
 * stored file under the video's own folder, or a link one of its scenes was
 * made at. Kept in storage once made; answered with the image itself, cached
 * by the browser. */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { frameArgs, rowArgs, storagePathOf, stripHeight, stripPath, stripTimes } from "@/lib/video/filmstrip";

export const maxDuration = 60;

const exec = promisify(execFile);

const image = (bytes: Buffer | Uint8Array) =>
  new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable" } });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const src = url.searchParams.get("src") ?? "";
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "No strip." }, { status: 404 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  /* Their own video only (row-level security). */
  const { data: video } = await supabase.from("video_projects").select("id, user_id").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });
  const service = createSupabaseServiceClient();
  if (!service || !ffmpegPath || !/^https:\/\//.test(src)) return NextResponse.json({ error: "No strip." }, { status: 404 });

  /* The clip must be this video's: a file in its folder, or a link it was made at. */
  const path = storagePathOf(src);
  let input: string | null = null;
  let source = "";
  if (path) {
    if (!path.startsWith(`${video.user_id}/${id}/`)) return NextResponse.json({ error: "Not this video's clip." }, { status: 403 });
    const { data } = await service.storage.from("video-assets").createSignedUrl(path, 600);
    input = data?.signedUrl ?? null;
    source = `storage:${path}`;
  } else {
    const plain = src.split("#")[0];
    const { data } = await service.from("video_renders").select("id").eq("video_id", id).eq("output_path", plain).limit(1);
    if (data?.length) {
      input = plain;
      source = plain;
    }
  }
  if (!input) return NextResponse.json({ error: "Not this video's clip." }, { status: 403 });

  const times = stripTimes(Number(url.searchParams.get("n")), Number(url.searchParams.get("a")), Number(url.searchParams.get("d")));
  const height = stripHeight(url.searchParams.get("h"), times.length);
  const kept = stripPath(String(video.user_id), id, source, times, height);
  const { data: cached } = await service.storage.from("video-assets").download(kept);
  if (cached) return image(Buffer.from(await cached.arrayBuffer()));

  const dir = `/tmp/qs-strip-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await mkdir(dir, { recursive: true });
    const made = await Promise.all(
      times.map((at, i) =>
        exec(ffmpegPath as string, frameArgs({ url: input as string, at, height, out: `${dir}/f-${String(i).padStart(2, "0")}.jpg` }), { timeout: 25_000 })
          .then(() => true)
          .catch(() => false),
      ),
    );
    /* A frame past the end (a short clip) is left out: the strip has the rest. */
    const ok = made.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
    if (!ok.length) return NextResponse.json({ error: "The clip could not be read." }, { status: 422 });
    let out = `${dir}/f-${String(ok[0]).padStart(2, "0")}.jpg`;
    if (times.length > 1) {
      /* Missing frames are filled with their neighbour, so the strip keeps its count (and the card its tiles). */
      const { copyFile } = await import("node:fs/promises");
      for (let i = 0; i < times.length; i += 1) {
        const from = ok.reduce((best, k) => (Math.abs(k - i) < Math.abs(best - i) ? k : best), ok[0]);
        await copyFile(`${dir}/f-${String(from).padStart(2, "0")}.jpg`, `${dir}/s-${String(i).padStart(2, "0")}.jpg`);
      }
      out = `${dir}/strip.jpg`;
      await exec(ffmpegPath as string, rowArgs({ pattern: `${dir}/s-%02d.jpg`, count: times.length, out }), { timeout: 25_000 });
    }
    const bytes = await readFile(out);
    await service.storage.from("video-assets").upload(kept, bytes, { contentType: "image/jpeg", upsert: true }).catch(() => null);
    return image(bytes);
  } catch {
    return NextResponse.json({ error: "The strip could not be made." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
