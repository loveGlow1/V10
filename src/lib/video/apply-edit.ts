/* A chat message on a video that has been made: edited, not planned again.
 *
 * The editor (editor.ts) decides the smallest set of edits; this makes them
 * real as the next version:
 *
 *   1. the new plan is saved as a new version — Undo goes back to the cut
 *      before, as with any version;
 *   2. every clip and voice line that carries over is filed under the new
 *      version as it is — same file, no new generation, no new charge — and
 *      so is the creator keyframe, so a re-filmed scene keeps the same face;
 *   3. only what changed (or was never made) is sent to render;
 *   4. the scenes are cut together again — at once, when nothing needed
 *      making.
 *
 * Returns null when this is not an edit — nothing has been made yet, or the
 * person wants a different video — and the caller plans it instead.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { stopped } from "@/lib/ai/llm";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { applyEdit, carryByContent, decideEdit, type Carry, type Edit } from "./editor";
import { dropsNarration, wantsNarration } from "./director";
import { pictureKey, voiceKey } from "./editor-timeline";
import { madeLibrary, type MadeRow } from "./reuse";
import { SOUND_COMMANDS } from "./sound";
import { keyframePath } from "./frames";
import { usesVoice, type Cut, type ProductionPlan } from "./plan";
import { advance, startMusic } from "./production";
import { startRender } from "./start-render";
import type { StudioAsset } from "./assets";
import { loadStudioAssets } from "./plan-video";
import { contextFiles } from "./context-files";
import { sceneStills, wantsStills } from "./scene-stills";
import { agentCost, videoAgentFor } from "./agent";
import { cutCost, wantsMusic } from "./engines";
import { creditsLabel } from "./pricing";

const EDIT_COST = 1;

type Row = { scene: number | null; engine: string; status: string; provider: string | null; output_path: string | null };

export type EditResult = { ok: true; message: string } | { ok: false; message: string };

/* The sound of a made video, switched from the preview's Sound control
   (lib/video/sound.ts): a fixed request, so no model is asked and nothing is
   charged — every clip and line carries over, and only the cut is made again.
   Always reversible: the voice lines and the clips' own sound are kept
   whichever is heard. */
const SOUND_REPLY: Record<NonNullable<Cut["audio"]>, string> = {
  voiceover: "Voice-over only, coming up.",
  original: "Switching to the clips' original sound — the voice-over is kept, so you can bring it back any time.",
  mix: "Putting the voice-over over the original sound.",
  none: "Muting the whole video — no sound at all. The captions stay, and you can turn the sound back on any time.",
};

export async function setSound(input: { writer: SupabaseClient; userId: string; videoId: string; audio: NonNullable<Cut["audio"]>; origin: string }): Promise<EditResult | null> {
  const loaded = await load(input.writer, input.videoId);
  if (!loaded?.made) return { ok: false, message: "There's no finished video to change the sound of yet." };
  const edit: Edit = { reply: SOUND_REPLY[input.audio], replan: false, cut: { audio: input.audio }, scenes: [] };
  return commitEdit({ ...input, ...loaded, edit, instruction: SOUND_COMMANDS[input.audio], charge: 0 });
}

type Loaded = {
  video: { user_id: string };
  version: number;
  plan: ProductionPlan;
  done: (scene: number, engine: string) => Row | undefined;
  /** The made music of the version edited, if any. */
  music?: Row;
  /** At least one clip of this version is made. */
  made: boolean;
  /** Generating was ever started for this version (made, failed or running). */
  started: boolean;
};

async function load(writer: SupabaseClient, videoId: string): Promise<Loaded | null> {
  const { data: video } = await writer.from("video_projects").select("id, user_id, current_version, title").eq("id", videoId).maybeSingle();
  if (!video?.current_version) return null;
  const version = video.current_version as number;
  const { data: planRow } = await writer.from("video_versions").select("plan").eq("video_id", videoId).eq("version", version).maybeSingle();
  if (!planRow) return null;
  const plan = planRow.plan as ProductionPlan;
  const { data: renderRows } = await writer.from("video_renders").select("scene, engine, status, provider, output_path").eq("video_id", videoId).eq("version", version);
  const rows = (renderRows ?? []) as Row[];
  const done = (scene: number, engine: string) => rows.find((row) => row.scene === scene && row.engine === engine && row.status === "done" && row.output_path);
  /* A plan is edited whether or not its clips were made (or all failed):
     planning it again would invent scenes nobody asked for. */
  const made = plan.scenes.some((scene) => done(scene.n, "video") || done(scene.n, "avatar"));
  const music = rows.find((row) => row.engine === "music" && row.status === "done" && row.output_path);
  return { video: { user_id: video.user_id as string }, version, plan, done, music, made, started: rows.length > 0 };
}

