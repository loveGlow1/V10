/* A project's versions, for the workspace's version list.
 *
 * Every change is a numbered row in project_builds, oldest first, and none is
 * ever deleted (see lib/builder/versions.ts). This reads them back — number,
 * what the change was, when — and which one is showing now, so the list can
 * mark it. Restoring is not done here: the list sends "Go back to version N"
 * to the chat as an undo, so the restore, the thread and the preview take the
 * one path a typed "undo" takes, and a version picked from the list is the
 * exact row it names. */

import { NextResponse } from "next/server";

import { contentOf, listVersions, redoTarget } from "@/lib/builder/versions";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { videoVersions } from "@/lib/video/versions";
import { flierVersions } from "@/lib/flyers/versions";

import { ownedProject } from "../backend/owned";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Versions are unavailable right now." }, { status: 503 });

  const { data: project } = await service.from("projects").select("intent").eq("id", owned.projectId).maybeSingle<{ intent: string | null }>();

  /* A flier's versions are its sets of images, oldest first; the one showing
     is projects.flier_current_job — see lib/flyers/versions.ts. */
  if (project?.intent === "flier") {
    const flier = await flierVersions(service, owned.projectId);
    const showing = flier.showing?.number ?? null;
    return NextResponse.json({
      supported: true,
      kind: "flier",
      showing,
      redo: showing === null ? null : flier.versions.find((version) => version.number > showing)?.number ?? null,
      versions: [...flier.versions].reverse().map((version) => ({
        number: version.number,
        label: `${version.headline ? `"${version.headline}"` : "Flier"} · ${version.images} images`,
        createdAt: version.createdAt,
        restoredFrom: null,
      })),
    });
  }

  /* A video's versions are its cuts (video_versions), and the one playing is
     its current_version — see lib/video/versions.ts. */
  if (project?.intent === "video") {
    const video = await videoVersions(service, owned.projectId);
    const numbers = (video?.versions ?? []).map((row) => row.version);
    const next = numbers.filter((n) => n > (video?.current ?? 0)).sort((a, b) => a - b)[0] ?? null;
    return NextResponse.json({
      supported: true,
      kind: "video",
      showing: video?.current ?? null,
      redo: next,
      versions: (video?.versions ?? []).map((row) => ({
        number: row.version,
        label: row.note?.trim() || (row.version === 1 ? "First cut" : "A change"),
        createdAt: row.created_at,
        restoredFrom: null,
      })),
    });
  }

  const versions = await listVersions(service, owned.projectId);
  const newest = versions[versions.length - 1];
  return NextResponse.json({
    supported: true,
    kind: "page",
    /* The number of what is showing: the newest row, or for a restore the
       version it copied. */
    showing: newest ? contentOf(versions, newest.number) : null,
    /* What Redo would put back — null when nothing has been undone since
       the last change, which is when the Redo button is off. */
    redo: redoTarget(versions),
    versions: versions
      .map((version) => ({
        number: version.number,
        label: version.label,
        createdAt: version.createdAt,
        restoredFrom: version.restoredFrom,
      }))
      .reverse(),
  });
}
