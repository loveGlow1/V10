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

import type { Cut, ProductionPlan, Scene } from "./plan";
import { exportPath, exportsFor, type ExportKind } from "./exports";
import { announceFinal } from "./announce";
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

/* How the cut is put together, from the plan's own settings (plan.cut) and
   what the video is. Pure. */
export function cutFor(plan: Pick<ProductionPlan, "scenes" | "cut">): Required<Pick<Cut, "audio" | "captions">> & Pick<Cut, "endCard"> & { muted: Set<number> } {
  const narrated = plan.scenes.some((scene) => scene.voiceover.trim());
  return {
    audio: plan.cut?.audio ?? (narrated ? "voiceover" : "original"),
    captions: plan.cut?.captions ?? true,
    endCard: plan.cut?.endCard,
    muted: new Set(plan.cut?.muted ?? []),
  };
}

/* How long a scene runs and how its clip fills it. A scene lasts as long as
   it must — its planned length, its voice line's when that is longer, the
   clip's own when its own sound is what is heard — and a clip shorter than
   that is slowed to fit (up to 1.4×, which reads as natural motion) before
   its last frame is held. Pure. */
export function sceneTiming(input: { planned: number; clip: number; voice: number; ownSound: boolean }): { seconds: number; stretch: number } {
  const clip = input.clip > 0 ? input.clip : input.planned;
  let seconds = Math.max(1, input.planned || 3);
  if (input.voice) seconds = Math.max(seconds, input.voice + 0.45);
  if (input.ownSound) seconds = Math.max(seconds, clip);
  seconds = Math.round(seconds * 1000) / 1000;
  const stretch = Math.min(1.4, Math.max(1, seconds / clip));
  return { seconds, stretch };
}

/** The video filter for one scene. Pure. */
export function sceneFilter(input: {
  width: number;
  height: number;
  seconds: number;
  stretch?: number;
  /** A title card's words, set large on a darkened screen. */
  title?: string | null;
  /** Words at the top of the frame: the scene's on-screen text, or the end card. */
  headline?: string | null;
  /** The spoken line, as a caption band. */
  caption?: string | null;
  fontPath: string;
  dir: string;
  n: number;
}): string {
  const { width, height, seconds } = input;
  const small = Math.min(width, height);
  const parts = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "setsar=1",
    ...(input.stretch && input.stretch > 1.001 ? [`setpts=PTS*${input.stretch.toFixed(4)}`] : []),
    "fps=30",
    `tpad=stop_mode=clone:stop_duration=${seconds}`,
  ];
  const file = (kind: string) => `${input.dir}/${kind}-${input.n}.txt`;
  if (input.title) {
    parts.push("drawbox=x=0:y=0:w=iw:h=ih:color=black@0.97:t=fill");
    parts.push(`drawtext=fontfile=${input.fontPath}:textfile=${file("title")}:fontcolor=white:fontsize=${Math.round(small * 0.085)}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`);
  }
  if (input.headline) {
    parts.push(
      `drawtext=fontfile=${input.fontPath}:textfile=${file("headline")}:fontcolor=white:fontsize=${Math.round(small * 0.055)}:x=(w-text_w)/2:y=h*0.11:box=1:boxcolor=black@0.55:boxborderw=${Math.round(small * 0.02)}:line_spacing=8`,
    );
  }
  if (input.caption) {
    parts.push(
      `drawtext=fontfile=${input.fontPath}:textfile=${file("caption")}:fontcolor=white:fontsize=${Math.round(small * 0.058)}:x=(w-text_w)/2:y=h*0.80-text_h/2:box=1:boxcolor=black@0.72:boxborderw=${Math.round(small * 0.024)}:line_spacing=10`,
    );
  }
  const fade = Math.min(0.2, seconds / 6);
  parts.push(`fade=t=in:st=0:d=${fade}`, `fade=t=out:st=${(seconds - fade).toFixed(2)}:d=${fade}`);
  return parts.join(",");
}

/* The ffmpeg arguments for one scene: its picture through `filter`, its
   sound the voice line over the clip's own sound (when that is heard) or
   over silence. Pure. */
