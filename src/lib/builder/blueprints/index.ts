import { BAR, CRAFT, type Blueprint } from "@/lib/builder/blueprints/base";
import { blog } from "@/lib/builder/blueprints/blog";
import { ecommerce } from "@/lib/builder/blueprints/ecommerce";
import { landing } from "@/lib/builder/blueprints/landing";
import { webapp } from "@/lib/builder/blueprints/webapp";
import { KIND_LABEL, type BuildKind } from "@/lib/builder/kinds";

/* Four blueprints, one prompt each, composed here.
 *
 * The prompt the generator runs on used to live on a node inside n8n, and there
 * was one of it. That is what made every build the same build: a single
 * description of "a page" that had to cover a storefront and a landing page and
 * an application at once, and covered none of them. It also meant the prompt
 * could only be changed in a browser, by hand, with no diff and no review.
 *
 * Now the app composes it, per kind, from files that can be read and argued
 * with, and sends it with the build request. n8n uses what it is given. See
 * n8n/page-prompt.md for the other half of that contract.
 *
 * Composition is shared and the middle is not: every kind gets the same craft
 * rules and the same quality bar, and then its own purpose, sections,
 * behaviour, exclusions and depth. The exclusions are the part worth being
 * strict about — they are what stops a landing page growing a cart. */

export { type Blueprint } from "@/lib/builder/blueprints/base";

export const BLUEPRINTS: Record<BuildKind, Blueprint> = {
  landing,
  ecommerce,
  blog,
  webapp,
};

export function blueprintFor(kind: BuildKind): Blueprint {
  return BLUEPRINTS[kind];
}

function list(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * The system prompt for one kind of build.
 *
 * Order matters. What is being built comes first, because it frames everything
 * after it; the craft rules and the bar come last, because they are the ones
 * that must survive a long prompt — a model that has read four hundred words of
 * blueprint still has to finish the document, and the instruction to finish it
 * is the last thing it reads.
 */
export function composeBuildPrompt(kind: BuildKind): string {
  const blueprint = BLUEPRINTS[kind];

  return `You are building a ${KIND_LABEL[kind].toLowerCase()} as a single self-contained HTML file, to a professional standard, for a real business that will use it.

WHAT THIS IS: ${blueprint.purpose}

BUILD THESE, IN THIS ORDER:
${list(blueprint.sections)}

${blueprint.optional?.length ? `WORTH HAVING, AND THE FIRST THINGS TO CUT IF THE DOCUMENT IS RUNNING LONG:\n${list(blueprint.optional)}\n\n` : ""}THIS HAS TO WORK, NOT BE DEPICTED:
${list(blueprint.behaviour)}

NOT PART OF THIS BUILD — these belong to other kinds of page, and putting them here is a defect:
${list(blueprint.excludes)}

HOW MUCH:
${list(blueprint.depth)}

${BAR}

${CRAFT}`;
}

/** Every prompt, for the record and for the checks. */
export function allBuildPrompts(): Record<BuildKind, string> {
  return {
    landing: composeBuildPrompt("landing"),
    ecommerce: composeBuildPrompt("ecommerce"),
    blog: composeBuildPrompt("blog"),
    webapp: composeBuildPrompt("webapp"),
  };
}