export async function editVideo(input: {
  writer: SupabaseClient;
  userId: string;
  videoId: string;
  instruction: string;
  origin: string;
  /** The AI agent picked in the workspace (agent.ts). */
  model?: unknown;
}): Promise<EditResult | null> {
  const loaded = await load(input.writer, input.videoId);
  if (!loaded) return null;
  const { plan, done } = loaded;
  const made = plan.scenes.map((scene) => ({ scene: scene.n, clip: Boolean(done(scene.n, "video") || done(scene.n, "avatar")), voice: Boolean(done(scene.n, "voice")) }));
  const uploads = await loadStudioAssets(input.writer, input.videoId);
  const agent = await videoAgentFor(input.writer, input.userId, input.model);
  const context = await contextFiles(input.writer, uploads, plan.referenceClips ?? []);
  /* A picture sent with the message ("change this"): the editor sees every
     made scene too, and finds the one the picture shows. */
  const stills = wantsStills(input.instruction)
    ? await sceneStills(input.writer, {
        videoId: input.videoId,
        plan,
        done,
        posters: new Map(uploads.filter((u) => u.poster_path).map((u) => [u.id, u.poster_path as string])),
      })
    : [];
  /* Earlier versions, so "the previous voice-over" can be brought back word for word. */
  const { data: earlier } = await input.writer
    .from("video_versions")
    .select("version, note, plan")
    .eq("video_id", input.videoId)
    .neq("version", loaded.version)
    .order("version", { ascending: false })
    .limit(12);
  const history = (earlier ?? []).map((row) => ({ version: row.version as number, note: row.note as string | null, plan: row.plan as ProductionPlan }));
  const ask = (nudge?: string) => decideEdit({ plan, made, instruction: input.instruction, assets: uploads, model: agent.apiId, ...context, stills, history, nudge });
  let decided = await ask();
  if ("error" in decided) return { ok: false, message: `${decided.error} Nothing was changed or charged — try again in a moment.` };
  if (stopped()) return { ok: false, message: "Stopped — nothing was changed or charged." };
  /* Adding or removing a voice-over is an edit: planning the video again
     would film every scene again. */
  if (decided.edit.replan && (wantsNarration(input.instruction) || dropsNarration(input.instruction))) {
    const again = await ask("This is NOT a new video: the person only wants the voice-over changed. replan must be false. Write the lines (revoice) and set cut.audio; refilm nothing.");
    if (!("error" in again)) decided = again;
  }
  if ("error" in decided) return { ok: false, message: `${decided.error} Nothing was changed or charged — try again in a moment.` };
  /* Planning again writes every scene anew. Only for a request that really is
     a different video — otherwise asked once more, as an edit. */
  if (decided.edit.replan && !wantsNewVideo(input.instruction)) {
    const again = await ask("This is NOT a new video. replan must be false. Change only the scene(s) the request is about, keep every other scene exactly as it is, and add no scenes that were not asked for.");
    if (!("error" in again)) decided = again;
    if ("error" in decided) return { ok: false, message: `${decided.error} Nothing was changed or charged — try again in a moment.` };
  }
  if (decided.edit.replan) return null;
  /* "Change only scene 3": nothing else is re-filmed, re-voiced or removed. */
  decided = { ...decided, edit: onlyNamedScenes(decided.edit, input.instruction, made) };
  /* An answer that changes nothing, though a change was asked for: asked
     once more, plainly. Still nothing — said so, and nothing is charged. */
  if (changesNothing(plan, decided.edit, uploads)) {
    const again = await ask(
      wantsNarration(input.instruction)
        ? "YOUR LAST ANSWER CHANGED NOTHING, but the person asked for a VOICE-OVER. Write a spoken line for every scene (action \"revoice\" with the full new line in \"voiceover\") and set cut.audio to \"voiceover\" (or \"mix\" for their own clips with sound). Do not refilm anything."
        : "YOUR LAST ANSWER CHANGED NOTHING, but the person asked for a change. Make the edit they asked for now — on the scene(s) it concerns — using the fields above. Only if it truly cannot be done, keep the scenes unchanged and say why in reply.",
    );
    if (!("error" in again) && !again.edit.replan) decided = again;
    if (stopped()) return { ok: false, message: "Stopped — nothing was changed or charged." };
    if ("error" in decided || changesNothing(plan, decided.edit, uploads)) {
      const reply = "error" in decided ? "" : decided.edit.reply;
      return {
        ok: true,
        message:
          reply && reply !== "Done."
            ? `${reply} (Nothing in the video changed, and nothing was charged.)`
            : "I couldn't find what to change for that. Tell me which scene (or send a screenshot of it) and what it should be — nothing was changed or charged.",
      };
    }
  }
  const result = await commitEdit({ ...input, ...loaded, edit: decided.edit, uploads, charge: agentCost(EDIT_COST, agent), outputTokens: decided.outputTokens, deferRender: !loaded.started });
  return agent.declined ? { ...result, message: `${result.message} (Made with ${agent.name} — ${agent.declined}.)` } : result;
}

