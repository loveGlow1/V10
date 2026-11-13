/* The visual editor's timeline operations — every one deterministic, none
 * needs a model: move, split at the playhead, duplicate, delete, trim from
 * either edge, and the segments the in-browser preview plays.
 *
 * A scene's place on the timeline is its order; its length is its trimmed
 * upload at its speed, or its planned seconds. Mutes follow their scenes.
 *
 * Pure: the editor (browser) uses it, and tools/check-video.mjs checks it. */

import type { ProductionPlan, Scene } from "./plan";
import { sourceSeconds } from "./plan";

export type TimelineAsset = { id: string; kind: string; durationS: number | null; url?: string | null; posterUrl?: string | null; name?: string };
export type TimelineRender = { scene: number | null; engine: string; status: string; url: string | null };

/** How long a scene runs on the timeline. Pure. */
export function sceneLength(scene: Scene, assets: TimelineAsset[]): number {
  if (scene.source && scene.engine !== "image") {
    const asset = assets.find((a) => a.id === scene.source?.assetId);
    if (asset && asset.kind === "video") return sourceSeconds(scene.source, asset.durationS) ?? scene.duration;
  }
  return Math.max(0.5, Number(scene.duration) || 3);
}

/** Scenes renumbered 1..n in their order, mutes moved with them. Pure. */
export function withScenes(plan: ProductionPlan, scenes: Scene[]): ProductionPlan {
  const muted = new Set(plan.cut?.muted ?? []);
  const renumbered = scenes.map((scene, index) => ({ ...scene, n: index + 1 }));
  const nextMuted = scenes.flatMap((scene, index) => (muted.has(scene.n) ? [index + 1] : []));
  const cut = plan.cut ? { ...plan.cut, muted: nextMuted.length ? nextMuted : undefined } : undefined;
  return { ...plan, scenes: renumbered, ...(cut ? { cut } : {}) };
}

/** A scene moved to another place in the order (0-based). Pure. */
export function moveScene(plan: ProductionPlan, n: number, toIndex: number): ProductionPlan {
  const scenes = [...plan.scenes];
  const from = scenes.findIndex((scene) => scene.n === n);
  if (from < 0) return plan;
  const [scene] = scenes.splice(from, 1);
  scenes.splice(Math.max(0, Math.min(scenes.length, toIndex)), 0, scene);
  return withScenes(plan, scenes);
}

export function removeScene(plan: ProductionPlan, n: number): ProductionPlan {
  if (plan.scenes.length <= 1) return plan;
  return withScenes(plan, plan.scenes.filter((scene) => scene.n !== n));
}

/** A copy of a scene right after it. A generated scene's copy is filmed again on export. Pure. */
export function duplicateScene(plan: ProductionPlan, n: number): ProductionPlan {
  const at = plan.scenes.findIndex((scene) => scene.n === n);
  if (at < 0) return plan;
  const scenes = [...plan.scenes];
  scenes.splice(at + 1, 0, { ...plan.scenes[at], source: plan.scenes[at].source ? { ...plan.scenes[at].source! } : undefined });
  return withScenes(plan, scenes);
}

/** Whether a scene can be split without filming anything: an upload. */
export const canSplit = (scene: Scene) => Boolean(scene.source);

/**
 * A scene cut in two at `offset` seconds into it (timeline time). An uploaded
 * clip becomes two trims of the same file; a picture two holds. The words on
 * screen stay with the first part; a spoken line stays whole on the first.
 * Null when it cannot be split there. Pure.
 */
export function splitAt(plan: ProductionPlan, n: number, offset: number, assets: TimelineAsset[]): ProductionPlan | null {
  const at = plan.scenes.findIndex((scene) => scene.n === n);
  const scene = plan.scenes[at];
  if (!scene || !canSplit(scene)) return null;
  const length = sceneLength(scene, assets);
  if (offset < 0.3 || offset > length - 0.3) return null;
  let first: Scene;
  let second: Scene;
  if (scene.engine === "image" || !scene.source) {
    first = { ...scene, duration: round(offset) };
    second = { ...scene, duration: round(length - offset), onScreenText: "", voiceover: "", voiceAsset: undefined };
  } else {
    const speed = scene.source.speed ?? 1;
    const asset = assets.find((a) => a.id === scene.source?.assetId);
    const start = scene.source.trimStart ?? 0;
    const end = scene.source.trimEnd ?? asset?.durationS ?? start + length * speed;
    const cut = round(start + offset * speed);
    first = { ...scene, source: { ...scene.source, trimEnd: cut }, duration: round(offset) };
    second = { ...scene, source: { ...scene.source, trimStart: cut, trimEnd: end }, duration: round(length - offset), onScreenText: "", voiceover: "", voiceAsset: undefined };
  }
  const scenes = [...plan.scenes];
  scenes.splice(at, 1, first, second);
  const muted = plan.cut?.muted?.includes(n);
  const next = withScenes(plan, scenes);
  /* Both halves keep the scene's mute. */
  if (muted && next.cut) next.cut = { ...next.cut, muted: [...new Set([...(next.cut.muted ?? []), at + 2])].sort((a, b) => a - b) };
  return next;
}

