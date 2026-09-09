import { BAR, BASE, type Blueprint } from "@/lib/builder/blueprints/base";
import { localeFor } from "@/lib/builder/blueprints/locale";
import { blog } from "@/lib/builder/blueprints/blog";
import { ecommerce } from "@/lib/builder/blueprints/ecommerce";
import { landing } from "@/lib/builder/blueprints/landing";
import { news } from "@/lib/builder/blueprints/news";
import { webapp } from "@/lib/builder/blueprints/webapp";
/* The same ceiling an edit's conversation is trimmed to, in the same unit. One
   number, because a new page and an edit make the same promise about what is
   remembered — and words, because that is what the person pasting has. */
import { MAX_CONTEXT_WORDS, trimToWords } from "@/lib/builder/brief";
import { manifestForPrompt } from "@/lib/builder/assets/asset-resolver";
import type { AssetManifest } from "@/lib/builder/assets/asset-types";
import {
  type ArchitectureManifest,
  architectureBrief,
} from "@/lib/builder/architecture";
import { type DesignDNA, designBrief } from "@/lib/builder/design";
import { referenceBrief } from "@/lib/builder/reference";
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
  news,
  webapp,
};

export function blueprintFor(kind: BuildKind): Blueprint {
  return BLUEPRINTS[kind];
}

/** What the app knows about this build besides the words that asked for it. */
export type ProjectContext = {
  /** What the project is called. Not a brand — a name someone can rename. */
  projectName?: string | null;
  /* What a project has to come back AS, when it is a project rather than a
     page: the files to write, the routes, and the plumbing not to bother with.
     Absent means the single self-contained page this builder has always made.
     See scaffold.ts (treeBrief) and stack.ts, which decides which it is. */
  treeInstructions?: string;
  /** Text pulled out of anything attached to the message. */
  attachmentText?: string | null;
  /** How many images came with it, which the caller passes separately. */
  imageCount?: number;
  /** The earlier description a one-word message leant on, when it leant on one. */
  carriedFrom?: string | null;
  /* Which stage of a multi-stage build this is, when the project is being built
     in stages — see src/lib/context/stages.ts, stagePlanBrief.
     
     Placed with the brief rather than with the rules, because it modifies what
     is being ASKED FOR rather than how to do it: the blueprint still describes
     the whole product, and this says which part of it is this build's job. A
     model given the blueprint and no stage plan builds all of it, which is
     exactly right when there is no plan and exactly wrong when there is. */
  stagePlan?: string;
  /* Which market's conventions the content defaults to — see
     src/lib/builder/market.ts. Only a default: the locale section it selects
     opens by handing precedence back to the brief. */
  market?: Market;
  /* The pictures, already decided, already acquired, already stored.
     
     This is the architectural rule of the whole builder in one field: the model
     that writes the code does not decide what imagery a project needs, does not
     make it, does not store it and does not optimise it. It is handed the
     answer. Where this is absent the page falls back to declaring slots for
     something else to fill later, which is the weaker arrangement and exists
     only so a build without an asset pipeline still runs. */
  manifest?: AssetManifest;
  /* Which layers this project is made of — see src/lib/builder/architecture.ts.
     
     Distinct from `manifest` above, which is the pictures, and unfortunately
     both are called a manifest by the people who use them. This one decides
     whether there is a database, an admin and a sign-in at all; that one
     decides what the photographs are.
     
     Absent means the question was never asked, which is every build before this
     existed and every build of the single-page stack. A prompt with no
     architecture section behaves exactly as it did. */
  architecture?: ArchitectureManifest;
  /* The design system this project is built to — see src/lib/builder/design.ts.
     
     Derived from the same visual register the photographs were, so the
     interface and the imagery cannot disagree. Absent means the question was
     never asked, and the prompt behaves exactly as it did before: the bar still
     says "one palette, one type scale", which is the weaker instruction this
     replaces rather than contradicts. */
  design?: DesignDNA;
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
      `- This continues an earlier description in the same conversation: "${trimToWords(
        context.carriedFrom.trim(),
        MAX_CONTEXT_WORDS,
      )}". The brief above is what to build; this is what it refers back to.`,
    );
  }
  /* Nothing about the attached pictures here any more.
   *
   * The line that used to sit at this point said to treat them "as direction
   * for the design or as content to reproduce, whichever the brief implies",
   * which is one sentence about the single most specific instruction anybody
   * ever gives a builder. What came back was the palette and none of the
   * composition, and then five messages of "move it down, no, smaller, the top
   * is cut off" — each of them a credit.
   *
   * A reference is a specification, and reading one is a list of measurable
   * things rather than an attitude. That list is long enough to be its own
   * section rather than a bullet in this one: see referenceBrief in
   * src/lib/builder/reference.ts, which composeBuildPrompt places directly
   * above the base rules. */
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

