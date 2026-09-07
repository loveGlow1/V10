import { slugIsUsable } from "@/lib/publish/naming";
import { servePublished } from "@/lib/publish/serve";

/* Where every published project lives: quickstark.tech/s/<slug>.
 *
 * A path rather than a subdomain, and that was forced by reality rather than
 * taste. shop.quickstark.tech needs a wildcard DNS record AND a wildcard
 * domain on the Vercel project; the first is a registrar change that fails
 * silently and the second has historically needed a paid plan. A path needs
 * neither — it works the moment this file is deployed, on any plan, with no
 * DNS at all.
 *
 * What it gives up is the origin isolation a subdomain came with for free. See
 * the note in lib/publish/serve.ts, where the sandbox header that replaces it
 * is set and explained; on a path-served page that header is the whole of what
 * keeps a generated document away from this app's session cookie.
 *
 * Custom domains are unaffected and still arrive through the middleware: those
 * are added one at a time through Vercel's API, which needs no wildcard. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  /* Checked before the database is asked. The rule that decides what a slug
     may be is the same rule that decides what may be looked up, so a path
     segment that could never have been issued is answered without a query —
     and anything odd in the URL never reaches a filter. */
  const wanted = decodeURIComponent(slug ?? "").trim().toLowerCase();
  return servePublished(slugIsUsable(wanted) ? { slug: wanted } : null);
}
