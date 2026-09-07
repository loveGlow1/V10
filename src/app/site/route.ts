import { SITE_DOMAIN_HEADER, SITE_SLUG_HEADER } from "@/lib/publish/headers";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Serving a published project to the public.
 *
 * The middleware rewrites here when a request arrives on a project's own
 * hostname — shop.quickstark.tech, or a customer's domain — carrying which one
 * in a header it sets itself. Nothing in this file trusts the request's own
 * Host: a header a caller can write is not an identity, and the whole
 * separation between this and the dashboard would rest on it.
 *
 * ── Why this is not /preview ──────────────────────────────────────────────
 *
 * The preview route serves the NEWEST BUILD to its OWNER, under their session,
 * with RLS answering. This serves a PUBLISHED SNAPSHOT to ANYONE, under the
 * service key, with the publish pointer answering. Those are opposite in both
 * halves, and the one thing they must never share is a code path where a
 * mistake makes a private page public.
 *
 * ── The sandbox ───────────────────────────────────────────────────────────
 *
 * A published page is still a document a model wrote to somebody's prompt, and
 * it now runs on a hostname under our domain. Without the sandbox header its
 * scripts would share an origin with every other published project on
 * *.quickstark.tech — one person's page could read another's storage. The
 * header puts every response in an opaque origin, so scripts run and reach
 * nothing. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



function notFound(message: string, status = 404) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not published</title></head><body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#0b0b0f;color:#8b8b93;font:15px/1.6 system-ui,sans-serif"><p style="max-width:36ch;text-align:center;padding:24px">${message}</p></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: Request) {
  const slug = request.headers.get(SITE_SLUG_HEADER);
  const domain = request.headers.get(SITE_DOMAIN_HEADER);
  if (!slug && !domain) return notFound("There is no site at this address.");

  /* The service key, because a published page has no reader to be. RLS cannot
     answer "may the public see this" — the publish pointer is what answers it,
     and the query below is written so that a project with no live publication
     simply produces no row. */
  const service = createSupabaseServiceClient();
  if (!service) return notFound("This site is temporarily unavailable.", 503);

  let projectId: string | null = null;
  let publicationId: string | null = null;

  if (slug) {
    const { data } = await service
      .from("projects")
      .select("id, published_version_id, deleted_at")
      .eq("slug", slug)
      .maybeSingle();

    if (data && !data.deleted_at) {
      projectId = data.id as string;
      publicationId = data.published_version_id as string | null;
    }
  } else if (domain) {
    /* A custom domain is only a site while the row says it is live AND the
       project it points at is published. Two conditions, both required: a
       domain left connected to a project that was later unpublished must stop
       serving, not keep serving the last version. */
    const { data: connected } = await service
      .from("project_domains")
      .select("project_id, status")
      .eq("domain", domain)
      .maybeSingle();

    if (connected?.status === "live") {
      const { data } = await service
        .from("projects")
        .select("id, published_version_id, deleted_at")
        .eq("id", connected.project_id)
        .maybeSingle();

      if (data && !data.deleted_at) {
        projectId = data.id as string;
        publicationId = data.published_version_id as string | null;
      }
    }
  }

  if (!projectId) return notFound("There is no site at this address.");
  if (!publicationId) {
    /* The address is real and nothing is live on it — a project unpublished, or
       one whose domain was connected before it was ever published. Said
       differently from "no such address" because the owner can act on it. */
    return notFound("This site hasn't been published yet.");
  }

  const { data: publication } = await service
    .from("project_publications")
    .select("html, version")
    .eq("id", publicationId)
    .maybeSingle();

  if (!publication?.html) return notFound("This site hasn't been published yet.");

  return new Response(publication.html as string, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      /* The line that makes serving somebody else's document safe. Scripts and
         forms run because a real site needs them; same-origin is withheld, so
         one published project cannot reach another's storage or this app's
         session cookie. */
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
      "X-Content-Type-Options": "nosniff",
      /* A published page only changes when somebody publishes, so it is worth
         caching at the edge — and it must revalidate rather than go stale for
         an hour, because "I published and it still shows the old one" is the
         complaint this would cause. */
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      /* Which version is being served, for anybody debugging exactly the
         above. */
      "X-Quickstark-Version": String(publication.version ?? ""),
    },
  });
}
