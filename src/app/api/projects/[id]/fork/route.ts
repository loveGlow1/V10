import { NextResponse } from "next/server";

import { newestStoredTree, storeTree } from "@/lib/builder/store-tree";
import { previewUrl } from "@/lib/publish/naming";
import { reserveSlug } from "@/lib/publish/reserve";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";

/* Fork: a second app that starts exactly where this one is.
 *
 * It used to be a new, empty project with " copy" on the name — a fork in the
 * menu and a blank page when you opened it. This copies what the app IS: its
 * latest version of the page, the source files behind it when it is a project
 * rather than a page, and the architecture the editor reads before every
 * change. Not copied, on purpose: the conversation (the fork starts its own),
 * the published address and domains (the fork is not live until it is
 * published), connected databases and GitHub (those are this app's), and older
 * versions (undo in the fork starts from the fork).
 *
 * Ownership is checked under the caller's own session; the copying runs with
 * the service role, because builds and files are written server-side only. Any
 * failure after the new project exists removes it, so a half-made fork is
 * never left in the list. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Forking is unavailable right now." }, { status: 503 });
  }

  const { data: source } = await service
    .from("projects")
    .select("id, name, prompt, intent, status")
    .eq("id", owned.projectId)
    .eq("user_id", owned.userId)
    .maybeSingle<{ id: string; name: string; prompt: string | null; intent: string | null; status: string }>();
  if (!source) return NextResponse.json({ error: "No such project." }, { status: 404 });

  const { data: build } = await service
    .from("project_builds")
    .select("prompt, html, model, files_touched")
    .eq("project_id", source.id)
    .eq("user_id", owned.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ prompt: string; html: string; model: string | null; files_touched: number }>();

  const name = `${source.name} (fork)`.slice(0, 120);
  const { data: created, error: createError } = await service
    .from("projects")
    .insert({
      user_id: owned.userId,
      name,
      prompt: source.prompt,
      intent: source.intent,
      status: build ? "Built" : "Draft",
    })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (createError || !created) {
    return NextResponse.json({ error: "The fork could not be created." }, { status: 500 });
  }

  const undo = async (reason: string) => {
    await service.from("projects").delete().eq("id", created.id).eq("user_id", owned.userId);
    // eslint-disable-next-line no-console
    console.error(`fork: ${source.id} → ${created.id} failed: ${reason}`);
    return NextResponse.json({ error: "The fork could not be completed. Nothing was changed." }, { status: 500 });
  };

  try {
    if (build) {
      const { data: copied, error: buildError } = await service
        .from("project_builds")
        .insert({
          project_id: created.id,
          user_id: owned.userId,
          prompt: build.prompt,
          html: build.html,
          model: build.model,
          files_touched: build.files_touched,
        })
        .select("id")
        .single<{ id: string }>();
      if (buildError || !copied) return await undo(buildError?.message ?? "no build row");

      /* The source behind it, when there is any. */
      const stored = await newestStoredTree(service, source.id);
      if (stored && stored.tree.length > 0) {
        await storeTree(service, { buildId: copied.id, projectId: created.id, userId: owned.userId }, stored.tree);
      }

      const { data: architecture } = await service
        .from("project_architecture")
        .select("kind, manifest, design_system, stack")
        .eq("project_id", source.id)
        .maybeSingle();
      if (architecture) {
        await service.from("project_architecture").insert({ ...architecture, project_id: created.id, user_id: owned.userId });
      }

      /* Its own address, made from its own name, as a first build would. */
      const reserved = await reserveSlug(service, created, owned.userId);
      const slug = "slug" in reserved ? reserved.slug : null;
      await service
        .from("projects")
        .update({ preview_url: previewUrl({ id: created.id, slug }), last_build_at: new Date().toISOString() })
        .eq("id", created.id)
        .eq("user_id", owned.userId);
    }
  } catch (error) {
    return await undo(error instanceof Error ? error.message : String(error));
  }

  return NextResponse.json({ id: created.id, name: created.name, copiedBuild: Boolean(build) });
}
