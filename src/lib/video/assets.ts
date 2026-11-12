/* What a person can bring into the video studio: their own clips, sound and
 * pictures — and how each is described to everything that plans or cuts.
 *
 *   kind        from the MIME type, on the client AND again on the server
 *               from the stored object's own content type
 *   limits      a clip up to 400 MB and an hour (it is prepared in a
 *               function whose /tmp holds 512 MB; one over three minutes is
 *               read as it is, with no working copy), sound up to 50 MB, a
 *               picture up to 20 MB
 *   manifest    the ATTACHMENTS block the Creative Director and the editor
 *               read before anything else, so nothing is ever assumed about
 *               what was or was not attached
 *
 * Pure: read by the browser (the studio's upload) and by the server. */

export type UploadKind = "video" | "audio" | "image" | "file";

/** The kind of an upload, from its MIME type. Pure. */
export function assetKind(mime: string | null | undefined): UploadKind {
  const m = (mime ?? "").toLowerCase();
  return m.startsWith("video/") ? "video" : m.startsWith("audio/") ? "audio" : m.startsWith("image/") ? "image" : "file";
}

/** What the file input accepts. */
export const ACCEPTED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_TYPES, ".mov", ".m4a", ".mp3", ".wav"].join(",");

export const LIMITS = {
  video: { bytes: 400 * 1024 * 1024, seconds: 3600 },
  audio: { bytes: 50 * 1024 * 1024, seconds: 600 },
  image: { bytes: 20 * 1024 * 1024, seconds: 0 },
} as const;

/** How many uploads one video holds. */
export const MAX_UPLOADS = 30;
/** The longest stitched cut this studio makes in one go (seconds). */
export const MAX_CUT_SECONDS = 60 * 60;

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Why an upload is refused, or null when it is fine. Pure. */
export function uploadProblem(input: { mime: string; size: number; durationS?: number | null }): string | null {
  const kind = assetKind(input.mime);
  if (kind === "file") return "Upload a video (MP4, MOV, WebM), a sound file (MP3, WAV, M4A) or a picture (PNG, JPG, WebP).";
  const limit = LIMITS[kind];
  if (input.size > limit.bytes) return `${kind === "video" ? "Clips" : kind === "audio" ? "Sound files" : "Pictures"} can be up to ${mb(limit.bytes)}; this one is ${mb(input.size)}.`;
  if (input.size <= 0) return "That file is empty.";
  if (limit.seconds && input.durationS && input.durationS > limit.seconds + 0.5) {
    return kind === "video"
      ? `Clips can be up to ${limit.seconds / 60} minutes; this one runs ${formatSeconds(input.durationS)}. Trim it first, or split it into parts.`
      : `Sound files can be up to ${limit.seconds / 60} minutes.`;
  }
  return null;
}

/** "1:05", "0:07". Pure. */
export function formatSeconds(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The file's extension for its storage path, from its type first. Pure. */
export function extensionFor(mime: string, name: string): string {
  const byType: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-m4v": "m4v",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const fromName = name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  return byType[mime.toLowerCase()] ?? fromName ?? "bin";
}

/** An asset as the plan, the cut and the studio see it. */
export type StudioAsset = {
  id: string;
  kind: string;
  name: string;
  mime: string;
  status: "processing" | "ready" | "failed";
  durationS: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
};

/** An upload is media the timeline can use: a clip, a picture or sound. */
export const isTimelineMedia = (asset: Pick<StudioAsset, "kind">) => ["video", "image", "photo", "product", "person", "reference"].includes(asset.kind);

/**
 * The ATTACHMENTS block, word for word, before the person's own message.
 * Authoritative: with "video x0" nobody may claim to see a video. Pure.
 */
export function attachmentManifest(assets: StudioAsset[]): string {
  const usable = assets.filter((a) => a.status !== "failed" && a.kind !== "render");
  const videos = usable.filter((a) => a.kind === "video");
  const audios = usable.filter((a) => a.kind === "audio");
  const images = usable.filter((a) => a.kind !== "video" && a.kind !== "audio");
  const entry = (a: StudioAsset) =>
    `{assetId: "${a.id}", name: "${a.name.replace(/"/g, "'").slice(0, 60)}"${a.durationS ? `, durationS: ${Math.round(a.durationS * 10) / 10}` : ""}${a.width && a.height ? `, ${a.width}x${a.height}` : ""}${a.kind === "video" && a.hasAudio === false ? ", silent" : ""}${a.kind !== "video" && a.kind !== "audio" && a.kind !== "image" ? `, role: ${a.kind}` : ""}}`;
  return [
    "ATTACHMENTS (authoritative, do not infer from the text):",
    `- video x${videos.length}: [${videos.map(entry).join(", ")}]`,
    `- audio x${audios.length}: [${audios.map(entry).join(", ")}]`,
    `- image x${images.length}: [${images.map(entry).join(", ")}]`,
    ...(videos.length === 0 ? ["If video x0, the user has NOT attached a video. Never claim to see one."] : []),
  ].join("\n");
}

export type AttachmentIntent = "STITCH" | "LIPSYNC_VIDEO" | "EDIT" | "AVATAR" | "GENERATE";

/** What a message asks of what is attached. Pure. */
export function attachmentIntent(message: string, assets: Pick<StudioAsset, "kind" | "status">[]): AttachmentIntent {
  const usable = assets.filter((a) => a.status !== "failed" && a.kind !== "render");
  const video = usable.some((a) => a.kind === "video");
  const audio = usable.some((a) => a.kind === "audio");
  const face = usable.some((a) => a.kind === "person" || a.kind === "image" || a.kind === "photo");
  const m = message.toLowerCase();
  if (video && /\b(lip ?sync|dub|make (him|her|them|it|me) say|mouth)\b/.test(m)) return "LIPSYNC_VIDEO";
  if (video && /\b(stitch|join|combine|merge|put together|add to|sequence|montage|compile)\b/.test(m)) return "STITCH";
  if (video && /\b(trim|cut|shorten|replace (the )?(audio|sound|music)|music|mute|speed|slow)\b/.test(m)) return "EDIT";
  if (face && !video && (audio || /\b(say|says|script|talk|speak|read)\b/.test(m))) return "AVATAR";
  if (video) return "STITCH";
  return "GENERATE";
}
