"use client";

/* Stills and filmstrips for the editor's timeline and scene list, made on
 * the server (lib/video/filmstrip.ts), and the colour of a scene still to be
 * made. The frames used to be taken here in the browser, which an iPhone
 * does not allow (it loads no video it is not playing): cards spun forever. */

/* ── Made on the server ─────────────────────────────────────────────────
 * The browser cannot be relied on to read a clip's frames (an iPhone does
 * not load a video it is not playing), so the timeline asks the server for
 * them instead (/api/video/[id]/strip, lib/video/filmstrip.ts): `count`
 * frames along the part of the clip on screen, side by side in one JPEG,
 * shown as a sprite — every browser draws it at once. */

/** Frames in a timeline strip. */
export const STRIP_FRAMES = 8;

/** The server-made strip (or, with count 1, the still) of a clip's [from, from + seconds]. Pure. */
export function stripUrl(videoId: string, src: string, input: { count?: number; from?: number; seconds?: number; height?: number } = {}): string {
  const r = (v: number) => Math.round(Math.max(0, v) * 10) / 10;
  const q = new URLSearchParams({ src, n: String(input.count ?? STRIP_FRAMES), a: String(r(input.from ?? 0)), d: String(r(input.seconds ?? 3) || 3) });
  /* Taller for the player's own still; the timeline's strips stay small. */
  if (input.height) q.set("h", String(Math.round(input.height)));
  return `/api/video/${videoId}/strip?${q.toString()}`;
}

/** CSS for frame `index` of a `count`-frame sprite, filling its tile. Pure. */
export function spriteFrame(url: string, index: number, count: number): React.CSSProperties {
  const at = count > 1 ? (Math.max(0, Math.min(count - 1, index)) / (count - 1)) * 100 : 50;
  return { backgroundImage: `url("${url}")`, backgroundSize: `${count * 100}% 100%`, backgroundPosition: `${at}% 0`, backgroundRepeat: "no-repeat" };
}

/** A soft colour for a scene still being made, the same for the same scene every time. Pure. */
export function placeholderStyle(seed: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    backgroundImage: `radial-gradient(120% 90% at 20% 15%, hsla(${hue}, 70%, 55%, 0.45), transparent 60%), radial-gradient(100% 80% at 85% 90%, hsla(${(hue + 60) % 360}, 75%, 45%, 0.4), transparent 65%), linear-gradient(135deg, hsl(${hue}, 25%, 14%), hsl(${(hue + 40) % 360}, 30%, 9%))`,
  };
}