export function sceneArgs(input: { clipPath: string; voicePath: string | null; ownSound: boolean; seconds: number; stretch: number; filter: string; out: string }): string[] {
  const { seconds, stretch } = input;
  const hasVoice = Boolean(input.voicePath);
  const args = ["-hide_banner", "-y", "-i", input.clipPath, "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=44100:cl=stereo"];
  if (input.voicePath) args.push("-i", input.voicePath);
  const tempo = stretch > 1.001 ? `,atempo=${(1 / stretch).toFixed(4)}` : "";
  const bed = input.ownSound ? `[0:a]aformat=sample_rates=44100:channel_layouts=stereo${tempo},volume=${hasVoice ? 0.22 : 0.9},apad[bed]` : `[1:a]anull[bed]`;
  const fadeOut = `afade=t=out:st=${Math.max(0, seconds - 0.3).toFixed(2)}:d=0.3`;
  const audio = hasVoice
    ? `${bed};[2:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.5,adelay=150|150,apad[vo];[bed][vo]amix=inputs=2:duration=first:normalize=0[mix];[mix]atrim=0:${seconds},${fadeOut}[a]`
    : `${bed};[bed]atrim=0:${seconds},${fadeOut}[a]`;
  args.push(
    "-filter_complex", `[0:v]${input.filter}[v];${audio}`,
    "-map", "[v]", "-map", "[a]",
    "-t", String(seconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
    input.out,
  );
  return args;
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
export async function composeLocally(service: SupabaseClient, videoId: string, version: number, origin: string): Promise<void> {
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
    const cut = cutFor(plan);
    const last = plan.scenes[plan.scenes.length - 1]?.n;

    for (const scene of plan.scenes) {
      const talking = pick(scene.n, "avatar");
      const picture = talking ?? pick(scene.n, "video");
      const pictureUrl = picture ? await signedUrl(service, picture.output_path) : null;
      if (!pictureUrl) continue;
      const clipPath = join(dir, `clip-${scene.n}.mp4`);
      if (!(await download(pictureUrl, clipPath))) continue;
      const clip = await probe(clipPath);

      /* The script's voice, unless the cut is the clips' own sound. A
         lip-synced clip already carries its line. */
      const voice = talking || cut.audio === "original" || cut.audio === "none" ? null : pick(scene.n, "voice");
      const voiceUrl = voice ? await signedUrl(service, voice.output_path) : null;
      const voicePath = join(dir, `voice-${scene.n}.mp3`);
      const hasVoice = Boolean(voiceUrl && (await download(voiceUrl, voicePath)));
      const voiceSeconds = hasVoice ? (await probe(voicePath)).seconds : 0;

      /* A clip's own sound is the video model's: room tone at best, at worst
         lines it made up or mumbled words in no language. It is heard only
         when the cut asks for it (original, or mixed under the voice) and
         the scene is not muted; a lip-synced clip's sound is the voice line
         itself and always stays. */
      const ownSound = clip.audio && cut.audio !== "none" && !cut.muted.has(scene.n) && (Boolean(talking) || cut.audio !== "voiceover");
      const { seconds, stretch } = sceneTiming({ planned: Number(scene.duration) || 3, clip: clip.seconds, voice: voiceSeconds, ownSound: Boolean(ownSound) && !hasVoice });

      /* Words on the frame, set here in clean type — a video model garbles
         lettering. A title card is large on a dark screen; otherwise the
         spoken line is the caption and the scene's own words, or the end
         card, sit at the top. */
      const titleCard = isTitleCard(scene) && Boolean(scene.onScreenText?.trim());
      /* A silent cut keeps the script as captions: muted is how most people
         watch, and the words are what carries it. */
      const spoken = cut.captions && (hasVoice || cut.audio === "none") ? scene.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "").trim() : "";
      const headlineText = scene.n === last && cut.endCard ? cut.endCard : !titleCard && scene.onScreenText?.trim() && scene.onScreenText.trim() !== spoken ? scene.onScreenText.trim() : "";
      const texts: Record<string, string> = {};
      if (titleCard) texts.title = wrap(scene.onScreenText, width, true);
      if (headlineText) texts.headline = wrap(headlineText, width, false);
      if (spoken) texts.caption = wrap(spoken, width, false);
      for (const [kind, value] of Object.entries(texts)) await writeFile(join(dir, `${kind}-${scene.n}.txt`), value);
      const ready = Boolean(fontPath);

      const out = join(dir, `scene-${scene.n}.mp4`);
      const args = sceneArgs({
        clipPath,
        voicePath: hasVoice ? voicePath : null,
        ownSound: Boolean(ownSound),
        seconds,
        stretch,
        out,
        filter: sceneFilter({
          width,
          height,
          seconds,
          stretch,
          title: ready ? texts.title : null,
          headline: ready ? texts.headline : null,
          caption: ready ? texts.caption : null,
          fontPath: fontPath ?? "",
          dir,
          n: scene.n,
        }),
      });
      await exec(ffmpegPath as string, args, { maxBuffer: 1 << 24, timeout: 120_000 });
      segments.push(out);
    }

    if (!segments.length) throw new Error("No scene had a clip to put in the cut.");
    const list = join(dir, "list.txt");
    await writeFile(list, segments.map((path) => `file '${path}'`).join("\n"));
    const final = join(dir, "final.mp4");
    const joined = join(dir, "joined.mp4");
    await exec(ffmpegPath as string, ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined], { maxBuffer: 1 << 24, timeout: 120_000 });
    /* One loudness for the whole video, at the level social apps play at
       (-14 LUFS), so it is neither quieter nor louder than what is around it.
       The picture is copied, not encoded again. */
    /* A silent cut has nothing to level; its track stays silence. */
    await exec(
      ffmpegPath as string,
      cut.audio === "none"
        ? ["-hide_banner", "-y", "-i", joined, "-c", "copy", "-movflags", "+faststart", final]
        : ["-hide_banner", "-y", "-i", joined, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", final],
      { maxBuffer: 1 << 24, timeout: 120_000 },
    );

    const path = `${video.user_id}/${videoId}/v${version}/final.mp4`;
    const { error } = await service.storage.from("video-assets").upload(path, await readFile(final), { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`The MP4 could not be stored: ${error.message}`);

    /* The ready-to-post versions, beside the cut. One that fails is left
       out; the cut itself is already made. */
    const total = (await probe(final)).seconds;
    for (const kind of exportsFor(plan.aspect)) {
      try {
        const out = join(dir, `final-${kind}.mp4`);
        await exec(ffmpegPath as string, exportArgs(kind, { source: final, out, seconds: total, width, height }), { maxBuffer: 1 << 24, timeout: 120_000 });
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
