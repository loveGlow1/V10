/* The final cut, made here — one MP4 from every scene, generated or uploaded,
 * by the video settings (cut-settings.ts). ffmpeg itself (ffmpeg-static,
 * bundled with this route's function), run once nothing of the version is
 * still being made:
 *
 *   each scene   its picture — the person's own clip (trimmed, at its speed
 *                and level), a picture held and moving gently, a lip-synced
 *                clip, or a generated one — fitted to the frame the way the
 *                settings say (fill, fit on a blurred copy, fit on black),
 *                graded, at the frame rate asked; held on its last frame when
 *                its line runs longer; its own sound, its voice line on top;
 *                its words in clean type, in the caption style asked: a video
 *                model garbles lettering, the type here does not
 *   the join     straight, or a transition between every pair of scenes
 *   music        made, or the person's own file, under the whole cut and
 *                ducked whenever a voice speaks
 *   the finish   one loudness (-14 LUFS) for everything, fast-start, into
 *                video-assets as the version's "compose" row — the MP4 the
 *                studio and the workspace play and offer to download — and
 *                the ready-to-post versions beside it
 *
 * The ffmpeg itself is written in cut-filters.ts (pure, checked offline).
 * Runs in its own invocation (/api/video/[id]/render/compose) with its own
 * time budget; long cuts encode faster so they finish (encoderFor). Never
 * throws: a failure is written to the compose row.
 *
 * Server-only. */

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type ProductionPlan, type Scene } from "./plan";
import { exportPath, exportsFor, type ExportKind } from "./exports";
import { announceFinal } from "./announce";
import { encoderFor, frameSize, resolveCut, type ResolvedCut } from "./cut-settings";
import { finishArgs, joinArgs, musicMixArgs, sceneAudioFilter, sceneEncodeArgs, sceneVideoFilter, stillVideoFilter, type Words } from "./cut-filters";
import { downloadTo, inspect, runFfmpeg } from "./media-files";
import { signedUrl } from "./production";

export { musicMixArgs } from "./cut-filters";

/* Inter ExtraBold, fetched once per instance: drawtext needs a font file, and
   fetching it is one request rather than a file to carry through tracing. */
const FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-800-normal.ttf";
const FONT_PATH = "/tmp/qs-inter-800.ttf";

/** The frame each aspect ratio is cut at by default (720p). */
export const FRAME: Record<string, [number, number]> = {
  "16:9": frameSize("16:9", "720p"),
  "9:16": frameSize("9:16", "720p"),
  "1:1": frameSize("1:1", "720p"),
  "4:5": frameSize("4:5", "720p"),
};

/* A scene that is a title card — words on a dark screen — gets the screen
   darkened behind clean type; any other line is a caption band. Pure. */
export function isTitleCard(scene: Pick<Scene, "visual" | "shot" | "motionPrompt">): boolean {
  return /title card|text card|end card|black (background|screen)|(text|words|title|tagline) (appear|appears|cut|cuts|fade|fades)/i.test(
    `${scene.visual} ${scene.shot} ${scene.motionPrompt}`.slice(0, 600),
  );
}

/** How the cut is put together: every setting with its value. Pure. */
export const cutFor = (plan: Pick<ProductionPlan, "scenes" | "cut" | "aspect" | "pipeline" | "music">): ResolvedCut => resolveCut(plan);

/* How long a generated scene runs and how its clip fills it. A scene lasts
   as long as it must — its planned length, its voice line's when that is
   longer, the clip's own when its own sound is what is heard — and a clip
   shorter than that is slowed to fit (up to 1.4×, which reads as natural
   motion) before its last frame is held. Pure. */
export function sceneTiming(input: { planned: number; clip: number; voice: number; ownSound: boolean }): { seconds: number; stretch: number } {
  const clip = input.clip > 0 ? input.clip : input.planned;
  let seconds = Math.max(1, input.planned || 3);
  if (input.voice) seconds = Math.max(seconds, input.voice + 0.45);
  if (input.ownSound) seconds = Math.max(seconds, clip);
  seconds = Math.round(seconds * 1000) / 1000;
  const stretch = Math.min(1.4, Math.max(1, seconds / clip));
  return { seconds, stretch };
}

/* How long an uploaded scene runs: its trimmed footage at its speed, or its
   voice line when that runs longer (the last frame holds). Pure. */
