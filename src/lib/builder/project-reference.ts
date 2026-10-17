/* "Like my Aurelia Estates site" — a project of their own, named as a reference.
 *
 * Somebody who writes "same style as my bakery page" is pointing at something
 * that exists: a build in their own history. Without it the model has only the
 * words, and fills the gap with a guess — a bakery page, certainly, but not
 * THAT one. So the message is read for the names of the person's other
 * projects, and each one named is fetched from its latest build and put in
 * front of the model as what it is: the real page, to be read, not imagined.
 *
 * ── What counts as naming one ─────────────────────────────────────────────
 *
 * Its name, as a phrase, beside a word that points at it ("like my Aurelia
 * Estates", "the Aurelia Estates site"), or its address
 * (aurelia-estates.quickstark.tech, or the slug alone). Names that say nothing —
 * "New project", "Untitled", anything under four letters — are never matched:
 * "start a new project" is not a reference to the one called New project.
 *
 * ── Guardrails ────────────────────────────────────────────────────────────
 *
 *   OWN ONLY     Read under the person's own session: RLS returns only their
 *                projects and their builds, so a name cannot reach anyone
 *                else's page.
 *   NOT ITSELF   The project being built is never its own reference; its page
 *                is already in front of the model.
 *   CAPPED       At most MAX_REFERENCES projects, each cut to MAX_REFERENCE_CHARS
 *                after inline data and scripts are taken out.
 *   TOLD HOW     The block says to take from it only what the person asked to
 *                carry over, and to invent nothing it does not show.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_REFERENCES = 2;
export const MAX_REFERENCE_CHARS = 24_000;

export type ProjectName = { id: string; name: string | null; slug?: string | null };
export type ProjectReference = { id: string; name: string; html: string };

const GENERIC = /^(new project|untitled( project)?|my project|project|new app|my app|my site|website|test)( \d+)?$/i;

/* Said AS a reference, not just said: a name only counts beside a word that
   points at something that exists — "like my Aurelia Estates", "the
   Aurelia Estates site". Without it, a project called "Landing page for a
   bakery" would be pulled in by anyone asking for a landing page for a bakery. */
const BEFORE = /\b(my|our|like|as|from|same|similar|match|matching|copy|reference|based on|built|made|did|use|using|in)\s+(?:\w+\s+){0,3}$/;
const AFTER = /^\s*(site|website|page|app|project|style|design|layout|look|theme|one|build)\b/;

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The other projects a message names, best match first. Pure. */
export function referencedProjects(prompt: string, projects: ProjectName[], currentId: string | null): ProjectName[] {
  const said = ` ${normalise(prompt)} `;
  const raw = prompt.toLowerCase();
  const found: { project: ProjectName; length: number }[] = [];
  for (const project of projects) {
    if (!project.name || project.id === currentId) continue;
    const name = normalise(project.name);
    const at = said.indexOf(` ${name} `);
    const named =
      name.replace(/ /g, "").length >= 4 &&
      !GENERIC.test(name) &&
      at >= 0 &&
      (BEFORE.test(said.slice(Math.max(0, at - 40), at + 1)) || AFTER.test(said.slice(at + name.length + 1, at + name.length + 30)));
    const slug = project.slug?.toLowerCase();
    const addressed = Boolean(slug && slug.length >= 4 && new RegExp(`(^|[^a-z0-9-])${slug.replace(/[^a-z0-9-]/g, "")}([^a-z0-9-]|$)`).test(raw));
    if (named || addressed) found.push({ project, length: name.length });
  }
  /* The longest name first: "Aurelia Estates Rentals" over "Aurelia Estates"
     when the message names the longer one. */
  return found.sort((a, b) => b.length - a.length).slice(0, MAX_REFERENCES).map((entry) => entry.project);
}

/** A page cut to what is worth reading: no inline data, no scripts, no runs of space. Pure. */
export function leanReferenceHtml(html: string, max = MAX_REFERENCE_CHARS): string {
  const lean = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script>…</script>")
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "data:…")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg>…</svg>")
    .replace(/\s+/g, " ")
    .trim();
  return lean.length > max ? `${lean.slice(0, max)} …[the rest of the page is cut for length]` : lean;
}

/** What the model is shown for each reference. Pure. */
export function referenceText(references: ProjectReference[]): string {
  return references
    .map(
      (reference) =>
        [
          `The person refers to "${reference.name}", another project of theirs. This is its current page, read from their build history — it is real, not a description:`,
          "",
          "<reference_project>",
          leanReferenceHtml(reference.html),
          "</reference_project>",
          "",
          `Take from "${reference.name}" exactly what the request asks to carry over — its look, its layout, its sections, its wording, its colours — by reading it above, never by guessing what it probably contained. Anything the request does not ask to carry over stays as the request says. Do not invent facts (names, prices, addresses, phone numbers, testimonials) that neither the request nor the reference gives.`,
        ].join("\n"),
    )
    .join("\n\n");
}

/** The projects a message names, each with its latest page, read under the person's own session. */
export async function loadReferencedProjects(
  supabase: SupabaseClient,
  prompt: string,
  currentId: string | null,
): Promise<ProjectReference[]> {
  if (prompt.trim().length < 4) return [];
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, slug")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  const named = referencedProjects(prompt, (projects ?? []) as ProjectName[], currentId);
  const references: ProjectReference[] = [];
  for (const project of named) {
    const { data: build } = await supabase
      .from("project_builds")
      .select("html")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ html: string | null }>();
    if (build?.html?.trim()) references.push({ id: project.id, name: project.name ?? "", html: build.html });
  }
  return references;
}
