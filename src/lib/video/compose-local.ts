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
import { chargeCredits } from "@/lib/credits-server";
import { cutCredits } from "./pricing";
import { chapterStarts, chaptersOf, concatList, musicOffset, partFingerprint, partOf, partPath, partProvider, partsOutput, sceneKey, stableChapters, streamJoinArgs } from "./chapters";
import { falToken, verifyFalToken } from "./fal";
import { ffmpegOutput, streamToStorage } from "./stream-upload";
import { WORKING_COPY_SECONDS } from "./prepare-asset";

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

/** What a part of a long film is, kept on its row (chapters.ts). */
type PartDetail = { scenes: number[]; keys: string[]; start: number; first: boolean; last: boolean; seconds: number; reused: boolean };

/* What a scene's stretch of the cut is made from: its plan and the exact files it uses. */
function keyOf(ctx: Cutting, scene: ProductionPlan["scenes"][number]): string {
  const file = (engine: string) => ctx.rows.find((row) => row.scene === scene.n && row.engine === engine && row.status === "done")?.output_path ?? null;
  const upload = scene.source ? ctx.uploads.get(scene.source.assetId) : undefined;
  return sceneKey(scene as unknown as Record<string, unknown> & { n: number }, {
    picture: file("avatar") ?? file("video"),
    voice: file("voice"),
    upload: upload ? upload.working_path ?? upload.storage_path : null,
    muted: ctx.cut.muted.has(scene.n) ? "muted" : null,
  });
}

/* The settings that shape a part. What touches one scene (its mute) is in
   that scene's key; what touches only the opening or the closing part (fade
   in, fade out, the end card) only in theirs — so changing them re-cuts one
   part, not the film. */
function cutForPart(ctx: Cutting, first: boolean, last: boolean): Record<string, unknown> {
  const { muted: _muted, endCard, fadeIn, fadeOut, brandMark, ...rest } = ctx.cut;
  void _muted;
  /* The brand mark belongs to every part when it is on all the way through,
     otherwise only to the part that opens or closes the film. */
  const mark = brandMark && (brandMark.when === "all" || (brandMark.when === "start" && first) || (brandMark.when === "end" && last)) ? { brandMark } : {};
  return { ...rest, ...mark, ...(first ? { fadeIn } : {}), ...(last ? { fadeOut, endCard: endCard ?? "" } : {}) };
}

/* The music the parts are scored with, as one key; null when there is none. */
function musicKeyOf(ctx: Cutting): string | null {
  if (ctx.cut.audio === "none" || ctx.cut.music.source === "none") return null;
  const made = ctx.rows.find((row) => row.engine === "music" && row.status === "done")?.output_path ?? null;
  return made ? `${made}@${ctx.cut.music.source === "upload" ? ctx.cut.music.start : 0}` : null;
}
type Upload = { kind: string; storage_path: string; working_path: string | null; duration_s: number | null };

/** What every part of one cut shares. */
type Cutting = {
  service: SupabaseClient;
  plan: ProductionPlan;
  rows: Row[];
  uploads: Map<string, Upload & { id: string }>;
  dir: string;
  fontPath: string | null;
  cut: ResolvedCut;
  width: number;
  height: number;
  encoder: { preset: string; crf: number };
  first: number | undefined;
  last: number | undefined;
};

type Loaded = Cutting & { video: { id: string; user_id: string; title: string; project_id: string | null } };

