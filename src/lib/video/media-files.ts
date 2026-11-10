/* Media files on this server: fetched to /tmp as a stream (a 400 MB clip is
 * never held in memory), and read by ffmpeg itself (ffmpeg-static).
 *
 * Only the routes that carry the ffmpeg binary may call inspect/runFfmpeg:
 * the cut (/render/compose) and an upload's preparation (/assets/prepare) —
 * next.config.mjs traces the binary into those two.
 *
 * Server-only. */

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

const exec = promisify(execFile);

/** Streams a URL to a file. False when it could not be fetched. */
export async function downloadTo(url: string, path: string, timeoutMs = 240_000): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok || !response.body) return false;
    await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), createWriteStream(path));
    return true;
  } catch {
    return false;
  }
}

export type Inspection = {
  seconds: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  rotation: number;
};

/** What ffmpeg's banner says about a file. Pure (tools/check-video.mjs). */
export function readInspection(text: string): Inspection {
  const duration = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;
  const videoLine = text.split("\n").find((line) => /Stream #.*Video:/.test(line) && !/attached pic/.test(line)) ?? "";
  const size = videoLine.match(/, (\d{2,5})x(\d{2,5})[ ,\[]/);
  const rotationMatch = text.match(/rotation of (-?\d+(?:\.\d+)?) degrees/) ?? text.match(/rotate\s*:\s*(-?\d+)/);
  const rotation = rotationMatch ? Math.round(Number(rotationMatch[1])) : 0;
  let width = size ? Number(size[1]) : null;
  let height = size ? Number(size[2]) : null;
  /* A phone's portrait clip is stored landscape with a rotation; it plays
     (and is prepared) upright. */
  if (width && height && Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  return { seconds: Number.isFinite(seconds) ? seconds : 0, width, height, hasVideo: Boolean(videoLine), hasAudio: /Stream #.*Audio:/.test(text), rotation };
}

export async function inspect(path: string): Promise<Inspection> {
  const result = await exec(ffmpegPath as string, ["-nostdin", "-hide_banner", "-i", path], { maxBuffer: 1 << 22, timeout: 30_000 }).catch(
    (error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }),
  );
  return readInspection(String((result as { stderr?: string }).stderr ?? ""));
}

export async function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available on this server.");
  await exec(ffmpegPath as string, ["-nostdin", ...args], { maxBuffer: 1 << 24, timeout: timeoutMs });
}

/**
 * The working copy of an uploaded clip: upright, at most 1920 on its long
 * side, 30 fps, H.264 yuv420p, AAC 48 kHz stereo — silence laid in when the
 * clip has no sound, so every clip joins the same way. Fast-start. Pure.
 */
export function workingCopyArgs(input: { source: string; out: string; hasAudio: boolean }): string[] {
  const video = "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30,format=yuv420p";
  return [
    "-hide_banner", "-y",
    "-i", input.source,
    ...(input.hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
    "-map", "0:v:0", "-map", input.hasAudio ? "0:a:0" : "1:a:0",
    "-vf", video,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    ...(input.hasAudio ? [] : ["-shortest"]),
    "-movflags", "+faststart",
    input.out,
  ];
}

/** A poster frame: a still from the clip, 480 wide. Pure. */
export function posterArgs(input: { source: string; out: string; at: number }): string[] {
  return ["-hide_banner", "-y", "-ss", Math.max(0, input.at).toFixed(2), "-i", input.source, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", input.out];
}
