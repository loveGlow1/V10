import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Serves the page a build produced.
 *
 * This is what `projects.preview_url` points at, what the workspace's iframe
 * loads, and where "Open preview" goes. It returns the newest build's document
 * verbatim — it is the built page, not a page about the built page.
 *
 * ── Why this is a route handler and not a React page ──────────────────────
 *
 * The stored HTML is model output shaped by a user's prompt: untrusted, and it
 * has to run its own scripts to be a working page at all. Serving it from this
 * origin without care would mean any generated <script> could reach
 * /api/build, /api/credits and the Supabase session cookie as the signed-in
 * user, on their own domain. That is the whole risk, and it is not theoretical:
 * "put a script in the page that fetches my data" is a prompt anyone can write.
 *
 * `Content-Security-Policy: sandbox allow-scripts allow-forms` is the answer.
 * It applies the iframe sandbox rules to a top-level document, which puts the
 * response in an opaque origin: scripts still run, so the page works, but it has
 * no access to cookies, storage, or same-origin requests against quickstark.tech.
 * A React page could not do this — the header has to be on the response that
 * carries the HTML, and rendering it through dangerouslySetInnerHTML would put
 * it inside this origin's document rather than beside it.
 *
 * The workspace's iframe also sandboxes it, which covers the framed case. This
 * covers the case the iframe cannot: opening the preview in a tab of its own.
 *
 * ── Who can see it ────────────────────────────────────────────────────────
 *
 * The owner, and nobody else. The read runs under the caller's session, so RLS
 * on project_builds answers the question and a link forwarded to someone else
 * shows them nothing. Making a page public is what publishing will be for.
 *
 * ── ?download=1 ───────────────────────────────────────────────────────────
 *
 * The same document, handed over as a file instead of rendered. It is the same
 * read and the same RLS, which is the reason it lives here rather than in a
 * route of its own: two places that serve someone's private page are two places
 * to get the ownership check wrong.
 *
 * A download is served with `Content-Security-Policy: sandbox` and no
 * allowances at all — stricter than the rendered case, which needs scripts to
 * be a working page. Nothing should execute on the way to disk, and if a
 * browser ever ignored the disposition and rendered it anyway, it renders
 * inert. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(message: string) {
  /* Deliberately the same answer for "no such project", "not yours" and "never
     built": all three are things the caller has no business distinguishing. */
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No preview</title></head><body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#020617;color:#94a3b8;font:15px/1.6 system-ui,sans-serif"><p style="max-width:34ch;text-align:center;padding:24px">${message}</p></body></html>`,
    {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "no-store",
      },
    },
  );
}

/* The project's name as a file name: lowercase, words joined by hyphens, and
   nothing that could carry meaning into a header. Built from the stored name
   rather than taken from a query parameter — a caller-supplied filename is a
   header injection waiting to happen, and this one is only ever read out of a
   row the caller already owns. */
function fileNameFor(name: string | null | undefined): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "page"}.html`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const asDownload = new URL(request.url).searchParams.get("download") === "1";

  const supabase = await createSupabaseServerClient();
  if (!supabase) return notFound("Previews are unavailable — Supabase is not configured.");

  /* Under the caller's own session on purpose. RLS is what makes this private,
     rather than a check written here that could be forgotten. */
  const { data: build } = await supabase
    .from("project_builds")
    .select("html")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!build?.html) {
    return notFound("There is nothing to preview here yet. Send a message to build this app.");
  }

  if (asDownload) {
    /* Read for the file name only, and after the build: a project with no build
       never reaches here, so this is not a round trip anyone pays for on the
       path that matters. RLS answers it too, so a name cannot leak from a
       project the caller does not own. */
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .maybeSingle();

    return new Response(build.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileNameFor(project?.name)}"`,
        /* No allowances. See the note above — a file on its way to disk has
           nothing to run. */
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(build.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      /* The line that makes serving this safe — see the note above. Scripts and
         forms are allowed because a page needs them; same-origin is not, which
         is what denies the session cookie and this origin's API routes.
         allow-popups so an <a target="_blank"> in a landing page still works. */
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
      /* Belt and braces for the framed case, and it costs nothing. */
      "X-Content-Type-Options": "nosniff",
      /* A build replaces the page at the same address, so a cached copy is a
         preview that silently shows the previous build. */
      "Cache-Control": "no-store",
    },
  });
}