async function load(service: SupabaseClient, videoId: string, version: number, dir: string): Promise<Loaded> {
  const { data: video } = await service.from("video_projects").select("id, user_id, title, project_id").eq("id", videoId).maybeSingle();
  const { data: planRow } = await service.from("video_versions").select("plan").eq("video_id", videoId).eq("version", version).maybeSingle();
  if (!video || !planRow) throw new Error("The video or its plan is missing.");
  const plan = planRow.plan as ProductionPlan;
  const { data } = await service.from("video_renders").select("scene, engine, status, output_path").eq("video_id", videoId).eq("version", version);
  const { data: assetRows } = await service.from("video_assets").select("id, kind, storage_path, working_path, duration_s").eq("video_id", videoId);
  await mkdir(dir, { recursive: true });
  const cut = cutFor(plan);
  const [width, height] = frameSize(plan.aspect, cut.resolution);
  const planned = plan.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
  return {
    video: video as Loaded["video"],
    service,
    plan,
    rows: (data ?? []) as Row[],
    uploads: new Map(((assetRows ?? []) as (Upload & { id: string })[]).map((asset) => [asset.id, asset])),
    dir,
    fontPath: await font(),
    cut,
    width,
    height,
    /* One encoder for the whole film, so its parts join without encoding again. */
    encoder: encoderFor(cut.quality, planned),
    first: plan.scenes[0]?.n,
    last: plan.scenes[plan.scenes.length - 1]?.n,
  };
}

/** Some scenes of the plan, cut and joined (with their transitions) into one MP4 in `dir`. */
async function cutScenes(ctx: Cutting, scenes: ProductionPlan["scenes"], name: string): Promise<{ joined: string; voiced: boolean; count: number }> {
  const { service, plan, rows, uploads, dir, fontPath, cut, width, height, encoder, first, last } = ctx;
  const pick = (scene: number, engine: string) => rows.find((row) => row.scene === scene && row.engine === engine && row.status === "done");
  const segments: { path: string; seconds: number }[] = [];
  /* Whether a voice is heard anywhere: the score ducks under it. */
  let voiced = false;

    for (const scene of scenes) {
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
      /* A long upload is read where it is stored — only the part this scene
         uses is fetched — rather than copied whole onto this disk. */
      const remote = Boolean(upload && !still && Number(upload.duration_s) > WORKING_COPY_SECONDS);
      const clipPath = remote ? pictureUrl : join(dir, `clip-${scene.n}${ext}`);
      if (!remote && !(await downloadTo(pictureUrl, clipPath))) continue;
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
      const mark = cut.brandMark;
      if (mark && (mark.when === "all" || (mark.when === "start" && scene.n === first) || (mark.when === "end" && scene.n === last))) texts.brand = mark.text;
      for (const [kind, value] of Object.entries(texts)) await writeFile(join(dir, `${kind}-${scene.n}.txt`), value);
      const words: Words | null = fontPath
        ? { fontPath, dir, n: scene.n, title: texts.title, headline: texts.headline, caption: texts.caption, captionPosition: cut.captionPosition, captionSize: cut.captionSize, captionStyle: cut.captionStyle, brand: texts.brand, brandPosition: mark?.position }
        : null;
      const edges = { dip: cut.transition === "dip", fadeIn: cut.fadeIn && scene.n === first, fadeOut: cut.fadeOut && scene.n === last };

      const videoFilter = still
        ? stillVideoFilter({ width, height, seconds, fps: cut.fps, fit: cut.fit, motion: cut.stillMotion, color: scene.color ?? cut.color, words, edges })
        : sceneVideoFilter({ width, height, seconds, fps: cut.fps, fit: cut.fit, color: scene.color ?? cut.color, speed, stretch, words, edges });
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
      if (!remote) await rm(clipPath, { force: true });
      segments.push({ path: out, seconds: (await inspect(out)).seconds || seconds });
    }

    if (!segments.length) throw new Error("No scene had a clip to put in the cut.");
  const joined = join(dir, `${name}-joined.mp4`);
  const listPath = join(dir, `${name}-list.txt`);
  const join_ = joinArgs({ segments, transition: cut.transition, duration: cut.transitionSeconds, listPath, out: joined, encoder });
  if (join_.list !== null) await writeFile(listPath, join_.list);
  await runFfmpeg(join_.args, 280_000);
  for (const segment of segments) await rm(segment.path, { force: true });
  return { joined, voiced, count: segments.length };
}

