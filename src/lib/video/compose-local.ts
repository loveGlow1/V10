/* The final cut, made here — one MP4 from every scene, with no fal key.
 *
 * fal's ffmpeg compose is one way to join a render's clips (production.ts).
 * Without FAL_KEY there was no other, so a finished render stayed a set of
 * clips the studio played back to back. This is the other: ffmpeg itself
 * (ffmpeg-static, bundled with the function), run once the last clip of a
 * version has landed:
 *
 *   each scene   its clip — the lip-synced one when there is one — fitted to
 *                the plan's frame, held on its last frame when the scene runs
 *                longer than the clip, its own sound kept low, its voice line
 *                on top, and its on-screen words set in clean type (a title
 *                card darkened behind them, other lines as a caption band):
 *                a video model garbles lettering, the type here does not
 *   then         every scene joined in order, fast-start, into video-assets
 *                as the version's "compose" row — the MP4 the workspace
 *                preview plays and offers to download
 *
 * Runs in its own invocation (/api/video/[id]/render/compose) with its own
 * time budget. Never throws: a failure is written to the compose row.
 *
 * Server-only. */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { SupabaseClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";

import type { ProductionPlan, Scene } from "./plan";
import { signedUrl } from "./production";

const exec = promisify(execFile);

/* Inter ExtraBold, fetched once per instance: drawtext needs a font file, and
   fetching it is one request rather than a file to carry through tracing. */
const FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-800-normal.ttf";
const FONT_PATH = "/tmp/qs-inter-800.ttf";

/** The frame each aspect ratio is cut at. */
export const FRAME: Record<string, [number, number]> = {
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "1:1": [1080, 1080],
  "4:5": [864, 1080],
};

/* A scene that is a title card — words on a dark screen — gets the screen
   darkened behind clean type; any other line is a caption band. Pure. */
export function isTitleCard(scene: Pick<Scene, "visual" | "shot" | "motionPrompt">): boolean {
  return /title card|text card|end card|black (background|screen)|(text|words|title|tagline) (appear|appears|cut|cuts|fade|fades)/i.test(
    `${scene.visual} ${scene.shot} ${scene.motionPrompt}`.slice(0, 600),
  );
}

/** The video filter for one scene. Pure. */
export function sceneFilter(input: { width: number; height: number; seconds: number; text: string | null; title: boolean; fontPath: string; textPath: string }): string {
  const { width, height, seconds } = input;
  const parts = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "setsar=1",
    "fps=30",
    `tpad=stop_mode=clone:stop_duration=${seconds}`,
  ];
  if (input.text) {
    const small = Math.min(width, height);
    if (input.title) {
      parts.push("drawbox=x=0:y=0:w=iw:h=ih:color=black@0.97:t=fill");
      parts.push(
        `drawtext=fontfile=${input.fontPath}:textfile=${input.textPath}:fontcolor=white:fontsize=${Math.round(small * 0.085)}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`,
      );
    } else {
      parts.push(
        `drawtext=fontfile=${input.fontPath}:textfile=${input.textPath}:fontcolor=white:fontsize=${Math.round(small * 0.05)}:x=(w-text_w)/2:y=h*0.80-text_h/2:box=1:boxcolor=black@0.5:boxborderw=${Math.round(small * 0.022)}:line_spacing=8`,
      );
    }
  }
  const fade = Math.min(0.25, seconds / 6);
  parts.push(`fade=t=in:st=0:d=${fade}`, `fade=t=out:st=${(seconds - fade).toFixed(2)}:d=${fade}`);
  return parts.join(",");
}

/* Breaks a line for the frame: drawtext does not wrap. Pure. */
export function wrap(text: string, width: number, title: boolean): string {
  const perLine = Math.max(12, Math.round((width / (title ? 62 : 38)) * 1.0));
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > perLine && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4).join("\n");
}

async function probe(path: string): Promise<{ audio: boolean; seconds: number }> {
  const result = await exec(ffmpegPath as string, ["-hide_banner", "-i", path], { maxBuffer: 1 << 22 }).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));
  const text = String((result as { stderr?: string }).stderr ?? "");
  const match = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const seconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  return { audio: /Stream #.*Audio:/.test(text), seconds };
}

async function download(url: string, path: string): Promise<boolean> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) return false;
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function font(): Promise<string | null> {
  try {
    if ((await stat(FONT_PATH)).size > 10_000) return FONT_PATH;
  } catch {
    /* Not fetched yet on this instance. */
  }
  return (await download(FONT_URL, FONT_PATH).catch(() => false)) ? FONT_PATH : null;
}

type Row = { scene: number | null; engine: string; status: string; output_path: string | null };

