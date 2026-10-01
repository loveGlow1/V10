/* Visual edits, written straight into the source.
 *
 * The workspace's edit mode collects changes made by pointing at the preview
 * — new words for a heading, another colour for a button — and sends them
 * here together. Each is applied to the element it names (see
 * lib/builder/visual-edit.ts) and the result is stored as a new version, the
 * same way any build is, so the preview reloads with it and undo can step
 * back over it. No model is asked and nothing is charged: these are edits a
 * person made by hand, applied exactly.
 *
 * What cannot be applied exactly is handed back as `needsAi`, with the
 * reason, and the workspace sends it to the ordinary edit path with the
 * element's location — never guessed at here. */

import { NextResponse } from "next/server";

import { currentTree, storeTree } from "@/lib/builder/store-tree";
import { applyVisualEdit, describeChange, parseSrc, type VisualEdit } from "@/lib/builder/visual-edit";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { recordMessage } from "@/lib/thread-server";

import { ownedProject } from "../backend/owned";

const MOST = 50;
const GROUPS = new Set(["textColor", "background", "fontSize", "fontWeight", "padding", "align", "radius"]);

/* The request is a person's hand edits, so it is read narrowly: anything that
   is not one of these shapes is dropped rather than trusted. */
function readEdits(body: unknown): VisualEdit[] {
  const raw = (body as { edits?: unknown } | null)?.edits;
  if (!Array.isArray(raw)) return [];
  const edits: VisualEdit[] = [];
  for (const entry of raw.slice(0, MOST)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const change = (e.change ?? {}) as Record<string, unknown>;
    if (typeof e.src !== "string" || !parseSrc(e.src) || typeof e.tag !== "string") continue;
    const classes = Array.isArray(change.classes)
      ? change.classes
          .filter((c): c is { group: string; value: string } => !!c && typeof c === "object" && typeof (c as { group?: unknown }).group === "string" && typeof (c as { value?: unknown }).value === "string")
          .filter((c) => GROUPS.has(c.group) && /^[\w:./[\]()%,#-]*$/.test(c.value) && c.value.length <= 80)
          .map((c) => ({ group: c.group as NonNullable<VisualEdit["change"]["classes"]>[number]["group"], value: c.value }))
      : undefined;
    edits.push({
      src: e.src,
      tag: e.tag.toLowerCase(),
      className: typeof e.className === "string" ? e.className : undefined,
      text: typeof e.text === "string" ? e.text : undefined,
      change: {
        text: typeof change.text === "string" ? change.text.slice(0, 2000) : undefined,
        classes: classes && classes.length > 0 ? classes : undefined,
        imageSrc: typeof change.imageSrc === "string" ? change.imageSrc.slice(0, 2000) : undefined,
      },
    });
  }
  return edits;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Saving is unavailable right now." }, { status: 503 });

  const edits = readEdits(await request.json().catch(() => null));
  if (edits.length === 0) return NextResponse.json({ error: "There are no edits to apply." }, { status: 400 });

  const current = await currentTree(service, owned.projectId);
  if (current.sourceMissing || current.tree.length === 0 || !current.tree.some((file) => /\.(?:tsx|jsx)$/.test(file.path))) {
    return NextResponse.json(
      { error: "Visual edits work on app projects. Describe this change in the chat instead." },
      { status: 409 },
    );
  }

  const files = new Map(current.tree.map((file) => [file.path, file.content]));
  const applied: string[] = [];
  const touched = new Set<string>();
  const needsAi: { index: number; reason: string }[] = [];

  edits.forEach((edit, index) => {
    const path = parseSrc(edit.src)?.path ?? "";
    const source = files.get(path);
    if (source === undefined) {
      needsAi.push({ index, reason: "its file is not in this project" });
      return;
    }
    const result = applyVisualEdit(source, edit);
    if (!result.ok) {
      needsAi.push({ index, reason: result.reason });
      return;
    }
    if (result.source !== source) {
      files.set(path, result.source);
      touched.add(path);
      applied.push(describeChange(edit));
    }
  });

  if (applied.length === 0) {
    return NextResponse.json({ applied: 0, needsAi, buildId: current.buildId });
  }

  const prompt = `Visual edit: ${applied.join("; ")}`.slice(0, 1000);
  const { data: build, error: buildError } = await service
    .from("project_builds")
    .insert({
      project_id: owned.projectId,
      user_id: owned.userId,
      prompt,
      html: current.html ?? "",
      model: "visual-edit",
      files_touched: touched.size,
    })
    .select("id")
    .single();
  if (buildError || !build) {
    return NextResponse.json({ error: "The edits could not be saved. Nothing was changed." }, { status: 500 });
  }

  try {
    await storeTree(
      service,
      { buildId: build.id as string, projectId: owned.projectId, userId: owned.userId },
      [...files.entries()].map(([path, content]) => ({ path, content })),
    );
  } catch {
    await service.from("project_builds").delete().eq("id", build.id);
    return NextResponse.json({ error: "The edits could not be saved. Nothing was changed." }, { status: 500 });
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
    body: `Applied ${applied.length} visual edit${applied.length === 1 ? "" : "s"} — no credits used. Publish when you want them on your live site.`,
    kind: "chat",
    dedupeKey: `visual:${build.id}`,
  });

  return NextResponse.json({ applied: applied.length, needsAi, buildId: build.id });
}
