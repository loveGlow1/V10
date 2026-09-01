import { downloadNameFor, toStandalone } from "@/lib/standalone-page";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Handing someone the page as a file.
 *
 * Not the same thing as /preview, which serves the document at a URL where a
 * CDN is a reasonable place for a stylesheet to live. A file is opened
 * somewhere else entirely — Quick Look on a phone, an email attachment, a
 * file:// tab with no connection — and in those places a remote <script> is a
 * request nobody makes. The page renders unstyled: default serif, blue
 * underlined links, an inline SVG at its natural size because `h-5 w-5` never
 * resolved. Nothing errors. It just looks broken, and the person cannot tell
 * whether the builder produced a bad page or their viewer failed to load one.
 *
 * So the export is compiled rather than copied: src/lib/standalone-page.ts runs
 * Tailwind over this page's own markup and puts the result in the file. What
 * downloads is one HTML document with no external reference of any kind, which
 * is the only definition of "works when you open it" that survives contact with
 * a phone in aeroplane mode.
 *
 * Content-Disposition is the other half. Without it a browser is entitled to
 * render the response instead of saving it, and on iOS that is the difference
 * between a file in Files and a tab that goes away.
 *
 * Who can download: the owner. The read runs under the caller's session, so RLS
 * answers it — the same rule the preview follows, for the same reason. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* Compiling is fast — a page of this size is well under a second — but it is
   real work rather than a read, so it is not left on the default. */
export const maxDuration = 30;

function refuse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return refuse("Downloads are unavailable — Supabase is not configured.", 503);

  /* Both reads run under the caller's own session, so a project id belonging to
     someone else comes back empty rather than checked-and-refused here. */
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();

  const { data: build } = await supabase
    .from("project_builds")
    .select("html")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const html = (build?.html as string | undefined) ?? null;
  if (!project || !html) {
    /* One answer for "no such project", "not yours" and "never built" — the
       caller has no business telling those apart. */
    return refuse("There is nothing to download here yet.", 404);
  }

  let file = html;
  try {
    file = (await toStandalone(html)).html;
  } catch (error) {
    /* The page is still worth having. Compiling is what makes it look right
       offline, not what makes it a page — so a compiler failure downgrades the
       export rather than denying it, and says so where someone will find it. */
    // eslint-disable-next-line no-console
    console.error("download: the page could not be made standalone:", error);
  }

  const name = downloadNameFor((project as { name: string }).name);

  return new Response(file, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      /* attachment, not inline: this is a file to keep, and a browser given the
         choice will often render it and leave nothing behind. The quoted
         filename is what the phone shows in Files. */
      "Content-Disposition": `attachment; filename="${name}"`,
      /* The bytes are generated per request from the newest build; a cached copy
         is last week's page under this week's name. */
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
