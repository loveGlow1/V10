import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Handing a published page to whoever asked for it.
 *
 * Two entry points reach this and they must never answer differently:
 *
 *   /s/<slug>          the address every published project gets
 *   a custom domain    rewritten here by the middleware
 *
 * They are the same site by two names, so the lookup, the checks and the
 * headers live here rather than in either of them.
 *
 * ── The sandbox is the whole security model, and it carries more weight now ──
 *
 * A published page used to sit on its own subdomain — shop.quickstark.tech —
 * which gave it its own origin for free. Served at /s/shop it shares an origin
 * with the dashboard, the API and the session cookie. So the sandbox header
 * stopped being defence in depth and became the only thing between a document
 * a model wrote to somebody's prompt and the signed-in user's account.
 *
 * It is equal to the job: `Content-Security-Policy: sandbox` without
 * `allow-same-origin` puts the response in an OPAQUE origin whatever URL it
 * was served from. Scripts run, so the page works; document.cookie is empty,
 * storage throws, and a fetch to /api/build is cross-origin and carries no
 * credentials. That is why the header is not a precaution to be trimmed, and
 * why allow-same-origin must never be added to it.
 *
 * ── Why this is not /preview ──────────────────────────────────────────────
 *
 * The preview route serves the NEWEST BUILD to its OWNER, under their session,
 * with RLS answering. This serves a PUBLISHED SNAPSHOT to ANYONE, under the
 * service key, with the publish pointer answering. Opposite in both halves,
 * and they must never share a code path where a mistake makes a private page
 * public. */

/* What was asked for, or nothing — a request that reached a serving route
   without an address is a real case (a direct hit on /site, a path segment
   that could never have been issued) and it is answered rather than guarded
   against at every call site. */
export type Asked = { slug: string } | { domain: string } | null;

function notFound(message: string, status = 404): Response {
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

export async function servePublished(asked: Asked): Promise<Response> {
  if (!asked) return notFound("There is no site at this address.");

  /* The service key, because a published page has no reader to be. RLS cannot
     answer "may the public see this" — the publish pointer answers it, and the
     reads below are written so a project with nothing live produces no page. */
  const service = createSupabaseServiceClient();
  if (!service) return notFound("This site is temporarily unavailable.", 503);

  let publicationId: string | null = null;
  let found = false;

  if ("slug" in asked) {
    const { data } = await service
      .from("projects")
      .select("published_version_id, deleted_at")
      .eq("slug", asked.slug)
      .maybeSingle();

    if (data && !data.deleted_at) {
      found = true;
      publicationId = data.published_version_id as string | null;
    }
  } else {
    /* A custom domain is a site only while its row says live AND the project
       it points at is published. Both are required: a domain left connected to
       a project that was later unpublished must stop serving, not keep serving
       the last version it saw. */
    const { data: connected } = await service
      .from("project_domains")
      .select("project_id, status")
      .eq("domain", asked.domain)
      .maybeSingle();

    if (connected?.status === "live") {
      const { data } = await service
        .from("projects")
        .select("published_version_id, deleted_at")
        .eq("id", connected.project_id)
        .maybeSingle();

      if (data && !data.deleted_at) {
        found = true;
        publicationId = data.published_version_id as string | null;
      }
    }
  }

  if (!found) return notFound("There is no site at this address.");
  if (!publicationId) {
    /* The address is real and nothing is live on it — unpublished, or a domain
       connected before the project was ever published. Said differently from
       "no such address" because the owner can act on it. */
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
      /* See the note at the top of this file. Scripts and forms run because a
         real site needs them; same-origin is withheld, and on a path-served
         page that is what denies this app's own session cookie. */
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
      "X-Content-Type-Options": "nosniff",
      /* A published page changes only when somebody publishes, so it is worth
         caching at the edge — and it must revalidate rather than go stale,
         because "I published and it still shows the old one" is the complaint
         a long max-age would cause. */
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      /* Which version is being served, for anybody debugging exactly that. */
      "X-Quickstark-Version": String(publication.version ?? ""),
    },
  });
}
