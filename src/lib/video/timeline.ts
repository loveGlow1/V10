/* The timeline made from the person's own uploads — no model, no charge.
 *
 *   stitchPlan      every uploaded clip and picture, in the order uploaded,
 *                   as one plan: what "Edit my clips" starts from, at once
 *   sceneFromAsset  one upload as a scene, to add to any video's timeline
 *   clipsAspect     the shape most of the clips were filmed in
 *
 * Uploaded scenes are ordinary scenes with a `source`: the cut reads the
 * file (trimmed, at its speed and level) instead of a generated clip, and
 * everything else — order, captions, transitions, sound — works the same.
 *
 * Pure: the studio's browser code and the server both use it. */

import type { StudioAsset } from "./assets";
import type { Transition } from "./cut-settings";
import type { Cut, ProductionPlan, Scene } from "./plan";

/** How long a picture stays on screen by default (seconds). */
export const STILL_SECONDS = 4;

const usable = (asset: StudioAsset) => asset.status !== "failed" && (asset.kind === "video" || asset.kind === "image" || asset.kind === "photo");

/** The shape most of the clips were filmed in. Pure. */
export function clipsAspect(assets: Pick<StudioAsset, "kind" | "width" | "height">[]): ProductionPlan["aspect"] {
  let tall = 0;
  let wide = 0;
  let square = 0;
  for (const asset of assets) {
    if (!asset.width || !asset.height || asset.kind === "audio") continue;
    const ratio = asset.width / asset.height;
    if (ratio < 0.9) tall += 1;
    else if (ratio > 1.1) wide += 1;
    else square += 1;
  }
  if (!tall && !wide && !square) return "9:16";
  if (tall >= wide && tall >= square) return "9:16";
  if (wide >= square) return "16:9";
  return "1:1";
}

/** A tidy name for a scene from a file name: "IMG_2041.MOV" → "IMG 2041". Pure. */
export const assetLabel = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 80) || "Your clip";

/** One upload as a scene of the timeline. Pure. */
export function sceneFromAsset(asset: StudioAsset, n: number): Scene {
  const still = asset.kind !== "video";
  return {
    n,
    duration: still ? STILL_SECONDS : Math.max(1, Math.round((asset.durationS ?? STILL_SECONDS) * 10) / 10),
    shot: still ? "Your picture" : "Your clip",
    visual: assetLabel(asset.name),
    onScreenText: "",
    voiceover: "",
    motionPrompt: "",
    sound: "",
    engine: still ? "image" : "video",
    source: { assetId: asset.id },
  };
}

/** The transition a Transitions answer asks for. Pure. */
export function transitionFrom(answer: string | undefined): Transition {
  if (answer && /hard|cut/i.test(answer)) return "cut";
  if (answer && /black/i.test(answer)) return "fadeblack";
  return "crossfade";
}

/**
 * "Edit my clips" planned at once from what was uploaded: one scene per clip
 * or picture, in upload order, cut to the shape asked (or the clips' own),
 * with the clips' own sound and the music asked for. Pure.
 */
export function stitchPlan(input: { assets: StudioAsset[]; answers: Record<string, string>; title?: string; brief?: string }): ProductionPlan {
  const media = input.assets.filter(usable);
  const audio = input.assets.filter((asset) => asset.kind === "audio" && asset.status !== "failed");
  const scenes = media.map((asset, index) => sceneFromAsset(asset, index + 1));
  const asked = input.answers.aspect ?? "";
  const aspect = (["9:16", "1:1", "16:9", "4:5"] as const).find((ratio) => asked.includes(ratio)) ?? clipsAspect(media);
  const musicAnswer = input.answers.music ?? "";
  const ownAudio = /own audio/i.test(musicAnswer) && audio[0];
  const madeMusic = /add music/i.test(musicAnswer);
  const cut: Cut = {
    audio: "original",
    captions: false,
    transition: transitionFrom(input.answers.transitions),
    music: ownAudio ? { source: "upload", assetId: ownAudio.id } : madeMusic ? { source: "generate" } : { source: "none" },
  };
  const seconds = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  return {
    pipeline: "clip_edit",
    title: (input.title ?? "").trim().slice(0, 120) || "My clips",
    concept: scenes.length ? `${scenes.length} of your ${scenes.length === 1 ? "clip" : "clips"}, stitched in the order you uploaded them.` : "Upload your clips to stitch them.",
    strategy: "",
    aspect,
    target: Math.round(seconds),
    voice: "",
    music: madeMusic ? "Upbeat, modern instrumental that suits the footage" : "",
    hooks: [],
    locks: {},
    scenes,
    cta: "",
    cut,
  };
}

/** What a continuation is told to film until the person words it. */
export const CONTINUE_PROMPT = "The action carries straight on from the end of the clip before: the same place, the same people, the same light, moving naturally forward.";

/**
 * "Continue it": a generated scene right after the person's clip that starts
 * on the clip's last frame (continuity.ts). The clip is added first when it
 * is not in the timeline yet. Pure.
 */
export function withContinuation(plan: ProductionPlan, asset: StudioAsset, prompt = CONTINUE_PROMPT, seconds = 6): ProductionPlan {
  let scenes = [...plan.scenes];
  let at = -1;
  for (let i = scenes.length - 1; i >= 0; i -= 1) {
    if (scenes[i].source?.assetId === asset.id) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    scenes.push(sceneFromAsset(asset, scenes.length + 1));
    at = scenes.length - 1;
  }
  const next: Scene = {
    n: 0,
    duration: seconds,
    shot: "Carries on from your clip",
    visual: prompt,
    onScreenText: "",
    voiceover: "",
    motionPrompt: prompt,
    sound: "",
    engine: "video",
    continues: true,
  };
  scenes = [...scenes.slice(0, at + 1), next, ...scenes.slice(at + 1)].map((scene, i) => ({ ...scene, n: i + 1 }));
  return { ...plan, scenes };
}

/** Marks or unmarks an upload as the look every generated scene matches (look.ts). Pure. */
export function toggleReference(plan: ProductionPlan, assetId: string): ProductionPlan {
  const now = plan.referenceClips ?? [];
  const next = now.includes(assetId) ? now.filter((id) => id !== assetId) : [...now, assetId].slice(-4);
  const { referenceClips: _old, ...rest } = plan;
  void _old;
  return next.length ? { ...rest, referenceClips: next } : rest;
}