/* Whether an edit would leave the video exactly as it is. */
function changesNothing(plan: ProductionPlan, edit: Edit, uploads: StudioAsset[]): boolean {
  const { plan: next, refilm, revoice } = applyEdit(plan, edit, uploads);
  return !refilm.length && !revoice.length && JSON.stringify(next) === JSON.stringify(plan);
}

/* An edit, made real as the next version. */
async function commitEdit(input: Loaded & {
  writer: SupabaseClient;
  userId: string;
  videoId: string;
  origin: string;
  instruction: string;
  edit: Edit;
  uploads?: StudioAsset[];
  charge: number;
  outputTokens?: number;
  /** Not generated yet: the change is saved to the plan, nothing is made. */
  deferRender?: boolean;
}): Promise<EditResult> {
  const { plan: next, carry, refilm, revoice } = applyEdit(input.plan, input.edit, input.uploads ?? []);
  if (input.deferRender) {
    const saved = await saveOnly({ ...input, next, carry });
    if (saved.ok && input.charge > 0) {
      const service = createSupabaseServiceClient() ?? input.writer;
      await chargeCredits(service, { userId: input.userId, action: "generate", cost: input.charge, description: `Video edit: ${next.title}`, outputTokens: input.outputTokens, videoId: input.videoId, dedupeKey: `video-edit:${input.videoId}:${input.version}:${Date.now()}` });
    }
    return saved.ok ? { ok: true, message: `${input.edit.reply} Changed in the plan — press Generate when you're ready.` } : saved;
  }
  return commitNext({ ...input, next, carry, refilm, revoice, reply: input.edit.reply });
}

/** Whether a message asks for a different video rather than a change to this one. Pure. */
export function wantsNewVideo(text: string): boolean {
  return /\b(new video|different video|another video|start over|start again|from scratch|brand new|new concept|new idea|new story|replan|re-plan|plan (it )?again|whole new|completely (new|different)|redo (the )?(whole|entire) (video|thing))\b/i.test(text);
}

/**
 * When the request names its scenes ("scene 3", "scenes 2 and 5"), an edit
 * touches only those: any other scene the model wanted to re-film, re-voice
 * or remove is kept as it is. A scene never made is left for Export. Pure.
 */
export function onlyNamedScenes(edit: Edit, instruction: string, made: { scene: number; clip: boolean }[]): Edit {
  const named = new Set<number>();
  for (const match of instruction.matchAll(/\bscenes?\s+((?:\d+\s*(?:,|and|&|-|to)?\s*)+)/gi)) {
    const numbers = match[1].match(/\d+/g)?.map(Number) ?? [];
    if (/-|to/.test(match[1]) && numbers.length === 2) for (let n = numbers[0]; n <= numbers[1]; n += 1) named.add(n);
    else numbers.forEach((n) => named.add(n));
  }
  /* "all scenes" / "every scene" covers everything; "every OTHER scene" does not. */
  if (!named.size || /\b(all(\s+the)?|every|each)\s+scenes?\b/i.test(instruction)) return edit;
  void made;
  return { ...edit, scenes: edit.scenes.filter((scene) => named.has(scene.n) || scene.action === "keep") };
}

