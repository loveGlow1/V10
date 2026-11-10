/* Uploading one file to a video, from the browser.
 *
 *   1. read it here first: its kind from its type, its length and size from
 *      the browser's own player (loadedmetadata) — refused before any byte is
 *      sent when it is too big or too long
 *   2. ask for a one-time upload address (/api/video/[id]/assets/upload-url)
 *   3. send it straight to storage on that address, with progress — never
 *      through a function body (Vercel stops those at 4.5 MB)
 *   4. register it (/api/video/[id]/assets), where the stored object's own
 *      type is checked again and its preparation starts
 *
 * Browser-only. */

import { assetKind, uploadProblem } from "./assets";

export type MediaInfo = { durationS: number | null; width: number | null; height: number | null };

/** What the browser can tell of a file before it is sent. Never throws. */
export function readMediaInfo(file: File): Promise<MediaInfo> {
  const kind = assetKind(file.type);
  const none: MediaInfo = { durationS: null, width: null, height: null };
  if (typeof document === "undefined" || kind === "file") return Promise.resolve(none);
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const done = (info: MediaInfo) => {
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = window.setTimeout(() => done(none), 15_000);
    if (kind === "image") {
      const img = new Image();
      img.onload = () => {
        window.clearTimeout(timer);
        done({ durationS: null, width: img.naturalWidth || null, height: img.naturalHeight || null });
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        done(none);
      };
      img.src = url;
      return;
    }
    const media = document.createElement(kind === "video" ? "video" : "audio");
    media.preload = "metadata";
    media.muted = true;
    media.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const video = media as HTMLVideoElement;
      done({
        durationS: Number.isFinite(media.duration) ? media.duration : null,
        width: kind === "video" ? video.videoWidth || null : null,
        height: kind === "video" ? video.videoHeight || null : null,
      });
    };
    media.onerror = () => {
      window.clearTimeout(timer);
      done(none);
    };
    media.src = url;
  });
}

function put(url: string, file: File, onProgress?: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (key) xhr.setRequestHeader("apikey", key);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

/** Uploads one file to a video. The new upload's id and kind, or why not. */
export async function uploadStudioFile(
  videoId: string,
  file: File,
  options: { role?: "product" | "person" | "photo" | "reference"; onProgress?: (fraction: number) => void } = {},
): Promise<{ ok: true; id: string; kind: string } | { ok: false; error: string }> {
  const mime = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : /\.m4a$/i.test(file.name) ? "audio/mp4" : "");
  const info = await readMediaInfo(file);
  const problem = uploadProblem({ mime, size: file.size, durationS: info.durationS });
  if (problem) return { ok: false, error: `${file.name}: ${problem}` };

  const asked = await fetch(`/api/video/${videoId}/assets/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime, size: file.size, durationS: info.durationS }),
  }).catch(() => null);
  const address = (await asked?.json().catch(() => null)) as { path?: string; signedUrl?: string; error?: string } | null;
  if (!asked?.ok || !address?.path || !address.signedUrl) return { ok: false, error: `${file.name}: ${address?.error ?? "could not start the upload."}` };

  if (!(await put(address.signedUrl, file, options.onProgress))) return { ok: false, error: `${file.name}: the upload was interrupted. Try again.` };

  const registered = await fetch(`/api/video/${videoId}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: address.path, name: file.name, mime, size: file.size, ...info, ...(options.role ? { role: options.role } : {}) }),
  }).catch(() => null);
  const body = (await registered?.json().catch(() => null)) as { id?: string; kind?: string; error?: string } | null;
  if (!registered?.ok || !body?.id) return { ok: false, error: `${file.name}: ${body?.error ?? "could not be saved."}` };
  return { ok: true, id: body.id, kind: body.kind ?? assetKind(mime) };
}
