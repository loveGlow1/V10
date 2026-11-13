/* Video settings — every choice about how the final cut is put together,
 * kept in the plan (plan.cut) so changing one never films anything again:
 * the clips and voice lines carry over and only the cut is made anew.
 *
 *   picture   shape, resolution, frame rate, how a clip fills the frame,
 *             colour, quality
 *   joins     the transition between scenes and how long it takes, a fade
 *             in at the start and out at the end
 *   sound     what is heard (voice-over, the clips' own sound, both, none),
 *             each level on its own, the music (made, your own file, none),
 *             ducking under the voice, one loudness for the whole video
 *   words     captions on or off, where, how big, in which style; the end card
 *   stills    how a picture moves while it is on screen
 *
 * One option list per setting, read by the studio's settings panel (labels),
 * by normalizeCut (what is allowed) and by the cut (resolveCut: the value
 * with its default). Pure: browser and server. */

import type { Cut, ProductionPlan } from "./plan";

export const ASPECTS = ["9:16", "1:1", "16:9", "4:5"] as const;
export const RESOLUTIONS = ["720p", "1080p"] as const;
export const FRAME_RATES = [24, 25, 30, 60] as const;
export const FITS = ["fill", "fit-blur", "fit-black"] as const;
export const COLORS = ["none", "vivid", "warm", "cool", "cinematic", "mono", "vintage"] as const;
export const QUALITIES = ["standard", "high"] as const;
export const TRANSITIONS = ["cut", "dip", "crossfade", "fadeblack", "fadewhite", "wipeleft", "slideleft", "slideup", "zoomin", "circleopen", "dissolve"] as const;
export const AUDIO_MODES = ["voiceover", "original", "mix", "none"] as const;
export const MUSIC_SOURCES = ["generate", "upload", "none"] as const;
export const CAPTION_POSITIONS = ["bottom", "middle", "top"] as const;
export const CAPTION_SIZES = ["small", "medium", "large"] as const;
export const CAPTION_STYLES = ["box", "outline", "highlight"] as const;
export const STILL_MOTIONS = ["zoom-in", "zoom-out", "pan", "none"] as const;

export type Resolution = (typeof RESOLUTIONS)[number];
export type FrameRate = (typeof FRAME_RATES)[number];
export type Fit = (typeof FITS)[number];
export type ColorGrade = (typeof COLORS)[number];
export type Quality = (typeof QUALITIES)[number];
export type Transition = (typeof TRANSITIONS)[number];
export type MusicSource = (typeof MUSIC_SOURCES)[number];
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export type CaptionSize = (typeof CAPTION_SIZES)[number];
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type StillMotion = (typeof STILL_MOTIONS)[number];

/* What each choice is called on screen. */
export const LABELS = {
  aspect: { "9:16": "Vertical 9:16", "1:1": "Square 1:1", "16:9": "Landscape 16:9", "4:5": "Portrait 4:5" },
  resolution: { "720p": "720p (faster)", "1080p": "1080p Full HD" },
  fps: { 24: "24 fps (film)", 25: "25 fps", 30: "30 fps", 60: "60 fps (smooth)" },
  fit: { fill: "Fill the frame (crop edges)", "fit-blur": "Fit, blurred background", "fit-black": "Fit, black bars" },
  color: { none: "Natural", vivid: "Vivid", warm: "Warm", cool: "Cool", cinematic: "Cinematic", mono: "Black & white", vintage: "Vintage" },
  quality: { standard: "Standard", high: "High (bigger file)" },
  transition: {
    cut: "Hard cut",
    dip: "Quick dip",
    crossfade: "Crossfade",
    fadeblack: "Fade through black",
    fadewhite: "Fade through white",
    wipeleft: "Wipe",
    slideleft: "Slide",
    slideup: "Slide up",
    zoomin: "Zoom",
    circleopen: "Circle reveal",
    dissolve: "Dissolve",
  },
  audio: { voiceover: "Voice-over only", original: "Clips' own sound", mix: "Voice-over + clips' sound", none: "No sound" },
  music: { generate: "Make music for it", upload: "My own audio file", none: "No music" },
  captionPosition: { bottom: "Bottom", middle: "Middle", top: "Top" },
  captionSize: { small: "Small", medium: "Medium", large: "Large" },
  captionStyle: { box: "White on a dark box", outline: "White with outline", highlight: "Bold yellow" },
  stillMotion: { "zoom-in": "Slow zoom in", "zoom-out": "Slow zoom out", pan: "Gentle pan", none: "Hold still" },
} as const;