/**
 * A scene trimmed from one edge by `delta` seconds of timeline time
 * (positive shortens from the start / lengthens at the end). Uploads move
 * their in/out points within the file; pictures and generated scenes change
 * their length. Pure.
 */
export function trimEdge(plan: ProductionPlan, n: number, edge: "start" | "end", delta: number, assets: TimelineAsset[]): ProductionPlan {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => {
      if (scene.n !== n) return scene;
      const asset = scene.source ? assets.find((a) => a.id === scene.source?.assetId) : undefined;
      if (scene.source && asset?.kind === "video" && asset.durationS) {
        const speed = scene.source.speed ?? 1;
        const total = asset.durationS;
        const start = scene.source.trimStart ?? 0;
        const end = scene.source.trimEnd ?? total;
        const source = { ...scene.source };
        if (edge === "start") source.trimStart = round(Math.max(0, Math.min(end - 0.3, start + delta * speed)));
        else source.trimEnd = round(Math.max(start + 0.3, Math.min(total, end + delta * speed)));
        if (!source.trimStart) delete source.trimStart;
        if (source.trimEnd !== undefined && source.trimEnd >= total - 0.05) delete source.trimEnd;
        return { ...scene, source, duration: sourceSeconds(source, total) ?? scene.duration };
      }
      const change = edge === "start" ? -delta : delta;
      const max = scene.source ? 60 : 30;
      return { ...scene, duration: round(Math.max(1, Math.min(max, (Number(scene.duration) || 3) + change))) };
    }),
  };
}

export type Segment = {
  n: number;
  start: number;
  seconds: number;
  kind: "video" | "image" | "pending";
  mediaUrl: string | null;
  posterUrl: string | null;
  /** Seconds into the media where the segment starts. */
  from: number;
  speed: number;
  volume: number;
  voiceUrl: string | null;
  label: string;
  text: string;
  caption: string;
  /** This clip's own filter, when it has one. */
  color?: ProductionPlan["scenes"][number]["color"];
};

/** What the preview plays, in order, from the plan, the uploads and what has been made. Pure. */
export function segmentsFor(plan: ProductionPlan, assets: TimelineAsset[], renders: TimelineRender[]): Segment[] {
  const muted = new Set(plan.cut?.muted ?? []);
  const made = (n: number, engine: string) => renders.find((r) => r.scene === n && r.engine === engine && r.status === "done" && r.url)?.url ?? null;
  let at = 0;
  return plan.scenes.map((scene) => {
    const seconds = sceneLength(scene, assets);
    const asset = scene.source ? assets.find((a) => a.id === scene.source?.assetId) : undefined;
    const voiceAsset = scene.voiceAsset ? assets.find((a) => a.id === scene.voiceAsset) : undefined;
    const still = Boolean(asset && asset.kind !== "video");
    const mediaUrl = asset ? asset.url ?? null : made(scene.n, "avatar") ?? made(scene.n, "video");
    const segment: Segment = {
      n: scene.n,
      start: round(at),
      seconds,
      kind: mediaUrl ? (still ? "image" : "video") : "pending",
      mediaUrl,
      posterUrl: asset?.posterUrl ?? null,
      from: asset && !still ? scene.source?.trimStart ?? 0 : 0,
      speed: asset && !still ? scene.source?.speed ?? 1 : 1,
      volume: muted.has(scene.n) ? 0 : Math.min(1, (scene.source?.volume ?? 1) * (plan.cut?.originalVolume ?? 1)),
      voiceUrl: voiceAsset?.url ?? made(scene.n, "voice"),
      label: asset?.name || scene.shot || scene.visual.slice(0, 40) || `Scene ${scene.n}`,
      text: scene.onScreenText,
      caption: scene.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "").trim(),
      ...(scene.color ? { color: scene.color } : {}),
    };
    at += seconds;
    return segment;
  });
}

/** The segment playing at a time, and how far into it. Pure. */
export function segmentAt(segments: Segment[], time: number): { segment: Segment; offset: number } | null {
  if (!segments.length) return null;
  const segment = segments.find((s) => time < s.start + s.seconds) ?? segments[segments.length - 1];
  return { segment, offset: Math.max(0, Math.min(segment.seconds, time - segment.start)) };
}

export const timelineLength = (segments: Segment[]) => (segments.length ? round(segments[segments.length - 1].start + segments[segments.length - 1].seconds) : 0);

const round = (value: number) => Math.round(value * 100) / 100;
