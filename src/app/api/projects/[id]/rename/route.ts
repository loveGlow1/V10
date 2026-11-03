import { NextResponse } from "next/server";

import { existingVercelProject } from "@/lib/publish/deployment-store";
import { addressFor, previewUrl, publishedUrl, slugAttempt } from "@/lib/publish/naming";
import { attachPageDomain } from "@/lib/publish/page-domain";
import { appDomainFor, attachProjectDomain, vercelCredentials } from "@/lib/publish/vercel-deploy";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";

/* Renaming an app, and moving its address with it.
 *
 * The name, the published address and the preview link are one identity: a
 * project renamed "Jimmy Bankz Logistics" kept answering on
 * premium-mobile-first-landing.quickstark.tech, and Share went on handing that
 * out. So a rename now gives the project the address its new name makes —
 * jimmy-bankz-logistics.quickstark.tech, numbered if taken — and keeps the old
 * one in previous_slugs, so every link already shared redirects to the new one
 * (serve.ts for the published site, /[slug]/preview for the preview).
 *
 * A published project gets the new address attached on Vercel straight away:
 * a page to this app's own project (page-domain.ts), an application to its
 * own. The old address stays attached, which is what lets it redirect. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEP = 10;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 120) return NextResponse.json({ error: "Give the app a name of up to 120 characters." }, { status: 400 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Renaming is unavailable right now." }, { status: 503 });

  const { data: project } = await service
    .from("projects")
    .select("id, slug, previous_slugs, published_at")
    .eq("id", owned.projectId)
    .maybeSingle<{ id: string; slug: string | null; previous_slugs: string[] | null; published_at: string | null }>();
  if (!project) return NextResponse.json({ error: "No such project." }, { status: 404 });

  const { error: nameError } = await service.from("projects").update({ name }).eq("id", project.id);
  if (nameError) return NextResponse.json({ error: "That name couldn't be saved." }, { status: 502 });

  /* The address the new name makes. Unchanged when the project already has it
     (or a numbered form of it): renaming "Shop" to "shop" must not move a site. */
  const base = addressFor(name, project.id);
  let slug = project.slug;
  const already = Boolean(base && slug && (slug === base || new RegExp(`^${base}-\\d+$`).test(slug)));

  if (base && !already) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const candidate = slugAttempt(base, attempt);
      const previous = [...(project.previous_slugs ?? []).filter((s) => s !== candidate), ...(project.slug ? [project.slug] : [])].slice(-KEEP);
      const { error } = await service
        .from("projects")
        .update({ slug: candidate, previous_slugs: previous, preview_url: previewUrl({ id: project.id, slug: candidate }) })
        .eq("id", project.id);
      if (!error) {
        slug = candidate;
        break;
      }
      if (error.code !== "23505") break;
    }
  }

  let published: string | null = null;
  if (project.published_at && slug) {
    const vercelProject = await existingVercelProject(service, project.id);
    if (vercelProject) {
      const wanted = appDomainFor(slug);
      const creds = vercelCredentials();
      if (wanted && creds) {
        const bound = await attachProjectDomain(vercelProject, wanted, creds).catch(() => ({ ok: false as const, reason: "unreachable" }));
        if (bound.ok) published = `https://${wanted}`;
      }
    } else {
      await attachPageDomain(slug);
      published = publishedUrl(slug);
    }
    if (published) await service.from("projects").update({ published_url: published }).eq("id", project.id);
  }

  return NextResponse.json({
    name,
    slug,
    moved: slug !== project.slug,
    previewUrl: previewUrl({ id: project.id, slug }),
    publishedUrl: published,
  });
}