export function uploadTiming(input: { clip: number; trimStart?: number; trimEnd?: number; speed?: number; voice: number }): { seconds: number; span: number; start: number } {
  const start = Math.max(0, Math.min(input.trimStart ?? 0, Math.max(0, input.clip - 0.2)));
  const end = Math.min(input.clip > 0 ? input.clip : Infinity, input.trimEnd ?? Infinity);
  const span = Math.max(0.2, (Number.isFinite(end) ? end : input.clip) - start);
  const played = span / (input.speed ?? 1);
  const seconds = Math.round(Math.max(played, input.voice ? input.voice + 0.45 : 0) * 1000) / 1000;
  return { seconds, span: Math.round(span * 1000) / 1000, start };
}

/** The ffmpeg arguments for one ready-to-post version. Pure. */
export function exportArgs(kind: ExportKind, input: { source: string; out: string; seconds: number; width: number; height: number }): string[] {
  const common = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", input.out];
  if (kind === "whatsapp") {
    /* 15 MB over the whole length, less the sound — never above 2.4 Mb/s. */
    const kbps = Math.max(500, Math.min(2400, Math.floor((15 * 8 * 1024) / Math.max(1, input.seconds)) - 140));
    const scale = input.width >= input.height ? "scale=720:-2" : "scale=-2:1280";
    return ["-hide_banner", "-y", "-i", input.source, "-vf", `${scale},setsar=1`, "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-profile:v", "main", "-pix_fmt", "yuv420p", ...common];
  }
  const [w, h] = kind === "vertical" ? [720, 1280] : [864, 1080];
  const filter = `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:2,eq=brightness=-0.08[bg];[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`;
  return ["-hide_banner", "-y", "-i", input.source, "-filter_complex", filter, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", ...common];
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

async function font(): Promise<string | null> {
  try {
    if ((await stat(FONT_PATH)).size > 10_000) return FONT_PATH;
  } catch {
    /* Not fetched yet on this instance. */
  }
  return (await downloadTo(FONT_URL, FONT_PATH, 20_000)) ? FONT_PATH : null;
}

type Row = { scene: number | null; engine: string; status: string; output_path: string | null };
type Upload = { kind: string; storage_path: string; working_path: string | null; duration_s: number | null };

/** Makes the version's final MP4 and lands it on the compose row. Never throws. */
export async function composeLocally(service: SupabaseClient, videoId: string, version: number, origin: string): Promise<void> {
  const dir = `/tmp/qs-compose-${videoId}-${version}-${Date.now()}`;
  const finish = (update: Record<string, unknown>) =>
    service.from("video_renders").update({ ...update, updated_at: new Date().toISOString() }).eq("video_id", videoId).eq("version", version).eq("engine", "compose");
  try {
    const { data: video } = await service.from("video_projects").select("id, user_id, title, project_id").eq("id", videoId).maybeSingle();
    const { data: planRow } = await service.from("video_versions").select("plan").eq("video_id", videoId).eq("version", version).maybeSingle();
    if (!video || !planRow) throw new Error("The video or its plan is missing.");
    const plan = planRow.plan as ProductionPlan;
    const { data } = await service.from("video_renders").select("scene, engine, status, output_path").eq("video_id", videoId).eq("version", version);
    const rows = (data ?? []) as Row[];
    const pick = (scene: number, engine: string) => rows.find((row) => row.scene === scene && row.engine === engine && row.status === "done");
    const { data: assetRows } = await service.from("video_assets").select("id, kind, storage_path, working_path, duration_s").eq("video_id", videoId);
    const uploads = new Map(((assetRows ?? []) as (Upload & { id: string })[]).map((asset) => [asset.id, asset]));

    await mkdir(dir, { recursive: true });
    const fontPath = await font();
    const cut = cutFor(plan);
    const [width, height] = frameSize(plan.aspect, cut.resolution);
    const planned = plan.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
    const encoder = encoderFor(cut.quality, planned);
    const segments: { path: string; seconds: number }[] = [];
    const last = plan.scenes[plan.scenes.length - 1]?.n;
    const first = plan.scenes[0]?.n;
    /* Whether a voice is heard anywhere: the score ducks under it. */
    let voiced = false;

    for (const scene of plan.scenes) {
      const talking = pick(scene.n, "avatar");
      const upload = scene.source && !talking ? uploads.get(scene.source.assetId) : undefined;
      const still = Boolean(upload && upload.kind !== "video" && upload.kind !== "audio");

      /* The picture: the upload itself (its working copy when there is one),
         else the lip-synced or generated clip. */
      const picturePath = upload ? (still ? upload.storage_path : (upload.working_path ?? upload.storage_path)) : null;
      const pictureUrl = picturePath ? await signedUrl(service, `storage:${picturePath}`) : await signedUrl(service, (talking ?? pick(scene.n, "video"))?.output_path ?? null);
      if (!pictureUrl) continue;
      /* ffmpeg reads a picture by its extension. */
      const ext = still ? (picturePath?.match(/\.(png|jpe?g|webp)$/i)?.[0] ?? ".jpg") : ".mp4";
      const clipPath = join(dir, `clip-${scene.n}${ext}`);
      if (!(await downloadTo(pictureUrl, clipPath))) continue;
      const clip = await inspect(clipPath);

      /* The script's voice, unless the cut is the clips' own sound. A
         lip-synced clip already carries its line. */
      const voice = talking || cut.audio === "original" || cut.audio === "none" ? null : pick(scene.n, "voice");
      const voiceUrl = voice ? await signedUrl(service, voice.output_path) : null;
      const voicePath = join(dir, `voice-${scene.n}.mp3`);
      const hasVoice = Boolean(voiceUrl && (await downloadTo(voiceUrl, voicePath)));
      const voiceSeconds = hasVoice ? (await inspect(voicePath)).seconds : 0;
      if (hasVoice || talking) voiced = true;

      /* A generated clip's own sound is the video model's: room tone at
         best, at worst lines it made up. It is heard only when the cut asks
         for it (original, or mixed under the voice); the person's own
         footage is heard whenever the cut keeps original sound; a lip-synced
         clip's sound is the voice line itself and always stays. */
      const keepsOriginal = cut.audio === "original" || cut.audio === "mix" || (cut.audio === "voiceover" && Boolean(upload) && !hasVoice);
      const ownSound = !still && clip.hasAudio && cut.audio !== "none" && !cut.muted.has(scene.n) && (Boolean(talking) || keepsOriginal);

      let seconds: number;
      let inputOptions: string[] = [];
      let speed: number | undefined;
      let stretch = 1;
      if (upload && !still) {
        const timing = uploadTiming({ clip: clip.seconds, trimStart: scene.source?.trimStart, trimEnd: scene.source?.trimEnd, speed: scene.source?.speed, voice: voiceSeconds });
        seconds = timing.seconds;
        speed = scene.source?.speed;
        inputOptions = ["-ss", timing.start.toFixed(3), "-t", timing.span.toFixed(3)];
      } else if (still) {
        seconds = Math.max(1, Number(scene.duration) || 4, voiceSeconds ? voiceSeconds + 0.45 : 0);
      } else {
        ({ seconds, stretch } = sceneTiming({ planned: Number(scene.duration) || 3, clip: clip.seconds, voice: voiceSeconds, ownSound: Boolean(ownSound) && !hasVoice }));
      }

      /* Words on the frame. A title card is large on a dark screen;
         otherwise the spoken line is the caption and the scene's own words,
         or the end card, sit opposite it. A silent cut keeps the script as
         captions: muted is how most people watch. */
      const titleCard = isTitleCard(scene) && Boolean(scene.onScreenText?.trim());
      const spoken = cut.captions && (hasVoice || cut.audio === "none") ? scene.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "").trim() : "";
      const headlineText = scene.n === last && cut.endCard ? cut.endCard : !titleCard && scene.onScreenText?.trim() && scene.onScreenText.trim() !== spoken ? scene.onScreenText.trim() : "";
      const texts: Record<string, string> = {};
      if (titleCard) texts.title = wrap(scene.onScreenText, width, true);
      if (headlineText) texts.headline = wrap(headlineText, width, false);
      if (spoken) texts.caption = wrap(spoken, width, false);
      for (const [kind, value] of Object.entries(texts)) await writeFile(join(dir, `${kind}-${scene.n}.txt`), value);
      const words: Words | null = fontPath
        ? { fontPath, dir, n: scene.n, title: texts.title, headline: texts.headline, caption: texts.caption, captionPosition: cut.captionPosition, captionSize: cut.captionSize, captionStyle: cut.captionStyle }
        : null;
      const edges = { dip: cut.transition === "dip", fadeIn: cut.fadeIn && scene.n === first, fadeOut: cut.fadeOut && scene.n === last };

      const videoFilter = still
        ? stillVideoFilter({ width, height, seconds, fps: cut.fps, fit: cut.fit, motion: cut.stillMotion, color: cut.color, words, edges })
        : sceneVideoFilter({ width, height, seconds, fps: cut.fps, fit: cut.fit, color: cut.color, speed, stretch, words, edges });
      const audioFilter = sceneAudioFilter({
        seconds,
        ownSound: Boolean(ownSound),
        hasVoice,
        ownLevel: cut.originalVolume * (scene.source?.volume ?? 1) * (upload ? 1.11 : 1),
        voiceLevel: cut.voiceVolume,
        speed,
        edges,
      });
      const out = join(dir, `scene-${scene.n}.mp4`);
      await runFfmpeg(sceneEncodeArgs({ clipPath, inputOptions, voicePath: hasVoice ? voicePath : null, seconds, videoFilter, audioFilter, encoder, out }), 240_000);
      /* The bytes are written; the source is not needed again. */
      await rm(clipPath, { force: true });
      segments.push({ path: out, seconds: (await inspect(out)).seconds || seconds });
    }

    if (!segments.length) throw new Error("No scene had a clip to put in the cut.");
    const final = join(dir, "final.mp4");
    const joined = join(dir, "joined.mp4");
    const listPath = join(dir, "list.txt");
    const join_ = joinArgs({ segments, transition: cut.transition, duration: cut.transitionSeconds, listPath, out: joined, encoder });
    if (join_.list !== null) await writeFile(listPath, join_.list);
    await runFfmpeg(join_.args, 280_000);
    for (const segment of segments) await rm(segment.path, { force: true });

    /* The score under it: made, or the person's own file. */
    const musicRow = cut.audio === "none" || cut.music.source === "none" ? undefined : rows.find((row) => row.engine === "music" && row.status === "done");
    const musicUrl = musicRow ? await signedUrl(service, musicRow.output_path) : null;
    const musicPath = join(dir, "music.audio");
    const withMusic = Boolean(musicUrl && (await downloadTo(musicUrl, musicPath)));
    const scored = join(dir, "scored.mp4");
    let source = joined;
    if (withMusic) {
      const seconds = (await inspect(joined)).seconds;
      const mixed = await runFfmpeg(
        musicMixArgs({ joined, music: musicPath, out: scored, seconds, spoken: voiced, level: cut.musicVolume, duck: cut.duck, start: cut.music.source === "upload" ? cut.music.start : 0 }),
        180_000,
      )
        .then(() => true)
        .catch(() => false);
      /* A score that will not mix is left out; the cut is made without it. */
      if (mixed) source = scored;
    }
    /* One loudness for the whole video, at the level social apps play at
       (-14 LUFS), so it is neither quieter nor louder than what is around it.
       The picture is copied, not encoded again. A silent cut has nothing to
       level. */
    await runFfmpeg(finishArgs({ source, out: final, loudness: cut.loudness, silent: cut.audio === "none" && !withMusic }), 120_000);

    const path = `${video.user_id}/${videoId}/v${version}/final.mp4`;
    const { error } = await service.storage.from("video-assets").upload(path, await readFile(final), { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`The MP4 could not be stored: ${error.message}`);

    /* The ready-to-post versions, beside the cut. One that fails is left
       out; the cut itself is already made. */
    const total = (await inspect(final)).seconds;
    for (const kind of exportsFor(plan.aspect)) {
      try {
        const out = join(dir, `final-${kind}.mp4`);
        await runFfmpeg(exportArgs(kind, { source: final, out, seconds: total, width, height }), 120_000);
        await service.storage.from("video-assets").upload(exportPath(path, kind), await readFile(out), { contentType: "video/mp4", upsert: true });
      } catch {
        /* Left out. */
      }
    }

    await finish({ status: "done", output_path: `storage:${path}`, error: null });
    await service.from("video_projects").update({ status: "ready" }).eq("id", videoId);
    await announceFinal(service, { videoId, version, origin, scenes: segments.length });
  } catch (error) {
    await finish({ status: "failed", error: (error instanceof Error ? error.message : "The final cut could not be made.").slice(0, 500) });
    const { data: rows } = await service.from("video_renders").select("engine, status").eq("video_id", videoId).eq("version", version);
    const pictures = (rows ?? []).some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done");
    await service.from("video_projects").update({ status: pictures ? "ready" : "failed" }).eq("id", videoId);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