/**
 * The studio's own timeline and settings, saved as the next version: every
 * clip and voice line that still fits carries over (carryByContent), only
 * what changed is made, and the cut is made again (charged by its length,
 * pricing.ts). Null when nothing
 * has been made yet (the caller just saves the plan).
 */
export async function saveTimeline(input: { writer: SupabaseClient; userId: string; videoId: string; next: ProductionPlan; origin: string }): Promise<EditResult | null> {
  const loaded = await load(input.writer, input.videoId);
  if (!loaded?.made) return null;
  const { carry, refilm, revoice } = carryByContent(loaded.plan, input.next);
  return commitNext({
    ...input,
    ...loaded,
    carry,
    refilm,
    revoice,
    instruction: "Timeline and settings",
    reply: "Saved.",
    charge: 0,
    reuseEarlier: true,
    deferRender: true,
  });
}

/* A version made real: saved, what carries over filed, the rest made, cut. */
async function commitNext(input: Loaded & {
  writer: SupabaseClient;
  userId: string;
  videoId: string;
  origin: string;
  instruction: string;
  next: ProductionPlan;
  carry: Carry[];
  refilm: number[];
  revoice: number[];
  reply: string;
  charge: number;
  outputTokens?: number;
  /** A timeline save: scenes made in any earlier version are filed, not filmed again. */
  reuseEarlier?: boolean;
  /** A timeline save: only saved. Nothing is filmed, voiced, scored, cut or
      charged until Export — a word on screen changed is never a new clip. */
  deferRender?: boolean;
}): Promise<EditResult> {
  const { writer, userId, videoId, origin, video, version, done, next, carry, refilm, revoice } = input;
  const edit = { reply: input.reply };
  if (!next.scenes.length) return { ok: false, message: "That would leave the video with no scenes, so I've left it as it is." };
  if (input.deferRender) return saveOnly({ ...input, next, carry });
  /* Every new version is cut again, and the cut is charged: nothing is
     saved unless the AI's answer (if any) and the cut can be paid for. */
  const needed = input.charge + cutCost(next);
  const purse = createSupabaseServiceClient();
  const balance = purse ? await currentBalance(purse, userId) : null;
  if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < needed) {
    return { ok: false, message: `This change needs ${creditsLabel(needed)} (the new cut${input.charge ? " and the AI's answer" : ""}). Top up and try again — nothing was changed.` };
  }

  /* 1. The new version. */
  const { data: newest } = await writer.from("video_versions").select("version").eq("video_id", videoId).order("version", { ascending: false }).limit(1).maybeSingle();
  const nextVersion = Math.max(version, (newest?.version as number | undefined) ?? 0) + 1;
  const note = input.instruction.trim().slice(0, 300);
  const { error: saveError } = await writer
    .from("video_versions")
    .insert({ video_id: videoId, user_id: userId, version: nextVersion, plan: next, issues: [], note });
  if (saveError) return { ok: false, message: "The change could not be saved. Nothing was charged — try again." };

  /* 2. What carries over, filed under the new version as it is. */
  const carried: Record<string, unknown>[] = [];
  for (const entry of carry) {
    const picture = done(entry.from, "avatar") ?? done(entry.from, "video");
    if (entry.clip && picture) {
      carried.push({ video_id: videoId, user_id: userId, version: nextVersion, scene: entry.to, engine: picture.engine, provider: picture.provider, status: "done", output_path: picture.output_path });
    }
    const voice = done(entry.from, "voice");
    if (entry.voice && voice && next.scenes.find((s) => s.n === entry.to)?.voiceover.trim()) {
      carried.push({ video_id: videoId, user_id: userId, version: nextVersion, scene: entry.to, engine: "voice", provider: voice.provider, status: "done", output_path: voice.output_path });
    }
  }
  if (carried.length) await writer.from("video_renders").insert(carried);
  /* The same creator in a re-filmed scene: the keyframe comes too. */
  const service = createSupabaseServiceClient() ?? writer;
  await service.storage
    .from("video-assets")
    .copy(keyframePath(video.user_id as string, videoId, version), keyframePath(video.user_id as string, videoId, nextVersion))
    .catch(() => null);

  /* The music. It used to be left behind: every edit's new cut had none.
     Kept as it is when nothing about it changed and it is still long
     enough; made again when the edit changed it or the video outgrew it. */
  if (wantsMusic(next)) {
    const seconds = (plan: ProductionPlan) => plan.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
    const unchanged = input.music && wantsMusic(input.plan) && (input.plan.music ?? "").trim() === (next.music ?? "").trim() && seconds(next) <= seconds(input.plan) + 2;
    if (unchanged && input.music) {
      await writer.from("video_renders").insert({ video_id: videoId, user_id: userId, version: nextVersion, scene: null, engine: "music", provider: input.music.provider, status: "done", output_path: input.music.output_path });
    } else {
      await startMusic(service, { video_id: videoId, user_id: userId, version: nextVersion }, origin, next);
    }
  }

  await writer.from("video_projects").update({ current_version: nextVersion, title: next.title.slice(0, 160) }).eq("id", videoId);
  if (input.charge > 0) {
    await chargeCredits(service, {
      userId,
      action: "generate",
      cost: input.charge,
      description: `Video edit: ${next.title}`,
      outputTokens: input.outputTokens,
      videoId,
      dedupeKey: `video-edit:${videoId}:${nextVersion}`,
    });
  }

  /* 3. Only what the change touched is made: the scenes it re-films or
     re-voices, and scenes it added. A scene that was never made (or failed)
     and that the change did not touch is left for Export — an edit never
     quietly films the rest of the video. */
  const fromOld = new Set(carry.map((entry) => entry.to));
  const added = next.scenes.filter((scene) => !fromOld.has(scene.n)).map((scene) => scene.n);
  const clips = [...new Set([...refilm, ...added])].filter((n) => !next.scenes.find((scene) => scene.n === n)?.source);
  const voices = [...new Set([...revoice, ...added])].filter((n) => {
    const scene = next.scenes.find((s) => s.n === n);
    return Boolean(scene && usesVoice(next.cut) && scene.voiceover.trim() && !scene.voiceAsset);
  });
  const missing = clips.some((n) => !carried.some((row) => row.scene === n && (row.engine === "video" || row.engine === "avatar")))
    || voices.some((n) => !carried.some((row) => row.scene === n && row.engine === "voice"))
    /* The person's own clip or picture put in: filed (free) before the cut. */
    || next.scenes.some((scene) => scene.source && !carried.some((row) => row.scene === scene.n && (row.engine === "video" || row.engine === "avatar")) && added.includes(scene.n));
  if (missing) {
    const rendered = await startRender(writer, userId, videoId, { onlyMissing: true, reuseEarlier: input.reuseEarlier === true, onlyScenes: { clips, voices } }, origin);
    const body = (await rendered.json().catch(() => null)) as { error?: string; cost?: number } | null;
    if (!rendered.ok) {
      return { ok: false, message: `${edit.reply} I saved it as version ${nextVersion}, but the new pieces could not be started: ${(body?.error ?? "try again in a moment").replace(/\.+$/, "")}. Say "render it" to try again.` };
    }
    const pieces = [refilm.length ? `re-filming ${scenesWord(refilm)}` : "", revoice.length ? `re-voicing ${scenesWord(revoice)}` : ""].filter(Boolean).join(" and ");
    return { ok: true, message: `${edit.reply} ${pieces ? `I'm ${pieces}` : "I'm making the missing scenes"} — everything else is reused as it is. The new cut lands in the chat when it's done.` };
  }

  /* 4. Nothing to make: cut it together now. */
  await writer.from("video_projects").update({ status: "rendering" }).eq("id", videoId);
  await advance(service, videoId, nextVersion, origin);
  return { ok: true, message: `${edit.reply} Nothing needs re-filming, so the new cut takes about a minute — it lands in the chat when it's done.` };
}