export type ResolvedCut = {
  aspect: ProductionPlan["aspect"];
  resolution: Resolution;
  fps: FrameRate;
  fit: Fit;
  color: ColorGrade;
  quality: Quality;
  transition: Transition;
  transitionSeconds: number;
  fadeIn: boolean;
  fadeOut: boolean;
  audio: NonNullable<Cut["audio"]>;
  originalVolume: number;
  voiceVolume: number;
  musicVolume: number;
  duck: boolean;
  loudness: boolean;
  music: { source: MusicSource; assetId?: string; start: number };
  captions: boolean;
  captionPosition: CaptionPosition;
  captionSize: CaptionSize;
  captionStyle: CaptionStyle;
  stillMotion: StillMotion;
  endCard?: string;
  brandMark?: Cut["brandMark"];
  muted: Set<number>;
};

const pick = <T extends string | number>(list: readonly T[], value: unknown): T | undefined => (list as readonly unknown[]).includes(value) ? (value as T) : undefined;
const level = (value: unknown, max = 2): number | undefined => {
  const n = Number(value);
  return value !== undefined && value !== null && value !== "" && Number.isFinite(n) ? Math.round(Math.min(max, Math.max(0, n)) * 100) / 100 : undefined;
};

/** The settings part of a cut as written by a person or a model, anything unknown dropped. Pure. */
export function normalizeSettings(r: Record<string, unknown>): Partial<Cut> {
  const out: Partial<Cut> = {};
  const set = <K extends keyof Cut>(key: K, value: Cut[K] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  set("resolution", pick(RESOLUTIONS, r.resolution));
  set("fps", pick(FRAME_RATES, Number(r.fps)));
  set("fit", pick(FITS, r.fit));
  set("color", pick(COLORS, r.color));
  set("quality", pick(QUALITIES, r.quality));
  set("transition", pick(TRANSITIONS, r.transition));
  const seconds = Number(r.transitionSeconds);
  if (r.transitionSeconds !== undefined && Number.isFinite(seconds)) out.transitionSeconds = Math.round(Math.min(2, Math.max(0.1, seconds)) * 100) / 100;
  if (typeof r.fadeIn === "boolean") out.fadeIn = r.fadeIn;
  if (typeof r.fadeOut === "boolean") out.fadeOut = r.fadeOut;
  set("originalVolume", level(r.originalVolume));
  set("voiceVolume", level(r.voiceVolume));
  set("musicVolume", level(r.musicVolume));
  if (typeof r.duck === "boolean") out.duck = r.duck;
  if (typeof r.loudness === "boolean") out.loudness = r.loudness;
  if (r.music && typeof r.music === "object") {
    const m = r.music as Record<string, unknown>;
    const source = pick(MUSIC_SOURCES, m.source);
    const assetId = typeof m.assetId === "string" && /^[0-9a-f-]{36}$/i.test(m.assetId) ? m.assetId : undefined;
    const start = Number(m.start);
    if (source && (source !== "upload" || assetId)) out.music = { source, ...(source === "upload" ? { assetId } : {}), ...(Number.isFinite(start) && start > 0 ? { start: Math.min(3600, start) } : {}) };
  }
  set("captionPosition", pick(CAPTION_POSITIONS, r.captionPosition));
  set("captionSize", pick(CAPTION_SIZES, r.captionSize));
  set("captionStyle", pick(CAPTION_STYLES, r.captionStyle));
  set("stillMotion", pick(STILL_MOTIONS, r.stillMotion));
  return out;
}

/** The default transition: a quick dip as before, a crossfade for stitched footage. Pure. */
export const defaultTransition = (plan: Pick<ProductionPlan, "pipeline">): Transition => (plan.pipeline === "clip_edit" ? "crossfade" : "dip");

/** Every setting with its value — the person's, else its default. Pure. */
export function resolveCut(plan: Pick<ProductionPlan, "scenes" | "cut" | "aspect" | "pipeline" | "music">): ResolvedCut {
  const cut = plan.cut ?? {};
  const narrated = plan.scenes.some((scene) => scene.voiceover.trim());
  const transition = cut.transition ?? defaultTransition(plan);
  const wantsMusic = Boolean(plan.music) && !/^(none|no music)$/i.test(plan.music.trim());
  return {
    aspect: plan.aspect,
    resolution: cut.resolution ?? "720p",
    fps: cut.fps ?? 30,
    fit: cut.fit ?? (plan.scenes.some((scene) => scene.source) ? "fit-blur" : "fill"),
    color: cut.color ?? "none",
    quality: cut.quality ?? "standard",
    transition,
    transitionSeconds: cut.transitionSeconds ?? (transition === "dip" ? 0.2 : 0.5),
    fadeIn: cut.fadeIn ?? false,
    fadeOut: cut.fadeOut ?? plan.pipeline === "clip_edit",
    audio: cut.audio ?? (narrated ? "voiceover" : "original"),
    originalVolume: cut.originalVolume ?? 1,
    voiceVolume: cut.voiceVolume ?? 1,
    musicVolume: cut.musicVolume ?? 1,
    duck: cut.duck ?? true,
    loudness: cut.loudness ?? true,
    music: { source: cut.music?.source ?? (wantsMusic ? "generate" : "none"), assetId: cut.music?.assetId, start: cut.music?.start ?? 0 },
    captions: cut.captions ?? true,
    captionPosition: cut.captionPosition ?? "bottom",
    captionSize: cut.captionSize ?? "medium",
    captionStyle: cut.captionStyle ?? "box",
    stillMotion: cut.stillMotion ?? "zoom-in",
    endCard: cut.endCard,
    brandMark: cut.brandMark,
    muted: new Set(cut.muted ?? []),
  };
}

/** The frame a cut is made at, from its shape and resolution. Even sizes. Pure. */
export function frameSize(aspect: string, resolution: Resolution): [number, number] {
  const short = resolution === "1080p" ? 1080 : 720;
  const even = (n: number) => Math.round(n / 2) * 2;
  if (aspect === "9:16") return [short, even((short * 16) / 9)];
  if (aspect === "1:1") return [short, short];
  if (aspect === "4:5") return [short, even((short * 5) / 4)];
  return [even((short * 16) / 9), short];
}

/** How the editor's preview shows each grade (CSS filter) — close to colorFilter's ffmpeg. */
export const COLOR_CSS: Record<ColorGrade, string> = {
  none: "",
  vivid: "saturate(1.35) contrast(1.06)",
  warm: "sepia(0.18) saturate(1.1)",
  cool: "hue-rotate(-8deg) saturate(0.95)",
  cinematic: "contrast(1.1) saturate(0.88)",
  mono: "grayscale(1) contrast(1.08)",
  vintage: "sepia(0.35) saturate(0.85)",
};

/** The ffmpeg filter for a colour grade, or "". Pure. */
export function colorFilter(color: ColorGrade): string {
  switch (color) {
    case "vivid":
      return "eq=saturation=1.35:contrast=1.06";
    case "warm":
      return "colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.05,eq=saturation=1.08";
    case "cool":
      return "colorbalance=rs=-0.07:bs=0.09:rm=-0.04:bm=0.06";
    case "cinematic":
      return "eq=contrast=1.1:saturation=0.88:gamma=0.97,colorbalance=rs=-0.04:bs=0.05:rh=0.05:bh=-0.04";
    case "mono":
      return "hue=s=0,eq=contrast=1.08";
    case "vintage":
      return "curves=preset=vintage,eq=saturation=0.85";
    default:
      return "";
  }
}

/** The x264 settings for a quality and a running time: long cuts go faster, so they finish. Pure. */
export function encoderFor(quality: Quality, seconds: number): { preset: string; crf: number } {
  const preset = seconds > 240 ? "ultrafast" : seconds > 90 ? "superfast" : "veryfast";
  return { preset, crf: quality === "high" ? 18 : 21 };
}