/** Makes the version's final MP4 and lands it on the compose row. Never throws. */
export async function composeLocally(service: SupabaseClient, videoId: string, version: number): Promise<void> {
  const dir = `/tmp/qs-compose-${videoId}-${version}-${Date.now()}`;
  const finish = (update: Record<string, unknown>) =>
    service.from("video_renders").update({ ...update, updated_at: new Date().toISOString() }).eq("video_id", videoId).eq("version", version).eq("engine", "compose");
  try {
    if (!ffmpegPath) throw new Error("ffmpeg is not available on this server.");
    const { data: video } = await service.from("video_projects").select("id, user_id, title, project_id").eq("id", videoId).maybeSingle();
    const { data: planRow } = await service.from("video_versions").select("plan").eq("video_id", videoId).eq("version", version).maybeSingle();
    if (!video || !planRow) throw new Error("The video or its plan is missing.");
    const plan = planRow.plan as ProductionPlan;
    const { data } = await service.from("video_renders").select("scene, engine, status, output_path").eq("video_id", videoId).eq("version", version);
    const rows = (data ?? []) as Row[];
    const pick = (scene: number, engine: string) => rows.find((row) => row.scene === scene && row.engine === engine && row.status === "done");

    await mkdir(dir, { recursive: true });
    const fontPath = await font();
    const [width, height] = FRAME[plan.aspect] ?? FRAME["16:9"];
    const segments: string[] = [];

    for (const scene of plan.scenes) {
      const talking = pick(scene.n, "avatar");
      const picture = talking ?? pick(scene.n, "video");
      const pictureUrl = picture ? await signedUrl(service, picture.output_path) : null;
      if (!pictureUrl) continue;
      const clipPath = join(dir, `clip-${scene.n}.mp4`);
      if (!(await download(pictureUrl, clipPath))) continue;
      const clip = await probe(clipPath);

      /* A lip-synced clip already carries its line. */
      const voice = talking ? null : pick(scene.n, "voice");
      const voiceUrl = voice ? await signedUrl(service, voice.output_path) : null;
      const voicePath = join(dir, `voice-${scene.n}.mp3`);
      const hasVoice = Boolean(voiceUrl && (await download(voiceUrl, voicePath)));
      const voiceSeconds = hasVoice ? (await probe(voicePath)).seconds : 0;

      /* The scene runs its planned length — longer when its line needs it. */
      const seconds = Math.max(1, Number(scene.duration) || 3, voiceSeconds ? voiceSeconds + 0.4 : 0);
      const text = scene.onScreenText?.trim() ? wrap(scene.onScreenText, width, isTitleCard(scene)) : null;
      const textPath = join(dir, `text-${scene.n}.txt`);
      if (text) await writeFile(textPath, text);

      const args = ["-hide_banner", "-y", "-i", clipPath, "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=44100:cl=stereo"];
      if (hasVoice) args.push("-i", voicePath);
      const bed = clip.audio ? `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${hasVoice ? 0.45 : 0.9},apad[bed]` : `[1:a]anull[bed]`;
      const audio = hasVoice
        ? `${bed};[2:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.5,adelay=150|150,apad[vo];[bed][vo]amix=inputs=2:duration=first:normalize=0[mix];[mix]atrim=0:${seconds},afade=t=out:st=${Math.max(0, seconds - 0.3).toFixed(2)}:d=0.3[a]`
        : `${bed};[bed]atrim=0:${seconds},afade=t=out:st=${Math.max(0, seconds - 0.3).toFixed(2)}:d=0.3[a]`;
      const video = `[0:v]${sceneFilter({ width, height, seconds, text: text && fontPath ? text : null, title: isTitleCard(scene), fontPath: fontPath ?? "", textPath })}[v]`;
      const out = join(dir, `scene-${scene.n}.mp4`);
      args.push(
        "-filter_complex", `${video};${audio}`,
        "-map", "[v]", "-map", "[a]",
        "-t", String(seconds),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
        out,
      );
      await exec(ffmpegPath as string, args, { maxBuffer: 1 << 24, timeout: 120_000 });
      segments.push(out);
    }

    if (!segments.length) throw new Error("No scene had a clip to put in the cut.");
    const list = join(dir, "list.txt");
    await writeFile(list, segments.map((path) => `file '${path}'`).join("\n"));
    const final = join(dir, "final.mp4");
    await exec(ffmpegPath as string, ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final], { maxBuffer: 1 << 24, timeout: 120_000 });

    const path = `${video.user_id}/${videoId}/v${version}/final.mp4`;
    const { error } = await service.storage.from("video-assets").upload(path, await readFile(final), { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`The MP4 could not be stored: ${error.message}`);

    await finish({ status: "done", output_path: `storage:${path}`, error: null });
    await service.from("video_projects").update({ status: "ready" }).eq("id", videoId);
    if (video.project_id) {
      await service.from("projects").update({ last_build_at: new Date().toISOString() }).eq("id", video.project_id);
      await service.from("project_messages").insert({
        project_id: video.project_id,
        user_id: video.user_id,
        role: "system",
        body: `Your video is ready as one MP4 — ${segments.length} scenes joined in order, with the voice and on-screen words. Play it in the preview, or open the MP4 there to download it.`,
        links: [],
        tone: "normal",
        kind: "build_ready",
        dedupe_key: `video-final:${videoId}:${version}`,
      });
    }
  } catch (error) {
    await finish({ status: "failed", error: (error instanceof Error ? error.message : "The final cut could not be made.").slice(0, 500) });
    const { data: rows } = await service.from("video_renders").select("engine, status").eq("video_id", videoId).eq("version", version);
    const pictures = (rows ?? []).some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done");
    await service.from("video_projects").update({ status: pictures ? "ready" : "failed" }).eq("id", videoId);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
