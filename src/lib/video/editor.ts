/* The video editor — a change to a video that is already made, done the way
 * a person editing it would: only what was asked is touched.
 *
 * Asked "use the original voices", "remove scene 2", "make scene 3 a closer
 * shot", "end on QuickStark.ai" or "change the hook line", the director used
 * to plan the whole video again and every scene was filmed again: minutes,
 * credits, and the scenes that were right replaced with new ones. The editor
 * instead reads the instruction against the plan and what has been made, and
 * answers with edits:
 *
 *   cut         how the cut is put together — whose voice is heard,
 *               captions, the end card, muted scenes (plan.cut). Nothing is
 *               generated again.
 *   scenes      per scene: keep, re-film (a new clip prompt), re-voice (a
 *               new line), change its words on screen, or remove it.
 *   order       scenes in a new order.
 *   replan      only when the request is a different video.
 *
 * applyEdit turns those into the next version's plan, and says which clips
 * and voice lines carry over from the version before — the rest are made.
 *
 * The model call is server-only; everything else here is pure. */

import Anthropic from "@anthropic-ai/sdk";

import { withPolicy } from "@/lib/safety/policy";

import { DIRECTOR_MODEL } from "./director";
import { attachmentManifest, type StudioAsset } from "./assets";
import { sceneFromAsset } from "./timeline";
import { VOICES, isVoiceId } from "./voices";
import { castManifest, normalizeSceneCast } from "./cast";
import { MAX_CLIP_SECONDS, normalizeCut, withBrand, type Cut, type ProductionPlan, type Scene } from "./plan";

export type SceneEdit = {
  n: number;
  action: "keep" | "refilm" | "revoice" | "remove";
  /** For refilm: the new clip prompt, complete. */
  motionPrompt?: string;
  /** For revoice: the new spoken line. */
  voiceover?: string;
  /** New words on screen (no generation needed). */
  onScreenText?: string;
  /** New length in seconds. */
  duration?: number;
  /** Read the line in another voice (voices.ts). */
  voiceId?: string;
  /** Who is on screen (cast ids). Changing it films the scene again with their pictures. */
  characters?: string[];
};

export type Edit = {
  /** One or two sentences to the person: what will change, in plain words. */
  reply: string;
  replan: boolean;
  cut?: Cut;
  scenes: SceneEdit[];
  /** Old scene numbers in their new order. */
  order?: number[];
  /** Uploads to put in the video: each after an old scene number, or at the end. */
  add?: { assetId: string; after?: number }[];
};

const ACTIONS = ["keep", "refilm", "revoice", "remove"] as const;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Reads what the model wrote, whatever it left out. Never throws. Pure. */
export function normalizeEdit(raw: unknown, plan: Pick<ProductionPlan, "scenes" | "characters">): Edit {
  const castOf = plan.characters ?? [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const numbers = new Set(plan.scenes.map((scene) => scene.n));
  const scenes: SceneEdit[] = [];
  for (const entry of Array.isArray(r.scenes) ? r.scenes.slice(0, 24) : []) {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const n = Number(e.n);
    const action = ACTIONS.find((a) => a === e.action);
    if (!numbers.has(n) || !action || scenes.some((s) => s.n === n)) continue;
    const edit: SceneEdit = { n, action };
    const prompt = text(e.motionPrompt, 1600);
    const line = text(e.voiceover, 600);
    if (action === "refilm" && prompt) edit.motionPrompt = prompt;
    if (action === "refilm" && !prompt) continue;
    if (action === "revoice") {
      if (!line) continue;
      edit.voiceover = line;
    }
    if (typeof e.onScreenText === "string") edit.onScreenText = text(e.onScreenText, 200);
    if (isVoiceId(e.voiceId)) edit.voiceId = e.voiceId;
    if (Array.isArray(e.characters)) edit.characters = normalizeSceneCast(e.characters, castOf);
    const duration = Math.round(Number(e.duration));
    if (Number.isFinite(duration) && duration >= 2 && duration <= MAX_CLIP_SECONDS) edit.duration = duration;
    scenes.push(edit);
  }
  let order: number[] | undefined;
  if (Array.isArray(r.order)) {
    const seen = r.order.map(Number).filter((n) => numbers.has(n));
    if (new Set(seen).size === seen.length && seen.length > 0) order = seen;
  }
  const cut = normalizeCut(r.cut);
  const add = (Array.isArray(r.add) ? r.add : [])
    .slice(0, 12)
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}))
    .filter((entry) => typeof entry.assetId === "string" && /^[0-9a-f-]{36}$/i.test(entry.assetId))
    .map((entry) => ({ assetId: String(entry.assetId).toLowerCase(), ...(numbers.has(Number(entry.after)) ? { after: Number(entry.after) } : {}) }));
  return {
    reply: text(r.reply, 500) || "Done.",
    replan: r.replan === true,
    ...(cut ? { cut } : {}),
    scenes,
    ...(order ? { order } : {}),
    ...(add.length ? { add } : {}),
  };
}