/* What this build must not become.
 *
 * Two lists joined, and the second one is dropped when the project has an admin
 * — because "no admin dashboard, no back office" is the correct instruction for
 * a storefront and a direct contradiction of the admin requirements below it
 * for a store with a merchant behind it. A model handed both picks one, and
 * which one it picks is not something anybody controls. */
function exclusions(blueprint: Blueprint, architecture?: ArchitectureManifest): string[] {
  const conditional = architecture?.admin ? [] : (blueprint.frontendOnlyExclusions ?? []);
  return [...blueprint.exclusions, ...conditional];
}

/* The back office, when this project has one.
 *
 * Placed after the public requirements and under a heading of its own rather
 * than merged into them, because they are two products for two people: a model
 * given one interleaved list builds a shop with an "Add product" button on the
 * home page. */
function admin(blueprint: Blueprint, architecture?: ArchitectureManifest): string {
  if (!architecture?.admin || !blueprint.admin) return "";

  return `\nAND THE ADMIN SIDE — a second, separate interface at /admin, for the person who runs this rather than the person who visits it.

WHAT IT IS: ${blueprint.admin.identity}

${list(blueprint.admin.requirements)}

The admin is not a demonstration. Every figure on it is read from the database and every action on it writes to the database — the same tables the public side reads. If a change made in the admin is not visible on the public site after a reload, the admin is scenery and the build has failed.
`;
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

  /* The one sentence that differs between the two stacks. Everything after it
     — what this kind of thing IS, what it must contain, the brief, the
     imagery — is the same question whichever shape the answer takes. */
  const shape = context.treeInstructions
    ? "as a Next.js project"
    : "as a single self-contained HTML file";

  return `You are building ${
    kind === "webapp" ? "a web application" : `a ${KIND_LABEL[kind].toLowerCase()}`
  } ${shape}, to a professional standard, for a real business that will use it.

WHAT THIS IS: ${blueprint.identity}

BUILD THESE, IN THIS ORDER:
${list(blueprint.requirements)}
${admin(blueprint, context.architecture)}${conditionals(blueprint)}${
    blueprint.optionalFeatures.length > 0
      ? `\nWORTH HAVING, AND THE FIRST THINGS TO CUT IF THE DOCUMENT RUNS LONG:\n${list(
          blueprint.optionalFeatures,
        )}\n`
      : ""
  }
THIS HAS TO WORK, NOT BE DEPICTED:
${list(blueprint.interactions)}

NOT PART OF THIS BUILD — these belong to other kinds of product, and putting them here is a defect:
${list(exclusions(blueprint, context.architecture))}
${depth(blueprint)}
THE STANDARD FOR THIS KIND:
${list(blueprint.qualityRules)}

DONE MEANS:
${list(blueprint.completionRules)}

────────────────────────────────────────
${context.architecture ? `${architectureBrief(context.architecture)}\n\n────────────────────────────────────────\n` : ""}${context.design ? `\n${designBrief(context.design)}\n\n────────────────────────────────────────\n` : ""}
THE BRIEF — what to build, in their words. Where it is more specific than anything above, it wins; where it is silent, the blueprint decides:

${brief.trim()}
${context.stagePlan ? `\n────────────────────────────────────────\n\n${context.stagePlan}\n` : ""}${projectContext(context)}${context.manifest ? `\n${manifestForPrompt(context.manifest)}\n` : ""}
${localeFor(context.market ?? DEFAULT_MARKET)}
────────────────────────────────────────
${
    context.imageCount && context.imageCount > 0
      ? /* Below the brief and above the rules, which is where a specification
           belongs: it is more specific than anything in the blueprint and less
           specific than the sentence somebody typed. */
        `\n${referenceBrief(context.imageCount)}\n\n────────────────────────────────────────\n`
      : ""
  }
${BAR}

${BASE}${context.treeInstructions ? `\n\n${BAR}\n\n${context.treeInstructions}` : ""}`;
}
