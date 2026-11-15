"use client";

/* A still from every made clip, for the timeline's filmstrips and the scene
 * list. A generated scene has no poster of its own — only an upload does —
 * so a frame is taken from the clip itself, here in the browser: the clip is
 * loaded off screen, a third of the way in (a clip's first frame is often
 * still black or mid-fade), drawn into a small canvas and kept as a JPEG.
 *
 * Two at a time, cached for the tab, so scrolling, reordering and every
 * save show the same picture at once. A clip that cannot be read (a network
 * failure, a storage link that does not allow it) simply has no still. */

import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();
let running = 0;
const queue: (() => void)[] = [];

/* The storage link changes on every load (it is signed); the file does not. */
const keyOf = (url: string) => url.split("?")[0];

function next() {
  if (running >= 2) return;
  const job = queue.shift();
  if (job) job();
}

function capture(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const run = () => {
      running += 1;
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      let settled = false;
      const done = (still: string | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        video.removeAttribute("src");
        video.load();
        running -= 1;
        resolve(still);
        next();
      };
      const timer = window.setTimeout(() => done(null), 20_000);
      video.addEventListener("loadedmetadata", () => {
        const at = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(1.5, video.duration / 3) : 0.5;
        video.currentTime = at;
      });
      video.addEventListener("seeked", () => {
        try {
          const height = 180;
          const width = Math.max(1, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * height));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
          done(canvas.toDataURL("image/jpeg", 0.72));
        } catch {
          done(null);
        }
      });
      video.addEventListener("error", () => done(null));
      video.src = url;
    };
    queue.push(run);
    next();
  });
}

/** A still for each clip url, keyed by the url. Missing until it is ready. */
export function useClipPosters(urls: (string | null | undefined)[]): Map<string, string> {
  const [, setVersion] = useState(0);
  const wanted = [...new Set(urls.filter((u): u is string => Boolean(u)))];
  const signature = wanted.map(keyOf).join("|");

  useEffect(() => {
    let alive = true;
    for (const url of wanted) {
      const key = keyOf(url);
      if (cache.has(key) || inFlight.has(key)) continue;
      const job = capture(url).then((still) => {
        cache.set(key, still);
        inFlight.delete(key);
        if (alive) setVersion((v) => v + 1);
        return still;
      });
      inFlight.set(key, job);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const out = new Map<string, string>();
  for (const url of wanted) {
    const still = cache.get(keyOf(url));
    if (still) out.set(url, still);
  }
  return out;
}

/* ── Filmstrips ──────────────────────────────────────────────────────────
 * Several stills along each clip, so a clip on the timeline reads as a strip
 * of film — the picture changing from its start to its end — rather than one
 * frame repeated. Taken in one pass per clip (seek, draw, seek on), one clip
 * at a time, cached for the tab like the single stills. */

const strips = new Map<string, string[] | null>();
const stripsInFlight = new Set<string>();
const stripQueue: (() => Promise<void>)[] = [];
let stripRunning = false;

async function drainStrips() {
  if (stripRunning) return;
  stripRunning = true;
  while (stripQueue.length) await stripQueue.shift()!().catch(() => {});
  stripRunning = false;
}

function seekTo(video: HTMLVideoElement, at: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => done(false), 8000);
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    const onError = () => done(false);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = at;
  });
}

async function captureStrip(url: string, count: number): Promise<string[] | null> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const ready = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 20_000);
      video.addEventListener("loadedmetadata", () => { window.clearTimeout(timer); resolve(true); }, { once: true });
      video.addEventListener("error", () => { window.clearTimeout(timer); resolve(false); }, { once: true });
      video.src = url;
    });
    if (!ready || !(video.duration > 0)) return null;
    const height = 120;
    const width = Math.max(1, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const frames: string[] = [];
    for (let i = 0; i < count; i += 1) {
      /* Centred in each slice, and never the very first frame (often black). */
      const at = Math.min(video.duration - 0.05, Math.max(0.15, ((i + 0.5) / count) * video.duration));
      if (!(await seekTo(video, at))) break;
      context.drawImage(video, 0, 0, width, height);
      frames.push(canvas.toDataURL("image/jpeg", 0.68));
    }
    return frames.length ? frames : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/** Several stills along each clip, keyed by the clip's url. Missing until ready. */
export function useClipStrips(urls: (string | null | undefined)[], count = 8): Map<string, string[]> {
  const [, setVersion] = useState(0);
  const wanted = [...new Set(urls.filter((u): u is string => Boolean(u)))];
  const signature = wanted.map(keyOf).join("|");

  useEffect(() => {
    let alive = true;
    for (const url of wanted) {
      const key = keyOf(url);
      if (strips.has(key) || stripsInFlight.has(key)) continue;
      stripsInFlight.add(key);
      stripQueue.push(async () => {
        const frames = await captureStrip(url, count);
        strips.set(key, frames);
        stripsInFlight.delete(key);
        if (alive) setVersion((v) => v + 1);
      });
    }
    void drainStrips();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, count]);

  const out = new Map<string, string[]>();
  for (const url of wanted) {
    const frames = strips.get(keyOf(url));
    if (frames?.length) out.set(url, frames);
  }
  return out;
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
