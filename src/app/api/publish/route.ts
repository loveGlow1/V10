import { NextResponse } from "next/server";

import { validatePage } from "@/lib/builder/validate";
import { publishedUrl, slugAttempt, slugFrom } from "@/lib/publish/naming";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Making a project live.
 *
 * The rule the whole route is built around: a project is marked Published when
 * it IS published, and at no earlier point. Every failure below leaves the
 * project exactly as it was — including a project that was already live, which
 * keeps serving the version it was serving.
 *
 * ── Why this does not create a Vercel deployment ──────────────────────────
 *
 * A project here is one HTML document. Giving each one its own Vercel project
 * and deployment would mean a per-user entry against this account's project
 * limit, thirty to sixty seconds of waiting, and a publish that can fail in the
 * middle for reasons nobody involved can act on.
 *
 * Publishing instead writes an immutable copy of the document and points the
 * project at it. It is one transaction, it takes milliseconds, and it cannot
 * half-succeed — which is not a shortcut but the strongest possible answer to
 * "never falsely mark a project as Published". Vercel is still what serves it:
 * this app runs there, and the published page is served by the route beside
 * this one. Where Vercel's API is genuinely needed — a customer's own domain,
 * and the certificate for it — it is used, in lib/publish/vercel-domains.ts.
 *
 * ── Why the document is copied rather than referenced ─────────────────────
 *
 * Because preview and production have to be separate, and a pointer at "the
 * newest build" is not separate at all — it would put every edit live the
 * instant it applied, and publishing would mean nothing. The copy is what makes
 * editing safe after launch. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A read, a validate and two writes. Nothing here waits on anything external. */
export const maxDuration = 30;

type Body = { projectId?: unknown };

function fail(message: string, status: number, stage: string) {
  return NextResponse.json({ error: message, stage, published: false }, { status });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("Publishing is unavailable — this workspace has no Supabase configured.", 503, "config");

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Sign in to publish.", 401, "auth");

  const body = (await request.json().catch(() => ({}))) as Body;
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (!projectId) return fail("No project was named.", 400, "request");

  /* ── Validate the project ────────────────────────────────────────────────
     Read under the caller's session, so RLS answers "is this yours" and a
     project id belonging to somebody else simply is not found. */
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, slug, status, deleted_at, published_version_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return fail("That project could not be found.", 404, "validate");
  if (project.deleted_at) return fail("That project has been deleted.", 410, "validate");

  const { data: build } = await supabase
    .from("project_builds")
    .select("id, html")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!build?.html) {
    return fail("There's nothing to publish yet — build the page first.", 422, "validate");
  }

  /* The same check an edit has to pass before it is stored, applied again here
     against nothing. A page can only reach this table by passing it, so this is
     belt and braces — but it is the last gate before something becomes public,
     and a structurally broken page going live is worse than one stored. */
  const verdict = validatePage("", build.html as string);
  if (!verdict.ok) {
    return fail(`That page isn't ready to publish — ${verdict.problem}.`, 422, "validate");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return fail("Publishing is unavailable — this workspace has no service key set.", 503, "config");
  }

  /* ── The address ─────────────────────────────────────────────────────────
     Kept once it exists: a published project's URL is something people have
     linked to, and re-deriving it from a renamed project would break those
     links silently. */
  let slug = project.slug as string | null;

  if (!slug) {
    const base = slugFrom(project.name as string) ?? slugFrom(`site-${projectId.slice(0, 8)}`);
    if (!base) return fail("That project's name can't be turned into a web address. Rename it and try again.", 422, "address");

    /* Walked until the database accepts one. The unique index is what actually
       settles it — two people can publish "shop" in the same second, and only
       the index sees both. */
    for (let attempt = 0; attempt < 25 && !slug; attempt += 1) {
      const candidate = slugAttempt(base, attempt);
      const { error } = await service
        .from("projects")
        .update({ slug: candidate })
        .eq("id", projectId)
        .eq("user_id", user.id);

      if (!error) slug = candidate;
      /* 23505 is unique_violation: taken, try the next. Anything else is a real
         failure and must not be retried into a loop. */
      else if (error.code !== "23505") {
        return fail("The web address couldn't be reserved. Try again in a moment.", 502, "address");
      }
    }

    if (!slug) return fail("Every address close to that name is taken. Rename the project and try again.", 409, "address");
  }

  /* ── The snapshot ────────────────────────────────────────────────────────
     Written before the project is marked published, so the pointer can never
     name a row that does not exist. */
  const { data: previous } = await service
    .from("project_publications")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = ((previous?.version as number | undefined) ?? 0) + 1;

  const { data: publication, error: snapshotError } = await service
    .from("project_publications")
    .insert({
      project_id: projectId,
      user_id: user.id,
      build_id: build.id,
      html: build.html,
      version,
    })
    .select("id, version, published_at")
    .single();

  if (snapshotError || !publication) {
    /* Nothing has changed. A project that was live is still live on its old
       version, and one that was not is still not published. */
    // eslint-disable-next-line no-console
    console.error("publish: the snapshot could not be written:", snapshotError);
    return fail("That couldn't be published just now. Nothing has changed — try again.", 502, "snapshot");
  }

  /* ── Live ────────────────────────────────────────────────────────────────
     The last write, and the only one that makes anything public. */
  const { error: liveError } = await service
    .from("projects")
    .update({
      published_version_id: publication.id,
      published_at: publication.published_at,
      status: "Published",
    })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (liveError) {
    /* The snapshot exists and nothing points at it, which is harmless — it is
       a version in the history that was never served. The project is untouched,
       so this is reported as the failure it is rather than as a publish. */
    // eslint-disable-next-line no-console
    console.error("publish: the project could not be marked live:", liveError);
    return fail("That couldn't be made live just now. Nothing has changed — try again.", 502, "live");
  }

  return NextResponse.json({
    published: true,
    url: publishedUrl(slug),
    slug,
    version: publication.version,
    publishedAt: publication.published_at,
    /* True when this replaced a version that was already live, which is what
       decides whether the reply says "published" or "updated". */
    replaced: Boolean(project.published_version_id),
  });
}

/** Takes a project off the web, leaving its history intact. */
export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("Publishing is unavailable.", 503, "config");

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Sign in first.", 401, "auth");

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return fail("No project was named.", 400, "request");

  const service = createSupabaseServiceClient();
  if (!service) return fail("Publishing is unavailable.", 503, "config");

  /* The publications stay. Unpublishing is "stop serving this", not "destroy
     what was served" — and re-publishing should be able to say which version
     is going back up. */
  const { error } = await service
    .from("projects")
    .update({ published_version_id: null, published_at: null, status: "Built" })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (error) return fail("That couldn't be taken down just now. Try again.", 502, "live");

  return NextResponse.json({ published: false });
}
