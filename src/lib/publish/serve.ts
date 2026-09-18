import { latestDeployment, existingVercelProject } from "@/lib/publish/deployment-store";
import { publicAddress } from "@/lib/publish/vercel-deploy";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Handing a published page to whoever asked for it.
 *
 * Two entry points reach this and they must never answer differently:
 *
 *   /<slug>            the address every published project gets
 *   a custom domain    rewritten here by the middleware
 *
 * They are the same site by two names, so the lookup, the checks and the
 * headers live here rather than in either of them.
 *
 * ── The sandbox is the whole security model, and it carries more weight now ──
 *
 * A published page used to sit on its own subdomain — shop.quickstark.tech —
 * which gave it its own origin for free. Served at /shop it shares an origin
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

/* Where this project's application is running, or null if it has none.
 *
 * Null is the ordinary answer and the important one: a single-page project has
 * no deployment row at all, so it never takes the branch above and goes on
 * being served from its snapshot exactly as it always has.
 *
 * The address is DERIVED rather than read off the row — see publicAddress. A
 * stored per-deployment host sits behind Deployment Protection and would send
 * a visitor to Vercel's login screen, which is worse than anything this is
 * trying to fix.
 *
 * Best effort. Anything that goes wrong here falls through to the snapshot,
 * which is what was being served before. */
async function liveApplication(
  service: ReturnType<typeof createSupabaseServiceClient>,
  projectId: string,
): Promise<string | null> {
  if (!service) return null;

  try {
    const deployment = await latestDeployment(service, projectId);
    if (!deployment || deployment.state !== "ready") return null;

    const vercelProject = await existingVercelProject(service, projectId);
    return publicAddress(deployment.url, vercelProject);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("serve: the running application could not be located:", error);
    return null;
  }
}

export async function servePublished(asked: Asked): Promise<Response> {
  if (!asked) return notFound("There is no site at this address.");

  /* The service key, because a published page has no reader to be. RLS cannot
     answer "may the public see this" — the publish pointer answers it, and the
     reads below are written so a project with nothing live produces no page. */
  const service = createSupabaseServiceClient();
  if (!service) return notFound("This site is temporarily unavailable.", 503);

  let publicationId: string | null = null;
  let projectId: string | null = null;
  let found = false;

  if ("slug" in asked) {
    const { data } = await service
      .from("projects")
      .select("id, published_version_id, deleted_at")
      .eq("slug", asked.slug)
      .maybeSingle();

    if (data && !data.deleted_at) {
      found = true;
      projectId = data.id as string;
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
        projectId = connected.project_id as string;
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

  /* ── An application is never served as its own receipt ──────────────────
   *
   * A deployed project has a `project_publications` row like any other, and the
   * html on it is the SUMMARY this platform writes for a tree build — "a web
   * app built as a Next.js project, 19 files", a route list and a file count.
   * It is a good receipt and it is not a website, and serving it here put that
   * receipt at the customer's public address under their own domain. That is
   * the "I published and got a deployment information page" report, exactly.
   *
   * A project that has deployed is an application, and its published address
   * must open the application. The discriminator is the deployment row rather
   * than the marker in the document: the marker only exists on builds made
   * after it was added, and a project's having source files is a fact about the
   * project that is true whenever it was built.
   *
   * ── Why this is a fallback and not the main path ──────────────────────────
   *
   * Normally nothing here runs for a deployed project at all. `<slug>.
   * quickstark.tech` is bound to that project's own Vercel project on publish,
   * so Vercel answers it from the application directly and this app never sees
   * the request. This is what happens when that bind did not land — an
   * unverified wildcard, a DNS record that has not propagated — and the request
   * falls through to our own wildcard instead.
   *
   * So it hands the visitor to where the application actually is. The address
   * bar showing the hosting provider is a real cost and it is the smaller one:
   * the alternative is a customer's public URL showing a file listing.
   *
   * Only a READY deployment. A build still compiling has an address with
   * nothing behind it, and sending somebody there trades a receipt for a 404. */
  if (projectId) {
    const running = await liveApplication(service, projectId);
    if (running) return Response.redirect(running, 302);
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
