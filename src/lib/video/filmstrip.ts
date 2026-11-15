/* Filmstrips for the editor's timeline, made on the server.
 *
 * The timeline used to take its frames in the browser (a hidden <video>,
 * seek, draw to canvas). iPhones do not load a video that way until it is
 * played, and a storage link may not allow the canvas to be read, so cards
 * sat on a spinner over a coloured placeholder. Here ffmpeg takes the frames
 * straight from the clip's link — only the bytes around each moment — and
 * lays them side by side in one small JPEG, kept in storage so the same strip
 * is never made twice. The card shows it as a CSS sprite, which every browser
 * draws at once.
 *
 * Server-only. The route that calls it carries the ffmpeg binary
 * (next.config.mjs). */

import { createHash } from "node:crypto";

/** Frames in one strip at most, and the strip's height in pixels. */
export const MAX_STRIP_FRAMES = 12;
export const STRIP_HEIGHT = 120;

/** Where each frame of a strip is taken, centred in its slice of [from, from + seconds]. Pure. */
export function stripTimes(count: number, from: number, seconds: number): number[] {
  const n = Math.max(1, Math.min(MAX_STRIP_FRAMES, Math.round(count) || 1));
  const a = Math.max(0, Number(from) || 0);
  const d = Math.max(0.2, Number(seconds) || 3);
  return Array.from({ length: n }, (_, i) => Math.round((a + Math.max(0.1, ((i + 0.5) / n) * d)) * 100) / 100);
}

/** The tallest still asked for (the player's own, at full size). */
export const MAX_STILL_HEIGHT = 720;

/** A strip's height in pixels: STRIP_HEIGHT unless a single still asks for more, up to MAX_STILL_HEIGHT. Pure. */
export function stripHeight(asked: unknown, count: number): number {
  const h = Math.round(Number(asked));
  if (count !== 1 || !(h > STRIP_HEIGHT)) return STRIP_HEIGHT;
  return Math.min(MAX_STILL_HEIGHT, h);
}

/** ffmpeg: one frame at a moment, `height` tall (STRIP_HEIGHT by default), its own width. Pure. */
export function frameArgs(input: { url: string; at: number; out: string; height?: number }): string[] {
  const q = (input.height ?? STRIP_HEIGHT) > STRIP_HEIGHT ? "3" : "6";
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", input.at.toFixed(2), "-i", input.url, "-frames:v", "1", "-vf", `scale=-2:${input.height ?? STRIP_HEIGHT}`, "-q:v", q, input.out];
}

/** ffmpeg: numbered frames side by side, one row. Pure. */
export function rowArgs(input: { pattern: string; count: number; out: string }): string[] {
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input.pattern, "-vf", `tile=${input.count}x1`, "-q:v", "6", input.out];
}

/** The storage path inside the video-assets bucket that a signed link points at, or null. Pure. */
export function storagePathOf(url: string): string | null {
  const m = /\/storage\/v1\/object\/(?:sign|public)\/video-assets\/([^?#]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Where a strip is kept: the same clip, moment and frame count give the same file. Pure. */
export function stripPath(userId: string, videoId: string, source: string, times: number[], height = STRIP_HEIGHT): string {
  const hash = createHash("sha1").update(`${source}|${times.join(",")}${height === STRIP_HEIGHT ? "" : `|h${height}`}`).digest("hex").slice(0, 24);
  return `${userId}/${videoId}/strips/${hash}.jpg`;
}