/* A timeline save: the next version, with every clip and voice line that
   still fits filed as it is — from the version playing or any earlier one —
   and nothing else. Free; Export makes whatever is still missing. */
async function saveOnly(input: Loaded & { writer: SupabaseClient; userId: string; videoId: string; instruction: string; next: ProductionPlan; carry: Carry[] }): Promise<EditResult> {
  const { writer, userId, videoId, video, version, done, next, carry } = input;
  const { data: newest } = await writer.from("video_versions").select("version").eq("video_id", videoId).order("version", { ascending: false }).limit(1).maybeSingle();
  const nextVersion = Math.max(version, (newest?.version as number | undefined) ?? 0) + 1;
  const { error: saveError } = await writer
    .from("video_versions")
    .insert({ video_id: videoId, user_id: userId, version: nextVersion, plan: next, issues: [], note: input.instruction.trim().slice(0, 300) });
  if (saveError) return { ok: false, message: "Your edit could not be saved. Nothing was charged — try again." };

  const rows: Record<string, unknown>[] = [];
  const hasPicture = new Set<number>();
  const hasVoice = new Set<number>();
  for (const entry of carry) {
    const picture = done(entry.from, "avatar") ?? done(entry.from, "video");
    if (entry.clip && picture && !hasPicture.has(entry.to)) {
      hasPicture.add(entry.to);
      rows.push({ video_id: videoId, user_id: userId, version: nextVersion, scene: entry.to, engine: picture.engine, provider: picture.provider, status: "done", output_path: picture.output_path });
    }
    const voice = done(entry.from, "voice");
    if (entry.voice && voice && !hasVoice.has(entry.to) && next.scenes.find((s) => s.n === entry.to)?.voiceover.trim()) {
      hasVoice.add(entry.to);
      rows.push({ video_id: videoId, user_id: userId, version: nextVersion, scene: entry.to, engine: "voice", provider: voice.provider, status: "done", output_path: voice.output_path });
    }
  }
  /* Made in an earlier version than the one playing: filed too. */
  const [{ data: versions }, { data: made }] = await Promise.all([
    writer.from("video_versions").select("version, plan").eq("video_id", videoId).order("version", { ascending: false }).limit(60),
    writer.from("video_renders").select("version, scene, engine, status, provider, output_path").eq("video_id", videoId).eq("status", "done").in("engine", ["video", "avatar", "voice"]),
  ]);
  const library = madeLibrary(new Map((versions ?? []).map((row) => [row.version as number, row.plan as ProductionPlan])), (made ?? []) as MadeRow[], version);
  for (const scene of next.scenes) {
    if (!scene.source && !hasPicture.has(scene.n)) {
      const row = library.pictures.get(pictureKey(scene));
      if (row) rows.push({ video_id: videoId, user_id: userId, version: nextVersion, scene: scene.n, engine: row.engine, provider: row.provider, status: "done", output_path: row.output_path });
    }
    if (scene.voiceover.trim() && !scene.voiceAsset && !hasVoice.has(scene.n)) {
      const row = library.voices.get(voiceKey(next, scene));
      if (row) rows.push({ video_id: videoId, user_id: userId, version: nextVersion, scene: scene.n, engine: "voice", provider: row.provider, status: "done", output_path: row.output_path });
    }
  }
  /* The music, when nothing about it changed. */
  if (input.music && wantsMusic(next) && wantsMusic(input.plan) && (input.plan.music ?? "").trim() === (next.music ?? "").trim()) {
    rows.push({ video_id: videoId, user_id: userId, version: nextVersion, scene: null, engine: "music", provider: input.music.provider, status: "done", output_path: input.music.output_path });
  }
  if (rows.length) await writer.from("video_renders").insert(rows);
  const service = createSupabaseServiceClient() ?? writer;
  await service.storage
    .from("video-assets")
    .copy(keyframePath(video.user_id as string, videoId, version), keyframePath(video.user_id as string, videoId, nextVersion))
    .catch(() => null);
  await writer.from("video_projects").update({ current_version: nextVersion, title: next.title.slice(0, 160), status: "planned" }).eq("id", videoId);
  return { ok: true, message: "Saved — nothing was filmed or charged. Export makes the final video, filming only scenes that were never made." };
}

function scenesWord(ns: number[]): string {
  return ns.length === 1 ? `scene ${ns[0]}` : `scenes ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}
