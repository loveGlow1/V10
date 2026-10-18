/* Undo, Redo and Versions on a video.
 *
 * A video's versions are its own rows — video_versions, one per plan, each
 * with its clips, voice and final cut in video_renders — and the one the
 * preview plays is video_projects.current_version. So going back is moving
 * that pointer: the earlier cut is already made, and nothing is planned,
 * rendered or charged. (Sending "undo" to the director instead, as every
 * message on a video used to be, would plan a new version and render it all
 * again.)
 *
 *   Undo      the version before the one playing
 *   Redo      the version after it
 *   a number  that exact version ("go back to version 2", or picked in the
 *             Versions list)
 *
 * A change asked for after going back is planned from the version playing and
 * saved as the newest number, so nothing is ever overwritten. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseTarget, readVersionRequest, REDO_ASK } from "@/lib/builder/versions";
import { recordMessage } from "@/lib/thread-server";

/* A bare "undo" — the one phrasing parseTarget leaves to its caller. */
const UNDO_ASK = /^\s*(?:please\s+)?(?:undo|revert)(?:\s+(?:it|that|this|the last change|the last edit|my last change))?[.!\s]*$/i;

export type VideoMove =
  | { kind: "go"; to: number; how: "undo" | "redo" | "pick" }
  | { kind: "list" }
  | { kind: "refuse"; message: string };

/** Whether a message on a video is a move between versions rather than a change. Pure. */
export function isVideoVersionAsk(prompt: string, explicit: boolean): boolean {
  return explicit || REDO_ASK.test(prompt) || UNDO_ASK.test(prompt) || readVersionRequest(prompt) !== null;
}

/** Where a version move goes, given the version playing and every version there is. Pure. */
export function resolveVideoMove(prompt: string, current: number, versions: number[]): VideoMove {
  const all = [...new Set(versions)].sort((a, b) => a - b);
  if (!all.length) return { kind: "refuse", message: "This video has no versions yet — describe it and it will be planned." };
  const newest = all[all.length - 1];

  if (REDO_ASK.test(prompt)) {
    const next = all.find((version) => version > current);
    return next === undefined
      ? { kind: "refuse", message: `There's nothing to redo — version ${current} is the newest cut. To pick any version, open Versions.` }
      : { kind: "go", to: next, how: "redo" };
  }
  if (readVersionRequest(prompt)?.kind === "list") return { kind: "list" };

  const target = UNDO_ASK.test(prompt) ? { kind: "back" as const, steps: 1 } : parseTarget(prompt, new Date(), "UTC");
  let to: number | null = null;
  let how: "undo" | "pick" = "pick";
  if (!target || target.kind === "back") {
    const steps = target?.kind === "back" ? target.steps : 1;
    const earlier = all.filter((version) => version < current);
    if (earlier.length === 0) return { kind: "refuse", message: `There's nothing to undo — version ${current} is the first cut of this video.` };
    to = earlier[Math.max(0, earlier.length - steps)];
    how = "undo";
  } else if (target.kind === "number") {
    if (!all.includes(target.number)) {
      return { kind: "refuse", message: `There's no version ${target.number} — this video has versions ${all[0]}–${newest}. Open Versions to see them all.` };
    }
    to = target.number;
  } else if (target.kind === "latest") {
    to = newest;
  } else {
    return { kind: "refuse", message: 'For a video, name the version — say "go back to version 2", or open Versions and pick one.' };
  }
  if (to === current) return { kind: "refuse", message: `Version ${current} is already the one playing.` };
  return { kind: "go", to, how };
}

type VersionRow = { version: number; note: string | null; created_at: string };

/** The video behind a workspace project: its id, the version playing, and every version, newest first. */
export async function videoVersions(
  client: SupabaseClient,
  projectId: string,
): Promise<{ videoId: string; current: number; status: string; versions: VersionRow[] } | null> {
  const { data: video } = await client
    .from("video_projects")
    .select("id, current_version, status")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; current_version: number | null; status: string }>();
  if (!video) return null;
  const { data } = await client
    .from("video_versions")
    .select("version, note, created_at")
    .eq("video_id", video.id)
    .order("version", { ascending: false })
    .limit(200);
  return { videoId: video.id, current: video.current_version ?? 0, status: video.status, versions: (data ?? []) as VersionRow[] };
}

/** What a version's own renders say it is: still rendering, made, or only planned. Pure. */
export function statusOf(renders: { engine: string; status: string }[]): "rendering" | "ready" | "planned" {
  if (renders.some((row) => row.status === "running" || row.status === "queued")) return "rendering";
  if (renders.some((row) => (row.engine === "video" || row.engine === "avatar" || row.engine === "compose") && row.status === "done")) return "ready";
  return "planned";
}

const describe = (row: VersionRow | undefined) => (row?.note?.trim() ? ` — "${row.note.trim().slice(0, 80)}"` : "");

/**
 * A version move on a video project, made and told in the thread. Null when
 * the message is not one — the director takes it as a change. Never charges.
 */
export async function moveVideoVersion(input: {
  service: SupabaseClient;
  userId: string;
  projectId: string;
  prompt: string;
  explicit: boolean;
  requestId: string;
}): Promise<{ ok: boolean; message: string } | null> {
  const { service, userId, projectId, prompt, requestId } = input;
  if (!isVideoVersionAsk(prompt, input.explicit)) return null;
  const found = await videoVersions(service, projectId);
  if (!found) return null;

  await recordMessage(service, { projectId, userId, role: "you", body: prompt, dedupeKey: `you:${requestId}` });
  const say = async (ok: boolean, message: string) => {
    await recordMessage(service, { projectId, userId, role: "system", body: message, dedupeKey: `video-version:${requestId}` });
    return { ok, message };
  };

  const move = resolveVideoMove(prompt, found.current, found.versions.map((row) => row.version));
  if (move.kind === "refuse") return say(false, move.message);
  if (move.kind === "list") {
    const lines = found.versions
      .slice(0, 15)
      .map((row) => `${row.version === found.current ? "▶ " : ""}Version ${row.version}${describe(row)}`);
    return say(true, `This video's versions, newest first:\n${lines.join("\n")}\n\nSay "go back to version 2", or use Undo, Redo and Versions above the preview. Switching is instant and free.`);
  }

  const { data: renders } = await service.from("video_renders").select("engine, status").eq("video_id", found.videoId).eq("version", move.to);
  const status = statusOf((renders ?? []) as { engine: string; status: string }[]);
  const { error } = await service.from("video_projects").update({ current_version: move.to, status }).eq("id", found.videoId);
  if (error) return say(false, "That version couldn't be switched to just now. Nothing changed — try again.");
  await service.from("projects").update({ status: "Built", last_build_at: new Date().toISOString() }).eq("id", projectId);

  const row = found.versions.find((version) => version.version === move.to);
  const lead = move.how === "undo" ? "Undone" : move.how === "redo" ? "Redone" : "Switched";
  const state =
    status === "ready"
      ? "Its cut is already made, so it's playing now — nothing was rendered again and no credits were used."
      : status === "rendering"
        ? "Its clips are still rendering and will land in the preview."
        : 'It was planned but never rendered — say "render it" to render it.';
  return say(
    true,
    `${lead} — now playing version ${move.to}${describe(row)}. ${state} Version ${found.current} is still saved: Redo or "go back to version ${found.current}" brings it back. Ask for a change and it's made from this version.`,
  );
}
