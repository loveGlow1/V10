import { BAR, BASE, type Blueprint } from "@/lib/builder/blueprints/base";
import { localeFor } from "@/lib/builder/blueprints/locale";
import { blog } from "@/lib/builder/blueprints/blog";
import { ecommerce } from "@/lib/builder/blueprints/ecommerce";
import { landing } from "@/lib/builder/blueprints/landing";
import { webapp } from "@/lib/builder/blueprints/webapp";
import { KIND_LABEL, type BuildKind } from "@/lib/builder/kinds";
import { DEFAULT_MARKET, type Market } from "@/lib/builder/market";

/* Four blueprints, and the one place a build prompt is assembled.
 *
 * The prompt used to live on a node inside n8n, and there was one of it. That
 * is what made every build the same build: a single description of "a page"
 * that had to cover a storefront, a landing page, a publication and an
 * application, and covered none of them. It also meant the prompt could only be
 * changed in a browser, by hand, with no diff and no review.
 *
 * The assembly is deliberately additive rather than conditional:
 *
 *     BASE RULES  +  BLUEPRINT  +  USER BRIEF  +  PROJECT CONTEXT
 *
 * Nothing here branches on the contents of a brief. What varies between kinds
 * varies because the blueprint file is different, and what varies within a kind
 * is handled by that blueprint's conditional requirements — which the model
 * applies, because it can read the brief and a regex cannot. The alternative,
 * one universal prompt with a thicket of "if the user mentions…" clauses, is
 * the thing this replaced.
 *
 * Order is not arbitrary. The kind comes first because it frames everything
 * after it. The brief comes after the blueprint so that a specific instruction
 * is read last and beats a general rule. The base rules and the bar close it,
 * because they are the ones that must survive a long prompt: a model that has
 * just read four hundred words of blueprint still has to finish the document,
 * and the instruction to finish it is the last thing it reads. */

export { type Blueprint, type ConditionalRequirement } from "@/lib/builder/blueprints/base";

export const BLUEPRINTS: Record<BuildKind, Blueprint> = {
  landing,
  ecommerce,
  blog,
  webapp,
};

export function blueprintFor(kind: BuildKind): Blueprint {
  return BLUEPRINTS[kind];
}

/** What the app knows about this build besides the words that asked for it. */
export type ProjectContext = {
  /** What the project is called. Not a brand — a name someone can rename. */
  projectName?: string | null;
  /** Text pulled out of anything attached to the message. */
  attachmentText?: string | null;
  /** How many images came with it, which the caller passes separately. */
  imageCount?: number;
  /** The earlier description a one-word message leant on, when it leant on one. */
  carriedFrom?: string | null;
  /* Which market's conventions the content defaults to — see
     src/lib/builder/market.ts. Only a default: the locale section it selects
     opens by handing precedence back to the brief. */
  market?: Market;
};

function list(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/* Trimmed rather than sent whole. The brief is capped upstream, but attached
   text is a file somebody uploaded, and a prompt that a 200KB paste can push
   past the model's window is a build that fails on a large attachment. */
const MAX_ATTACHMENT_TEXT = 6000;

function projectContext(context: ProjectContext): string {
  const lines: string[] = [];

  if (context.projectName?.trim()) {
    lines.push(
      `- The project is called "${context.projectName.trim()}". Use it as the product's name only if the brief does not give a better one, and never print it as a heading on its own.`,
    );
  }
  if (context.carriedFrom?.trim()) {
    lines.push(
      `- This continues an earlier description in the same conversation: "${context.carriedFrom.trim().slice(0, 400)}". The brief above is what to build; this is what it refers back to.`,
    );
  }
  if (context.imageCount && context.imageCount > 0) {
    lines.push(
      `- ${context.imageCount} image${context.imageCount === 1 ? " was" : "s were"} attached and ${
        context.imageCount === 1 ? "is" : "are"
      } supplied alongside this prompt. Treat ${
        context.imageCount === 1 ? "it" : "them"
      } as direction for the design or as content to reproduce, whichever the brief implies.`,
    );
  }
  if (context.attachmentText?.trim()) {
    lines.push(
      `- Text was attached to the message. Use its content rather than inventing your own where the two would cover the same ground:\n\n${context.attachmentText
        .trim()
        .slice(0, MAX_ATTACHMENT_TEXT)}`,
    );
  }

  if (lines.length === 0) return "";
  return `\nPROJECT CONTEXT:\n${lines.join("\n")}\n`;
}

function conditionals(blueprint: Blueprint): string {
  if (blueprint.conditionalRequirements.length === 0) return "";

  return `\nREQUIRED ONLY WHEN THE BRIEF CALLS FOR IT — read the brief against each of these, build the ones that apply in full, and do not invent the ones that do not:
${blueprint.conditionalRequirements
  .map((rule) => `- IF ${rule.when} — THEN ${rule.require}.`)
  .join("\n")}
`;
}

function depth(blueprint: Blueprint): string {
  const { minimumSections, counts, floors } = blueprint.depth;
  const unit = counts ?? "meaningful sections";

  return `\nHOW MUCH — floors, not targets:
- At least ${minimumSections} ${unit}, every one of them full.
${list(floors)}
`;
}

/**
 * The system prompt for one build: the rules, the blueprint, the brief and what
 * the app knows about the project, in that order.
 *
 * `brief` is what the person asked for, in their words. It is included here as
 * well as being sent as the request's own prompt: this is the text every rule
 * above it is about, and a blueprint read without it is a set of instructions
 * with no subject.
 */
export function composeBuildPrompt(
  kind: BuildKind,
  brief: string,
  context: ProjectContext = {},
): string {
  const blueprint = BLUEPRINTS[kind];

  return `You are building ${
    kind === "webapp" ? "a web application" : `a ${KIND_LABEL[kind].toLowerCase()}`
  } as a single self-contained HTML file, to a professional standard, for a real business that will use it.

WHAT THIS IS: ${blueprint.identity}

BUILD THESE, IN THIS ORDER:
${list(blueprint.requirements)}
${conditionals(blueprint)}${
    blueprint.optionalFeatures.length > 0
      ? `\nWORTH HAVING, AND THE FIRST THINGS TO CUT IF THE DOCUMENT RUNS LONG:\n${list(
          blueprint.optionalFeatures,
        )}\n`
      : ""
  }
THIS HAS TO WORK, NOT BE DEPICTED:
${list(blueprint.interactions)}

NOT PART OF THIS BUILD — these belong to other kinds of product, and putting them here is a defect:
${list(blueprint.exclusions)}
${depth(blueprint)}
THE STANDARD FOR THIS KIND:
${list(blueprint.qualityRules)}

DONE MEANS:
${list(blueprint.completionRules)}

────────────────────────────────────────
THE BRIEF — what to build, in their words. Where it is more specific than anything above, it wins; where it is silent, the blueprint decides:

${brief.trim()}
${projectContext(context)}
${localeFor(context.market ?? DEFAULT_MARKET)}
────────────────────────────────────────

${BAR}

${BASE}`;
}
