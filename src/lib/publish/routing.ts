import { PUBLISH_SUBDOMAIN, SITE_URL } from "@/lib/site";

/* Which project a request is for, decided from the hostname alone.
 *
 * Three kinds of address reach this app and they must not be confused, because
 * two of them are the product and one of them is somebody's live website:
 *
 *   the app itself      quickstark.tech, www.quickstark.tech, and the
 *                       *.vercel.app address a deployment gets. Signed-in
 *                       surface: the dashboard, the API, the preview.
 *
 *   a published project shop.quickstark.tech. Public, no session, serves one
 *                       published document and nothing else.
 *
 *   a custom domain     www.customer.com. The same as above, resolved by
 *                       looking the hostname up rather than by reading a label
 *                       out of it.
 *
 * Getting this wrong in the safe direction costs a page; getting it wrong in
 * the other direction serves the dashboard on a customer's domain, or worse
 * serves somebody's site from an address that carries our session cookie. So
 * the app's own hostnames are matched explicitly and everything else is
 * treated as a site to look up.
 *
 * Pure and hostname-only, so it can be tested exhaustively and so the
 * middleware can run it on the edge without a database round trip for the
 * common case. */

/** How a hostname should be served. */
export type Route =
  | { kind: "app" }
  /* A published project addressed by its subdomain label — no lookup needed
     beyond the slug itself. */
  | { kind: "slug"; slug: string }
  /* A hostname that is not ours. It is only a site if a row says so. */
  | { kind: "domain"; domain: string };

function hostOf(value: string): string {
  return value.toLowerCase().split(":")[0].replace(/\.+$/, "").trim();
}

/** The app's own addresses, which must never be treated as a customer site. */
function appHosts(): Set<string> {
  const site = hostOf(SITE_URL.replace(/^https?:\/\//, ""));
  const bare = site.replace(/^www\./, "");
  return new Set([site, bare, `www.${bare}`, "localhost", "127.0.0.1"]);
}

export function routeFor(hostHeader: string | null | undefined): Route {
  const host = hostOf(hostHeader ?? "");
  if (!host) return { kind: "app" };

  if (appHosts().has(host)) return { kind: "app" };

  /* Every deployment gets one of these and they are ours. Serving a customer
     site from a preview deployment's address would put it somewhere nobody
     linked to and take the dashboard away from a URL people do use. */
  if (host.endsWith(".vercel.app")) return { kind: "app" };

  const suffix = PUBLISH_SUBDOMAIN.startsWith(".") ? PUBLISH_SUBDOMAIN : `.${PUBLISH_SUBDOMAIN}`;

  if (host.endsWith(suffix)) {
    const label = host.slice(0, -suffix.length);
    /* One label only. "a.b.quickstark.tech" is not a project — nothing issues
       an address like that, so it is far likelier to be a probe than a site. */
    if (!label || label.includes(".")) return { kind: "app" };
    return { kind: "slug", slug: label };
  }

  return { kind: "domain", domain: host };
}

/* Paths that belong to the app even when they arrive on a project's hostname.
 *
 * A published page is one document; it has no API and no dashboard. Letting
 * /api through on a customer's domain would put this app's endpoints on an
 * origin we do not control the cookies for, which is the kind of mistake that
 * is only ever found from the outside. */
export function isAppPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}