export type Carry = { from: number; to: number; clip: boolean; voice: boolean };

/**
 * The next version's plan from an edit, and what carries over: for each scene
 * of the new plan, which old scene it came from and whether its clip and its
 * voice line can be reused as they are. Pure.
 */
export function applyEdit(plan: ProductionPlan, edit: Edit, uploads: Pick<StudioAsset, "id" | "kind" | "name" | "durationS" | "status" | "mime" | "width" | "height" | "hasAudio">[] = []): { plan: ProductionPlan; carry: Carry[]; refilm: number[]; revoice: number[] } {
  const byN = new Map(edit.scenes.map((e) => [e.n, e]));
  const removed = new Set(edit.scenes.filter((e) => e.action === "remove").map((e) => e.n));
  /* The order asked for, then any scene it left out in its old place. */
  const kept = plan.scenes.filter((scene) => !removed.has(scene.n));
  let ordered: Scene[] = edit.order
    ? [...edit.order.map((n) => kept.find((s) => s.n === n)).filter((s): s is Scene => Boolean(s)), ...kept.filter((s) => !edit.order?.includes(s.n))]
    : kept;
  /* Uploads put in: a new scene each (numbered 0 until renumbered, so
     nothing carries into it but the upload itself). */
  for (const entry of edit.add ?? []) {
    const asset = uploads.find((a) => a.id === entry.assetId && a.status !== "failed" && a.kind !== "audio");
    if (!asset) continue;
    const scene = { ...sceneFromAsset(asset as StudioAsset, 0) };
    const at = entry.after === undefined ? -1 : ordered.findIndex((s) => s.n === entry.after);
    ordered = at < 0 ? [...ordered, scene] : [...ordered.slice(0, at + 1), scene, ...ordered.slice(at + 1)];
  }

  const merged = { ...(plan.cut ?? {}), ...(edit.cut ?? {}) };
  const cut = normalizeCut(merged.endCard ? { ...merged, endCard: withBrand(merged.endCard) } : merged);
  const noVoice = cut?.audio === "original" || cut?.audio === "none";
  const carry: Carry[] = [];
  const refilm: number[] = [];
  const revoice: number[] = [];
  const scenes: Scene[] = ordered.map((old, index) => {
    const n = index + 1;
    const e = old.n === 0 ? undefined : byN.get(old.n);
    const scene: Scene = { ...old, n };
    let clip = true;
    let voice = true;
    if (e?.action === "refilm" && e.motionPrompt) {
      scene.motionPrompt = e.motionPrompt;
      clip = false;
    }
    if (e?.action === "revoice" && e.voiceover) {
      scene.voiceover = withBrand(e.voiceover);
      voice = scene.voiceover === old.voiceover;
    }
    if (e?.onScreenText !== undefined) scene.onScreenText = withBrand(e.onScreenText);
    if (e?.duration) scene.duration = e.duration;
    if (e?.characters && JSON.stringify(e.characters) !== JSON.stringify(scene.characters ?? []) && !scene.source) {
      scene.characters = e.characters.length ? e.characters : undefined;
      clip = false;
    }
    if (e?.voiceId && e.voiceId !== scene.voiceId) {
      scene.voiceId = e.voiceId;
      delete scene.voiceAsset;
      voice = false;
    }
    /* A scene that says nothing needs no voice line; a cut of the clips' own
       sound, or a silent one, uses none. */
    if (!scene.voiceover.trim() || noVoice) voice = true;
    if (old.n === 0) return scene;
    carry.push({ from: old.n, to: n, clip, voice });
    if (!clip) refilm.push(n);
    if (!voice) revoice.push(n);
    return scene;
  });

  const next: ProductionPlan = { ...plan, scenes };
  if (cut) next.cut = cut;
  else delete next.cut;
  return { plan: next, carry, refilm, revoice };
}

/**
 * What carries over from one plan to another the studio's timeline made,
 * matched by content rather than position (scenes may be reordered, added,
 * removed): a scene's picture carries when an old scene had the same upload,
 * or the same generated prompt and engine; its voice line carries when an
 * old scene said exactly the same words. Lengths, trims, speeds, words on
 * screen and every setting change nothing that was made. Pure.
 */
