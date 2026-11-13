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

/** A soft colour for a scene still being made, the same for the same scene every time. Pure. */
export function placeholderStyle(seed: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    backgroundImage: `radial-gradient(120% 90% at 20% 15%, hsla(${hue}, 70%, 55%, 0.45), transparent 60%), radial-gradient(100% 80% at 85% 90%, hsla(${(hue + 60) % 360}, 75%, 45%, 0.4), transparent 65%), linear-gradient(135deg, hsl(${hue}, 25%, 14%), hsl(${(hue + 40) % 360}, 30%, 9%))`,
  };
}
