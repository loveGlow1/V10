import { redirect } from "next/navigation";

import { slugIsUsable } from "@/lib/publish/naming";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* The short address for a project's preview: /quickstark-app/preview.
 *
 * The same page /preview/<uuid> serves, reachable by the name the project
 * answers on rather than by 36 characters of hex. Both work; this one can be
 * read down a phone, and it is the published address with one word appended,
 * so nothing about a project's URL moves when it goes live.
 *
 * ── Why this redirects instead of serving ─────────────────────────────────
 *
 * Serving the page here too would mean two routes that hand somebody's private
 * document to a caller, and the ONE thing that must never go wrong in this
 * codebase is a preview reaching a person who does not own it. Two
 * implementations of that check is two places to get it wrong, and the second
 * one always drifts.
 *
 * So this resolves the name and hands off. /preview/<id> keeps sole
 * responsibility for reading a build under the caller's own session, with RLS
 * answering — see the long note there. What this adds is an address, not an
 * access path.
 *
 * The lookup is deliberately NOT owner-scoped: it turns a public name into a
 * project id and nothing more. A stranger who guesses a slug is redirected to
 * /preview/<id>, where RLS shows them nothing. Learning that a project exists
 * is already implied by the published address being public. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const wanted = decodeURIComponent(slug ?? "").trim().toLowerCase();

  /* Nothing that could not have been issued reaches a query. */
  if (!slugIsUsable(wanted)) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("slug", wanted)
    .maybeSingle();

  if (!data) redirect("/dashboard");

  /* Query kept, so ?download=1 works at this address as well as the other. */
  const query = new URL(request.url).search;
  redirect(`/preview/${data.id}${query}`);
}