export function carryByContent(previous: ProductionPlan, next: ProductionPlan): { carry: Carry[]; refilm: number[]; revoice: number[] } {
  /* A generated picture is the prompt, the engine and who is in it: a
     different cast is a different scene, filmed again from their pictures. */
  const pictureKey = (scene: Scene) => (scene.source ? `upload:${scene.source.assetId}` : `gen:${scene.engine}:${scene.motionPrompt.trim()}:${(scene.characters ?? []).join(",")}`);
  const usedPicture = new Set<number>();
  const usedVoice = new Set<number>();
  const carry: Carry[] = [];
  const refilm: number[] = [];
  const revoice: number[] = [];
  const noVoice = next.cut?.audio === "original" || next.cut?.audio === "none";
  for (const scene of next.scenes) {
    const line = scene.voiceover.trim();
    /* A line carries when the same words are read by the same voice — or it
       is the same recording. */
    const voiceKey = (plan: ProductionPlan, s: Scene) => (s.voiceAsset ? `asset:${s.voiceAsset}` : `${s.voiceId ?? plan.cut?.voiceId ?? ""}|${s.voiceover.trim()}`);
    const voice = line || scene.voiceAsset ? previous.scenes.find((old) => !usedVoice.has(old.n) && voiceKey(previous, old) === voiceKey(next, scene)) : undefined;
    /* An upload lip-synced to a line that changed is filed again as it was
       uploaded (free), so it is synced to the new line. */
    const resync = scene.source && scene.engine === "avatar" && line && !voice;
    const picture = resync ? undefined : previous.scenes.find((old) => !usedPicture.has(old.n) && pictureKey(old) === pictureKey(scene));
    if (picture) usedPicture.add(picture.n);
    if (voice) usedVoice.add(voice.n);
    /* One old scene can lend its picture to one new scene and its voice to
       one (possibly other) new scene: carried as two entries. */
    if (picture && (!voice || voice.n === picture.n)) carry.push({ from: picture.n, to: scene.n, clip: true, voice: Boolean(voice) });
    else {
      if (picture) carry.push({ from: picture.n, to: scene.n, clip: true, voice: false });
      if (voice) carry.push({ from: voice.n, to: scene.n, clip: false, voice: true });
    }
    if (!picture && !scene.source) refilm.push(scene.n);
    if (line && !voice && !noVoice && !scene.voiceAsset) revoice.push(scene.n);
  }
  return { carry, refilm, revoice };
}

/** What the editor is shown of a video: its plan, scene by scene, and what was made. Pure. */
export function editorBrief(plan: ProductionPlan, made: { scene: number; clip: boolean; voice: boolean }[]): string {
  const lines = plan.scenes.map((scene) => {
    const m = made.find((x) => x.scene === scene.n);
    return [
      `SCENE ${scene.n} · ${scene.duration}s · ${scene.source ? `THE PERSON'S OWN ${scene.engine === "image" ? "PICTURE" : "CLIP"} (upload ${scene.source.assetId}${scene.source.trimStart || scene.source.trimEnd ? `, trimmed ${scene.source.trimStart ?? 0}-${scene.source.trimEnd ?? "end"}s` : ""}${scene.source.speed ? `, ${scene.source.speed}x` : ""}) — never refilm it` : `clip ${m?.clip ? "made" : "missing"}`} · voice ${scene.voiceover ? (m?.voice ? "made" : "missing") : "none"}`,
      ...(scene.characters?.length ? [`  on screen: ${scene.characters.map((id) => plan.characters?.find((c) => c.id === id)?.name ?? id).join(", ")}`] : []),
      `  spoken: ${scene.voiceover || "—"}`,
      `  on screen: ${scene.onScreenText || "—"}`,
      ...(scene.source ? [] : [`  clip prompt: ${scene.motionPrompt.slice(0, 500)}`]),
    ].join("\n");
  });
  return [
    `TITLE: ${plan.title}`,
    `FORMAT: ${plan.aspect}`,
    `LOCKS: ${JSON.stringify(plan.locks).slice(0, 1500)}`,
    `CUT NOW: ${JSON.stringify(plan.cut ?? {})}`,
    ...lines,
  ].join("\n");
}

