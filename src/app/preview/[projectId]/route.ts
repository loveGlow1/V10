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
 * shows them nothing. Making a page public is what publishing will be for. */

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

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
