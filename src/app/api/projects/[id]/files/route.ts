/* The project's source, for the code editor.
 *
 * GET  the files of the newest build — a single-page project as its one
 *      index.html — with the build they came from.
 * PUT  the files the editor changed or added. Saved as a new build on top of
 *      the one the editor opened, exactly the way a visual edit is (see
 *      ../visual-edit/route.ts): the preview reads the newest build, so it
 *      shows the change as soon as this returns. No model, no credits.
 *
 * Owner-only: ownedProject settles that under the caller's own session, and
 * every write after it is addressed by the id it returned. */

import { NextResponse } from "next/server";

import { currentTree, storeTree } from "@/lib/builder/store-tree";
import { MAX_FILE_BYTES, SINGLE_PAGE, TreeError, isSinglePage, readTree } from "@/lib/builder/tree";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { recordMessage } from "@/lib/thread-server";

import { ownedProject } from "../backend/owned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOST_FILES = 200;

/* The same rule the project_files table enforces, checked here so a bad path
   is a sentence rather than a database error. */
function usablePath(path: string): boolean {
  return (
    path.length >= 1 &&
    path.length <= 200 &&
    !path.startsWith("/") &&
    !/(^|\/)\.\.(\/|$)/.test(path) &&
    !path.includes("\\") &&
    path === path.trim()
  );
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "The code is unavailable right now." }, { status: 503 });

  const { data: project, error: projectError } = await service
    .from("projects")
    .select("name")
    .eq("id", owned.projectId)
    .maybeSingle();
  if (projectError) {
    console.error("[files] project lookup failed:", projectError.message);
    return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });
  }

  const current = await currentTree(service, owned.projectId);
  if (current.sourceMissing) {
    return NextResponse.json(
      { error: "This project's source files are missing, so there is nothing to open. Rebuild it from the chat." },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      name: (project?.name as string | undefined) ?? "Project",
      buildId: current.buildId,
      singlePage: isSinglePage(current.tree),
      files: [...current.tree].sort((a, b) => a.path.localeCompare(b.path)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Saving is unavailable right now." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { baseBuildId?: unknown; files?: unknown } | null;
  const raw = Array.isArray(body?.files) ? body.files : [];
  if (raw.length === 0) return NextResponse.json({ error: "There is nothing to save." }, { status: 400 });
  if (raw.length > MOST_FILES) return NextResponse.json({ error: "Too many files in one save." }, { status: 400 });

  const changed: { path: string; content: string }[] = [];
  for (const entry of raw) {
    const path = typeof (entry as { path?: unknown })?.path === "string" ? ((entry as { path: string }).path) : "";
    const content = (entry as { content?: unknown })?.content;
    if (!usablePath(path) || typeof content !== "string") {
      return NextResponse.json({ error: `"${path || "(no name)"}" is not a file name that can be saved.` }, { status: 400 });
    }
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${path} is too large to save (the limit is 250 KB per file).` }, { status: 413 });
    }
    changed.push({ path, content });
  }

  const current = await currentTree(service, owned.projectId);
  if (current.sourceMissing) {
    return NextResponse.json({ error: "This project's source files are missing, so nothing can be saved." }, { status: 409 });
  }

  /* Saved on top of what the editor opened, or not at all: a build that landed
     in between (the chat, another tab) would otherwise be silently undone. */
  const base = typeof body?.baseBuildId === "string" ? body.baseBuildId : null;
  if (base !== current.buildId) {
    return NextResponse.json(
      { error: "The project changed since you opened it — a build or another tab saved first. Reload to get the newest code.", stale: true },
      { status: 409 },
    );
  }

  const single = isSinglePage(current.tree);
  let html = current.html ?? "";
  let tree: { path: string; content: string }[] = [];

  if (single) {
    const page = changed.find((file) => file.path === SINGLE_PAGE);
    if (!page || changed.length > 1) {
      return NextResponse.json({ error: `This project is a single page; only ${SINGLE_PAGE} can be saved.` }, { status: 400 });
    }
    html = page.content;
  } else {
    const files = new Map(current.tree.map((file) => [file.path, file.content]));
    for (const file of changed) files.set(file.path, file.content);
    try {
      tree = readTree([...files.entries()].map(([path, content]) => ({ path, content })));
    } catch (error) {
      if (error instanceof TreeError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }

  const names = changed.map((file) => file.path);
  const prompt = `Code edit: ${names.join(", ")}`.slice(0, 1000);
  const { data: build, error: buildError } = await service
    .from("project_builds")
    .insert({
      project_id: owned.projectId,
      user_id: owned.userId,
      prompt,
      html,
      model: "code-editor",
      files_touched: changed.length,
    })
    .select("id")
    .single();
  if (buildError || !build) {
    console.error("[files] build insert failed:", buildError?.message);
    return NextResponse.json({ error: "The code could not be saved. Nothing was changed." }, { status: 500 });
  }

  if (!single) {
    try {
      await storeTree(service, { buildId: build.id as string, projectId: owned.projectId, userId: owned.userId }, tree);
    } catch (error) {
      console.error("[files] storing the tree failed:", error);
      await service.from("project_builds").delete().eq("id", build.id);
      return NextResponse.json({ error: "The code could not be saved. Nothing was changed." }, { status: 500 });
    }
  }

  await service
    .from("projects")
    .update({ last_build_at: new Date().toISOString() })
    .eq("id", owned.projectId)
    .eq("user_id", owned.userId);

  await recordMessage(service, {
    projectId: owned.projectId,
    userId: owned.userId,
    role: "system",
    body: `Saved ${names.length === 1 ? names[0] : `${names.length} files`} from the code editor — no credits used. Publish when you want it on your live site.`,
    kind: "chat",
    dedupeKey: `code:${build.id}`,
  });

  return NextResponse.json({ buildId: build.id, saved: names });
}
