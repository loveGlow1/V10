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

import { chargeCredits } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { applyEdit, decideEdit, type Edit } from "./editor";
import { SOUND_COMMANDS } from "./sound";
import { keyframePath } from "./frames";
import { usesVoice, type Cut, type ProductionPlan } from "./plan";
import { advance } from "./production";
import { startRender } from "./start-render";

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
  if (!loaded) return { ok: false, message: "There's no finished video to change the sound of yet." };
  const edit: Edit = { reply: SOUND_REPLY[input.audio], replan: false, cut: { audio: input.audio }, scenes: [] };
  return commitEdit({ ...input, ...loaded, edit, instruction: SOUND_COMMANDS[input.audio], charge: 0 });
}

type Loaded = { video: { user_id: string }; version: number; plan: ProductionPlan; done: (scene: number, engine: string) => Row | undefined };

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
  /* Nothing filmed yet: there is nothing to edit. */
  if (!plan.scenes.some((scene) => done(scene.n, "video") || done(scene.n, "avatar"))) return null;
  return { video: { user_id: video.user_id as string }, version, plan, done };
}

export async function editVideo(input: {
  writer: SupabaseClient;
  userId: string;
  videoId: string;
  instruction: string;
  origin: string;
}): Promise<EditResult | null> {
  const loaded = await load(input.writer, input.videoId);
  if (!loaded) return null;
  const { plan, done } = loaded;
  const made = plan.scenes.map((scene) => ({ scene: scene.n, clip: Boolean(done(scene.n, "video") || done(scene.n, "avatar")), voice: Boolean(done(scene.n, "voice")) }));
  const decided = await decideEdit({ plan, made, instruction: input.instruction });
  if ("error" in decided) return { ok: false, message: `${decided.error} Nothing was changed or charged — try again in a moment.` };
  if (decided.edit.replan) return null;
  return commitEdit({ ...input, ...loaded, edit: decided.edit, charge: EDIT_COST, outputTokens: decided.outputTokens });
}

/* An edit, made real as the next version. */
async function commitEdit(input: Loaded & {
  writer: SupabaseClient;
  userId: string;
  videoId: string;
  origin: string;
  instruction: string;
  edit: Edit;
  charge: number;
  outputTokens?: number;
}): Promise<EditResult> {
  const { writer, userId, videoId, origin, video, version, plan, done, edit } = input;
  const { plan: next, carry, refilm, revoice } = applyEdit(plan, edit);
  if (!next.scenes.length) return { ok: false, message: "That would leave the video with no scenes, so I've left it as it is." };

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

  await writer.from("video_projects").update({ current_version: nextVersion, title: next.title.slice(0, 160) }).eq("id", videoId);
  if (input.charge > 0) {
    await chargeCredits(service, {
      userId,
      action: "generate",
      cost: input.charge,
      description: `Video edit: ${next.title}`,
      outputTokens: input.outputTokens,
      dedupeKey: `video-edit:${videoId}:${nextVersion}`,
    });
  }

  /* 3. Only what is missing is made. */
  const missing = next.scenes.some((scene) => !carried.some((row) => row.scene === scene.n && (row.engine === "video" || row.engine === "avatar")))
    || next.scenes.some((scene) => usesVoice(next.cut) && scene.voiceover.trim() && !carried.some((row) => row.scene === scene.n && row.engine === "voice"));
  if (missing) {
    const rendered = await startRender(writer, userId, videoId, { onlyMissing: true }, origin);
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

function scenesWord(ns: number[]): string {
  return ns.length === 1 ? `scene ${ns[0]}` : `scenes ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}