const SYSTEM = `You are QuickStark's video editor. A video has already been planned and filmed. The person asks for a change; you decide the SMALLEST set of edits that delivers it, the way a skilled human editor would — never re-filming what was right.

What you can do, cheapest first:
1. cut — how the final cut is assembled. Costs nothing, re-films nothing.
   - audio: "voiceover" (only the script's voice — the default for narrated videos), "original" (only the clips' own sound, no voice-over), "mix" (voice-over over the clips' sound), "none" (completely silent — no sound at all; captions stay).
   - captions: true/false (captions of each spoken line).
   - endCard: words shown on the last scene (e.g. "QuickStark.ai").
   - muted: scene numbers whose own sound is silenced.
   - transition: "cut" | "dip" | "crossfade" | "fadeblack" | "fadewhite" | "wipeleft" | "slideleft" | "slideup" | "zoomin" | "circleopen" | "dissolve"; transitionSeconds 0.1-2.
   - fit: "fill" (crop to fill) | "fit-blur" (whole picture over a blurred copy) | "fit-black" (black bars).
   - color: "none" | "vivid" | "warm" | "cool" | "cinematic" | "mono" | "vintage".
   - resolution: "720p" | "1080p"; fps: 24 | 25 | 30 | 60; quality: "standard" | "high".
   - fadeIn / fadeOut: true/false for the start and end of the whole video.
   - originalVolume, voiceVolume, musicVolume: 0 to 2 (1 is normal); duck: music dips under the voice; loudness: one level for the whole video.
   - music: {"source": "generate" | "none"} (an uploaded file is chosen in the studio).
   - captionPosition "bottom"|"middle"|"top", captionSize "small"|"medium"|"large", captionStyle "box"|"outline"|"highlight".
   - stillMotion for pictures: "zoom-in" | "zoom-out" | "pan" | "none".
2. Per-scene words on screen (onScreenText) — costs nothing.
3. revoice — a new spoken line for a scene (cheap). Give the full new line.
4. refilm — a new clip for a scene (expensive). Give the COMPLETE new clip prompt: subject, setting, lighting, lens/shot, camera move, motion, mood, aspect ratio — keep every lock (creator, product, style) word for word so it matches the other scenes.
5. remove — drop a scene. order — old scene numbers in a new order.
   add — put the person's uploads (from ATTACHMENTS, by assetId) into the video: [{"assetId":"...","after":2}] (after a scene number, or at the end without "after"). Free.
   characters on a scene — who is on screen, by id from CHARACTERS (e.g. "characters":["<id>"]): the scene is filmed again from their reference pictures so they look exactly the same. Use it whenever the person asks for a character in a scene.
   voiceId on a scene — read its line in another voice; "cut":{"voiceId":"..."} — every line in another voice. Voices: ${VOICES.map((v) => v.id).join(", ")}.
6. replan: true — ONLY when the person wants a different video altogether (new concept, new product, new length beyond trimming). Everything else is an edit.

Rules:
- Touch only what the request needs. Unmentioned scenes are "keep" (you may omit them).
- If a clip is "missing", re-filming it is how to fix it.
- A spoken line must fit its scene: about 2.5 words per second, scenes are at most ${MAX_CLIP_SECONDS} seconds.
- QuickStark's own name is always written "QuickStark.ai".
- Never depict or imitate a real, identifiable person or brand the person did not supply.
- reply: one or two short sentences to the person saying what you'll change, plainly (e.g. "Switching to the original voices and ending on QuickStark.ai — nothing needs re-filming.").

Reply with ONLY raw JSON, no markdown:
{"reply":"","replan":false,"cut":{"audio":"voiceover|original|mix|none","captions":true,"endCard":"","muted":[]},"scenes":[{"n":1,"action":"keep|refilm|revoice|remove","motionPrompt":"","voiceover":"","onScreenText":"","duration":5,"voiceId":"","characters":[]}],"order":[1,2,3],"add":[{"assetId":"","after":1}]}
Omit any field you are not changing.`;

/** Asks the editor model for the edits an instruction needs. Server-only. */
export async function decideEdit(input: {
  plan: ProductionPlan;
  made: { scene: number; clip: boolean; voice: boolean }[];
  instruction: string;
  /** Everything uploaded: the ATTACHMENTS block is made from it. */
  assets?: StudioAsset[];
  /** The model that edits (agent.ts); the studio's default otherwise. */
  model?: string;
}): Promise<{ edit: Edit; outputTokens: number } | { error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "The video editor is not configured on this server." };
  try {
    const message = await new Anthropic().messages.create({
      model: input.model || DIRECTOR_MODEL,
      max_tokens: 4000,
      system: withPolicy(SYSTEM),
      messages: [{ role: "user", content: `${attachmentManifest(input.assets ?? [])}\n\n${castManifest(input.plan.characters ?? [])}\n\n${editorBrief(input.plan, input.made)}\n\nTHE PERSON ASKS:\n${input.instruction.slice(0, 2000)}` }],
    });
    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return { edit: normalizeEdit(parsed, input.plan), outputTokens: message.usage.output_tokens };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("video editor:", error);
    return { error: "The editor could not work that out just now." };
  }
}
