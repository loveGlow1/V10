/* Undo, Redo and Versions on a flier.
 *
 * Each message on a flier makes a set of versions — one flyer_jobs row,
 * usually four images — and every set is kept. Version 1 is the first set
 * made, version 2 the next, and so on, oldest first; a set deleted to Recently
 * deleted drops out, and one that failed or is still being made is not a
 * version to go back to.
 *
 * Which set is showing is projects.flier_current_job — null meaning the
 * newest. Undo, Redo and the Versions list move it to a set already made:
 * nothing is designed again and nothing is charged. The preview shows that
 * set large, and the next change is made from it (startFlierTurn), saved as a
 * new set — so nothing is ever overwritten. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordMessage } from "@/lib/thread-server";
import { isVersionMove, resolveMove } from "@/lib/version-moves";

import { liveOutputs, type Output } from "./trash";
import type { FlyerRequest } from "./types";

export type FlierVersion = { number: number; jobId: string; headline: string; images: number; createdAt: string };

type JobRow = { id: string; status: string; request: FlyerRequest | null; outputs: Output[] | null; created_at: string };

/** Numbers a flier's sets, oldest first, counting only those with images to show. Pure. */
export function numberSets(jobs: JobRow[]): FlierVersion[] {
  return [...jobs]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .filter((job) => job.status === "done" && liveOutputs(job.outputs).length > 0)
    .map((job, index) => ({
      number: index + 1,
      jobId: job.id,
      headline: job.request?.spec?.headline ?? "",
      images: liveOutputs(job.outputs).length,
      createdAt: job.created_at,
    }));
}

/** The set showing: the one pointed at while it is still a version, else the newest. Pure. */
export function showingSet(versions: FlierVersion[], pointer: string | null): FlierVersion | null {
  return versions.find((version) => version.jobId === pointer) ?? versions[versions.length - 1] ?? null;
}

/** A flier project's sets, which one is showing, and whether a new set is being made now. */
export async function flierVersions(
  client: SupabaseClient,
  projectId: string,
): Promise<{ versions: FlierVersion[]; showing: FlierVersion | null; making: boolean; pointer: string | null }> {
  const [{ data: project }, { data: jobs }] = await Promise.all([
    client.from("projects").select("flier_current_job").eq("id", projectId).maybeSingle<{ flier_current_job: string | null }>(),
    client
      .from("flyer_jobs")
      .select("id, status, request, outputs, created_at")
      .eq("site_id", projectId)
      .eq("stage", "preview")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(500)
      .returns<JobRow[]>(),
  ]);
  const rows = jobs ?? [];
  const versions = numberSets(rows);
  const pointer = project?.flier_current_job ?? null;
  return {
    versions,
    showing: showingSet(versions, pointer),
    making: rows.some((job) => job.status === "queued" || job.status === "running"),
    pointer,
  };
}

/**
 * A version move on a flier project, made and told in the thread. Null when
 * the message is not one — it is a change, and four new versions are made.
 * Never charges.
 */
export async function moveFlierVersion(input: {
  service: SupabaseClient;
  userId: string;
  projectId: string;
  prompt: string;
  explicit: boolean;
  requestId: string;
}): Promise<{ ok: boolean; message: string } | null> {
  const { service, userId, projectId, prompt, requestId } = input;
  if (!isVersionMove(prompt, input.explicit)) return null;
  const found = await flierVersions(service, projectId);

  await recordMessage(service, { projectId, userId, role: "you", body: prompt, dedupeKey: `you:${requestId}` });
  const say = async (ok: boolean, message: string) => {
    await recordMessage(service, { projectId, userId, role: "system", body: message, dedupeKey: `flier-version:${requestId}` });
    return { ok, message };
  };

  /* A set being made lands as the newest and shows when it is done; moving
     the pointer under it would hide it. */
  if (found.making) return say(false, "A new set is being made right now. Once it lands you can Undo back to any earlier set — nothing was changed.");
  if (!found.showing) return say(false, "This flier has no finished versions yet — describe it and four are made.");

  const move = resolveMove(prompt, found.showing.number, found.versions.map((version) => version.number), { one: "set", thing: "flier" });
  if (move.kind === "refuse") return say(false, move.message);
  if (move.kind === "list") {
    const lines = [...found.versions]
      .reverse()
      .slice(0, 15)
      .map((version) => `${version.number === found.showing?.number ? "▶ " : ""}Version ${version.number} — "${version.headline || "flier"}", ${version.images} images`);
    return say(true, `This flier's versions, newest first:\n${lines.join("\n")}\n\nSay "go back to version 2", or use Undo, Redo and Versions above the preview. Switching is instant and free.`);
  }

  const target = found.versions.find((version) => version.number === move.to);
  if (!target) return say(false, "That version couldn't be found. Nothing changed.");
  const newest = found.versions[found.versions.length - 1];
  const { error } = await service
    .from("projects")
    .update({ flier_current_job: target.jobId === newest.jobId ? null : target.jobId, status: "Built", last_build_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) return say(false, "That version couldn't be switched to just now. Nothing changed — try again.");

  const lead = move.how === "undo" ? "Undone" : move.how === "redo" ? "Redone" : "Switched";
  return say(
    true,
    `${lead} — now showing version ${target.number}, "${target.headline || "your flier"}" (${target.images} images). Nothing was designed again and no credits were used. Version ${found.showing.number} is still saved: Redo or "go back to version ${found.showing.number}" brings it back. Ask for a change and it's made from this version.`,
  );
}
