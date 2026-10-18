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
import type { SupabaseClient } from "@supabase/supabase-js";

import { liveJob } from "@/lib/jobs/store";

import { currentTree, storeTree } from "@/lib/builder/store-tree";
import { applySinglePageClasses, applySinglePageText, applyVisualEdit, describeChange, parseSrc, type VisualEdit } from "@/lib/builder/visual-edit";
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

/* A change by the agent in flight on this project: a live build job (an
   edit or a build) still holding its lease or started in the last few
   minutes, or a full build the project row still says is running. A job left
   behind by a killed request stops counting once its lease and a grace
   period have passed, so a stale row cannot lock hand edits out for good. */
async function agentBusy(service: SupabaseClient, projectId: string): Promise<boolean> {
  const now = Date.now();
  const job = await liveJob(service, projectId);
  if (job) {
    const leased = job.lockedUntil ? Date.parse(job.lockedUntil) > now : false;
    const recent = now - Date.parse(job.createdAt) < 5 * 60_000;
    if (leased || recent) return true;
  }
  const { data: project } = await service.from("projects").select("status, updated_at").eq("id", projectId).maybeSingle<{ status: string | null; updated_at: string | null }>();
  return project?.status === "Building" && project.updated_at !== null && now - Date.parse(project.updated_at) < 15 * 60_000;
}

/* "the heading now reads “…”" — what was typed, in words. */
function typedSummary(edits: VisualEdit[]): string {
  const names: Record<string, string> = { h1: "the heading", h2: "the heading", h3: "the heading", p: "the paragraph", a: "the link", button: "the button", li: "the list item" };
  const styleWords: Record<string, string> = { textColor: "text colour", background: "background", fontSize: "size", fontWeight: "weight", align: "alignment", padding: "spacing", radius: "corners" };
  return edits
    .slice(0, 3)
    .map((edit) => {
      const what = names[edit.tag] ?? `the ${edit.tag}`;
      if (typeof edit.change.text === "string") return `${what} now reads “${edit.change.text.trim().slice(0, 80)}”`;
      const styles = (edit.change.classes ?? []).map((change) => styleWords[change.group] ?? change.group);
      return `${what}: ${styles.join(", ") || "style"} changed`;
    })
    .join("; ");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Saving is unavailable right now." }, { status: 503 });

  const edits = readEdits(await request.json().catch(() => null));
  if (edits.length === 0) return NextResponse.json({ error: "There are no edits to apply." }, { status: 400 });

  /* One writer at a time. While the agent is changing this project, a hand
     edit saved now would be overwritten by the agent's version (made from
     the page before it). The workspace holds the edit and tries again once
     the agent has finished, on top of the agent's change. */
  if (await agentBusy(service, owned.projectId)) {
    return NextResponse.json(
      { error: "The agent is changing this page right now. Your text is saved as soon as it finishes.", code: "agent_busy" },
      { status: 409 },
    );
  }

  const current = await currentTree(service, owned.projectId);

  /* A single page: words typed into the preview, written into the one HTML
     document, as a new version. Only text is done by hand here; anything
     else goes back as needsAi. */
  if (!current.sourceMissing && current.html && !current.tree.some((file) => /\.(?:tsx|jsx)$/.test(file.path))) {
    let html = current.html;
    const done: string[] = [];
    const missed: { index: number; reason: string }[] = [];
    edits.forEach((edit, index) => {
      const typed = typeof edit.change.text === "string";
      const styled = Boolean(edit.change.classes?.length);
      if ((!typed && !styled) || edit.change.imageSrc) {
        missed.push({ index, reason: "only typed text and quick styles are applied by hand on a single page" });
        return;
      }
      let next = html;
      if (typed) {
        const result = applySinglePageText(next, { src: edit.src, tag: edit.tag, before: edit.text ?? "", text: edit.change.text as string });
        if (!result.ok) {
          missed.push({ index, reason: result.reason });
          return;
        }
        next = result.source;
      }
      if (styled) {
        const result = applySinglePageClasses(next, { src: edit.src, tag: edit.tag, className: edit.className ?? "", classes: edit.change.classes ?? [] });
        if (!result.ok) {
          missed.push({ index, reason: result.reason });
          return;
        }
        next = result.source;
      }
      if (next !== html) {
        html = next;
        done.push(describeChange(edit));
      }
    });
    if (done.length === 0) return NextResponse.json({ applied: 0, needsAi: missed, buildId: current.buildId });
    const { data: page, error: pageError } = await service
      .from("project_builds")
      .insert({
        project_id: owned.projectId,
        user_id: owned.userId,
        prompt: `Visual edit: ${done.join("; ")}`.slice(0, 1000),
        html,
        model: "visual-edit",
        files_touched: 1,
      })
      .select("id")
      .single();
    if (pageError || !page) return NextResponse.json({ error: "The edit could not be saved. Nothing was changed." }, { status: 500 });
    await service.from("projects").update({ last_build_at: new Date().toISOString() }).eq("id", owned.projectId).eq("user_id", owned.userId);
    /* In the thread too, so the conversation and the version history tell
       the same story: this version was typed by hand, not made by the agent. */
    await recordMessage(service, {
      projectId: owned.projectId,
      userId: owned.userId,
      role: "system",
      body: `Edited by hand in the preview — ${typedSummary(edits)}. Saved as a new version; no credits used.`,
      dedupeKey: `visual-edit:${page.id}`,
    });
    return NextResponse.json({ applied: done.length, needsAi: missed, buildId: page.id });
  }

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
