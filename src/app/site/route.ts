import { SITE_DOMAIN_HEADER, SITE_SLUG_HEADER } from "@/lib/publish/headers";
import { servePublished } from "@/lib/publish/serve";

/* Where a CUSTOM DOMAIN lands.
 *
 * The middleware rewrites here when a request arrives on a hostname that is
 * not this app's own, carrying which one in a header it sets itself. Nothing
 * here trusts the request's own Host: a header a caller can write is not an
 * identity, and the separation between this and the dashboard would otherwise
 * rest on one.
 *
 * Projects published to their quickstark address are served by /s/<slug>
 * instead — no middleware and no DNS. Both call the same servePublished, so
 * the two names a site can have cannot answer differently. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const domain = request.headers.get(SITE_DOMAIN_HEADER);
  const slug = request.headers.get(SITE_SLUG_HEADER);

  /* Reached directly rather than through the middleware when neither is set,
     which is nothing to serve. */
  return servePublished(domain ? { domain } : slug ? { slug } : null);
}