/** The score under a cut, then one loudness: the finished MP4 at `out`. */
async function scoreAndFinish(ctx: Cutting, input: { joined: string; voiced: boolean; out: string; name: string; chapterStart?: number; fadeIn?: boolean; fadeOut?: boolean; loop?: boolean }): Promise<void> {
  const { service, rows, dir, cut } = ctx;
  const musicRow = cut.audio === "none" || cut.music.source === "none" ? undefined : rows.find((row) => row.engine === "music" && row.status === "done");
  const musicUrl = musicRow ? await signedUrl(service, musicRow.output_path) : null;
  const musicPath = join(dir, `${input.name}-music.audio`);
  const withMusic = Boolean(musicUrl && (await downloadTo(musicUrl, musicPath)));
  const scored = join(dir, `${input.name}-scored.mp4`);
  let source = input.joined;
  if (withMusic) {
    const seconds = (await inspect(input.joined)).seconds;
    const songStart = cut.music.source === "upload" ? cut.music.start : 0;
    const start = input.chapterStart === undefined ? songStart : musicOffset(songStart, input.chapterStart, (await inspect(musicPath)).seconds);
    const mixed = await runFfmpeg(
      musicMixArgs({ joined: input.joined, music: musicPath, out: scored, seconds, spoken: input.voiced, level: cut.musicVolume, duck: cut.duck, start, loop: input.loop, fadeIn: input.fadeIn, fadeOut: input.fadeOut }),
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
     level — but a film in parts always carries sound, so every part joins
     the same way. */
  await runFfmpeg(finishArgs({ source, out: input.out, loudness: cut.loudness, silent: cut.audio === "none" && !withMusic && input.chapterStart === undefined }), 120_000);
}

const composeToken = (videoId: string, version: number, part: number | "join") => falToken(videoId, version, part === "join" ? "compose-join" : `compose-part:${part}`);
export const verifyComposeJob = (videoId: string, version: number, part: number | "join", token: string | null) =>
  verifyFalToken(videoId, version, part === "join" ? "compose-join" : `compose-part:${part}`, token);

async function kick(origin: string, videoId: string, version: number, part: number | "join"): Promise<boolean> {
  const response = await fetch(`${origin}/api/video/${videoId}/render/compose?v=${version}&part=${part}&t=${composeToken(videoId, version, part)}`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => null);
  return Boolean(response?.ok);
}

/**
 * Makes the version's final MP4 and lands it on the compose row. Never throws.
 *
 * A cut longer than ONE_RUN_SECONDS is made in chapters (chapters.ts):
 * called without `part`, this starts every chapter at once; each chapter is
 * a call with its number; the last to finish starts the join.
 */
export async function composeLocally(service: SupabaseClient, videoId: string, version: number, origin: string, part?: number | "join"): Promise<void> {
  const dir = `/tmp/qs-compose-${videoId}-${version}-${part ?? "all"}-${Date.now()}`;
  const finish = (update: Record<string, unknown>) =>
    service.from("video_renders").update({ ...update, updated_at: new Date().toISOString() }).eq("video_id", videoId).eq("version", version).eq("engine", "compose");
  const failed = async (error: unknown) => {
    await finish({ status: "failed", error: (error instanceof Error ? error.message : "The final cut could not be made.").slice(0, 500) });
    const { data: rows } = await service.from("video_renders").select("engine, status").eq("video_id", videoId).eq("version", version);
    const pictures = (rows ?? []).some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done");
    await service.from("video_projects").update({ status: pictures ? "ready" : "failed" }).eq("id", videoId);
  };
  try {
    if (part === "join") return await joinParts(service, videoId, version, origin, failed);
    const ctx = await load(service, videoId, version, dir);
    const { plan, video } = ctx;
    const chapters = chaptersOf(plan.scenes);
    const base = `${video.user_id}/${videoId}/v${version}`;

    if (part === undefined && chapters.length > 1) {
      /* A long film: the parts fall where the last version's did wherever
         their scenes are unchanged, and a part that would come out the same
         is reused rather than cut — and charged — again. The rest are cut at
         once, each in a run of its own. */
      const keys = new Map(plan.scenes.map((scene) => [scene.n, keyOf(ctx, scene)]));
      const { data: earlier } = await service
        .from("video_renders")
        .select("version, fingerprint, detail, output_path")
        .eq("video_id", videoId)
        .eq("engine", "part")
        .eq("status", "done")
        .neq("version", version)
        .not("fingerprint", "is", null)
        .order("version", { ascending: false })
        .limit(2000);
      const previous = (earlier ?? []) as { version: number; fingerprint: string; detail: PartDetail | null; output_path: string | null }[];
      const groups = stableChapters(
        plan.scenes.map((scene) => ({ n: scene.n, duration: Number(scene.duration) || 0, continues: scene.continues, key: keys.get(scene.n) ?? "" })),
        previous.map((row) => row.detail?.keys ?? []),
      );
      const starts = chapterStarts(plan.scenes, groups);
      const music = musicKeyOf(ctx);
      const parts = groups.map((scenes, i) => {
        const partKeys = scenes.map((n) => keys.get(n) ?? "");
        const fingerprint = partFingerprint({ keys: partKeys, cut: cutForPart(ctx, i === 0, i === groups.length - 1), aspect: plan.aspect, music, musicStart: starts[i], first: i === 0, last: i === groups.length - 1 });
        const seconds = scenes.reduce((sum, n) => sum + (Number(plan.scenes.find((scene) => scene.n === n)?.duration) || 0), 0);
        const reuse = previous.find((row) => row.fingerprint === fingerprint && row.output_path);
        const detail: PartDetail = { scenes, keys: partKeys, start: starts[i], first: i === 0, last: i === groups.length - 1, seconds, reused: Boolean(reuse) };
        return { k: i + 1, fingerprint, detail, reuse };
      });
      await service.from("video_renders").delete().eq("video_id", videoId).eq("version", version).eq("engine", "part");
      const { error } = await service.from("video_renders").insert(
        parts.map((p) => ({
          video_id: videoId,
          user_id: video.user_id,
          version,
          scene: null,
          engine: "part",
          provider: partProvider(p.k),
          status: p.reuse ? "done" : "running",
          output_path: p.reuse?.output_path ?? null,
          fingerprint: p.fingerprint,
          detail: p.detail,
        })),
      );
      if (error) throw new Error(`The film's parts could not be started: ${error.message}`);
      const toCut = parts.filter((p) => !p.reuse);
      const started = await Promise.all(toCut.map((p) => kick(origin, videoId, version, p.k)));
      const missed = toCut.filter((_, i) => !started[i]).map((p) => p.k);
      if (toCut.length && missed.length === toCut.length) throw new Error("The film's parts could not be started.");
      for (const k of missed) await markPart(service, videoId, version, k, { status: "failed", error: "This part could not be started." });
      /* Nothing to cut, or some could not start: see whether it can be joined now. */
      if (!toCut.length || missed.length) await maybeJoin(service, videoId, version, origin);
      return;
    }

    if (typeof part === "number") {
      /* What this part is: written when the film's parts were laid out. */
      const { data: mine } = await service
        .from("video_renders")
        .select("detail")
        .eq("video_id", videoId)
        .eq("version", version)
        .eq("engine", "part")
        .eq("provider", partProvider(part))
        .maybeSingle();
      const detail = (mine?.detail ?? null) as PartDetail | null;
      const numbers = detail?.scenes ?? chapters[part - 1] ?? [];
      const scenes = numbers.map((n) => plan.scenes.find((scene) => scene.n === n)!).filter(Boolean);
      if (!scenes.length) throw new Error(`There is no part ${part}.`);
      try {
        const made = await cutScenes(ctx, scenes, `part-${part}`);
        const out = join(dir, `part-${part}.mp4`);
        const fallbackStarts = chapterStarts(plan.scenes, chapters);
        await scoreAndFinish(ctx, {
          joined: made.joined,
          voiced: made.voiced,
          out,
          name: `part-${part}`,
          chapterStart: detail?.start ?? fallbackStarts[part - 1],
          loop: true,
          fadeIn: detail ? detail.first : part === 1,
          fadeOut: detail ? detail.last : part === chapters.length,
        });
        const path = partPath(base, part);
        const { error } = await service.storage.from("video-assets").upload(path, await readFile(out), { contentType: "video/mp4", upsert: true });
        if (error) throw new Error(`Part ${part} could not be stored: ${error.message}`);
        await markPart(service, videoId, version, part, { status: "done", output_path: `storage:${path}`, error: null });
      } catch (error) {
        await markPart(service, videoId, version, part, { status: "failed", error: (error instanceof Error ? error.message : "This part could not be cut.").slice(0, 500) });
      }
      await maybeJoin(service, videoId, version, origin);
      return;
    }

    /* A short cut: one run, as it always was. */
    const made = await cutScenes(ctx, plan.scenes, "all");
    const final = join(dir, "final.mp4");
    await scoreAndFinish(ctx, { joined: made.joined, voiced: made.voiced, out: final, name: "all" });

    const path = `${base}/final.mp4`;
    const { error } = await service.storage.from("video-assets").upload(path, await readFile(final), { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`The MP4 could not be stored: ${error.message}`);

    /* The ready-to-post versions, beside the cut. One that fails is left
       out; the cut itself is already made. */
    const total = (await inspect(final)).seconds;
    for (const kind of exportsFor(plan.aspect)) {
      try {
        const out = join(dir, `final-${kind}.mp4`);
        await runFfmpeg(exportArgs(kind, { source: final, out, seconds: total, width: ctx.width, height: ctx.height }), 120_000);
        await service.storage.from("video-assets").upload(exportPath(path, kind), await readFile(out), { contentType: "video/mp4", upsert: true });
      } catch {
        /* Left out. */
      }
    }

    await finish({ status: "done", output_path: `storage:${path}`, error: null });
    await chargeCut(service, video, videoId, version, total);
    await service.from("video_projects").update({ status: "ready" }).eq("id", videoId);
    await announceFinal(service, { videoId, version, origin, scenes: made.count });
  } catch (error) {
    await failed(error);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* The cut is work: charged once per version, by its length. */
async function chargeCut(service: SupabaseClient, video: { user_id: string; title: string }, videoId: string, version: number, total: number, label?: string) {
  await chargeCredits(service, {
    userId: video.user_id,
    action: "generate",
    cost: cutCredits(total),
    description: label ?? `Video cut (${Math.max(1, Math.ceil(total / 60))} min): ${video.title}`,
    dedupeKey: `video-cut:${videoId}:${version}`,
  });
}

async function markPart(service: SupabaseClient, videoId: string, version: number, k: number, update: Record<string, unknown>) {
  await service
    .from("video_renders")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("video_id", videoId)
    .eq("version", version)
    .eq("engine", "part")
    .eq("provider", partProvider(k));
}

/* Once every part has finished, one caller — the one that moves the compose
   row on — starts the join. */
async function maybeJoin(service: SupabaseClient, videoId: string, version: number, origin: string) {
  const { data } = await service.from("video_renders").select("status").eq("video_id", videoId).eq("version", version).eq("engine", "part");
  const parts = data ?? [];
  if (!parts.length || parts.some((row) => row.status === "running" || row.status === "queued")) return;
  const { data: claimed } = await service
    .from("video_renders")
    .update({ provider: "local:joining", updated_at: new Date().toISOString() })
    .eq("video_id", videoId)
    .eq("version", version)
    .eq("engine", "compose")
    .eq("status", "running")
    .neq("provider", "local:joining")
    .select("id");
  if (!claimed?.length) return;
  if (!(await kick(origin, videoId, version, "join"))) {
    await service
      .from("video_renders")
      .update({ status: "failed", error: "The film's parts were cut but could not be joined. Export again to retry.", updated_at: new Date().toISOString() })
      .eq("video_id", videoId)
      .eq("version", version)
      .eq("engine", "compose");
  }
}

/* The parts, end to end, as one MP4 written into storage while it is made. */
async function joinParts(service: SupabaseClient, videoId: string, version: number, origin: string, failed: (error: unknown) => Promise<void>) {
  const { data: video } = await service.from("video_projects").select("id, user_id, title").eq("id", videoId).maybeSingle();
  const { data } = await service.from("video_renders").select("provider, status, output_path, error, detail").eq("video_id", videoId).eq("version", version).eq("engine", "part");
  if (!video) return failed(new Error("The video is missing."));
  const parts = (data ?? [])
    .map((row) => ({ k: partOf(row.provider as string), status: row.status as string, path: row.output_path as string | null, error: row.error as string | null }))
    .filter((row): row is { k: number; status: string; path: string | null; error: string | null } => row.k !== null)
    .sort((a, b) => a.k - b.k);
  const broken = parts.find((row) => row.status !== "done" || !row.path);
  if (!parts.length || broken) {
    return failed(new Error(broken ? `Part ${broken.k} of ${parts.length} could not be cut${broken.error ? `: ${broken.error}` : ""}. Export again to retry it.` : "The film has no parts."));
  }
  const base = `${video.user_id}/${videoId}/v${version}`;
  const urls: string[] = [];
  for (const row of parts) {
    const url = await signedUrl(service, row.path);
    if (!url) return failed(new Error(`Part ${row.k} could not be read back.`));
    urls.push(url);
  }
  const dir = `/tmp/qs-join-${videoId}-${version}-${Date.now()}`;
  await mkdir(dir, { recursive: true });
  const list = join(dir, "parts.txt");
  await writeFile(list, concatList(urls));
  const path = `${base}/final.mp4`;
  const stored = await streamToStorage({
    bucket: "video-assets",
    path,
    contentType: "video/mp4",
    make: () => ffmpegOutput(streamJoinArgs({ list }), 280_000),
  });
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  const { data: plan } = await service.from("video_versions").select("plan").eq("video_id", videoId).eq("version", version).maybeSingle();
  const scenes = ((plan?.plan as ProductionPlan | undefined)?.scenes ?? []);
  const total = scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
  await service
    .from("video_renders")
    .update({
      status: "done",
      provider: "local",
      /* One file when it could be stored; otherwise the parts, played one after another. */
      output_path: stored.ok ? `storage:${path}` : partsOutput(parts.length, base),
      error: stored.ok ? null : `Kept as ${parts.length} parts: the single file could not be stored (${stored.reason}).`.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("video_id", videoId)
    .eq("version", version)
    .eq("engine", "compose");
  /* Charged for the parts cut this time; parts reused from the last version
     are not cut, or paid for, twice. Joining is still work: at least 1 credit. */
  const details = (data ?? []).map((row) => row.detail as PartDetail | null);
  const recut = details.every(Boolean) ? details.reduce((sum, d) => sum + (d && !d.reused ? d.seconds : 0), 0) : total;
  const reusedCount = details.filter((d) => d?.reused).length;
  await chargeCut(
    service,
    video as { user_id: string; title: string },
    videoId,
    version,
    Math.max(1, recut),
    reusedCount
      ? `Video re-cut: ${parts.length - reusedCount} of ${parts.length} parts changed (${Math.max(1, Math.ceil(recut / 60))} min): ${String(video.title)}`
      : undefined,
  );
  await service.from("video_projects").update({ status: "ready" }).eq("id", videoId);
  await announceFinal(service, { videoId, version, origin, scenes: scenes.length });
}
