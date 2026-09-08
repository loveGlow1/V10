/* A picture somebody attached, read as a specification rather than as a mood.
 *
 * The instruction this replaces was one sentence: "treat them as direction for
 * the design or as content to reproduce, whichever the brief implies". It is
 * not wrong, and what came back from it was a page in roughly the right colours
 * with none of the composition — a different container width, a different grid,
 * a hero half the height, the subject centred where the reference had it low
 * and left. Then five messages of "move it down", "no, smaller", "the top is
 * cut off", each costing a credit, none of them the thing anybody wanted to
 * spend a morning on.
 *
 * The cause is not that the model cannot see. It is that nothing told it what
 * to LOOK at. A reference read as inspiration yields a palette; a reference
 * read as a specification yields measurements — and the difference between the
 * two is a list of the things worth measuring, which is what this file is.
 *
 * ── Why a checklist rather than "match the reference closely" ─────────────
 *
 * Because "closely" is a word about effort and every item below is a question
 * with an answer. A model asked to match a design closely tries hard and
 * reproduces whatever it noticed. A model asked how wide the container is, how
 * tall the header is, where the subject sits in its frame and what the type
 * scale jumps by has been asked fourteen questions it can actually answer, and
 * answers them.
 *
 * ── Direction or content ──────────────────────────────────────────────────
 *
 * The other half of the failure, and the cheaper one to fix. An attached
 * photograph of a product is CONTENT — it goes in the page. An attached
 * screenshot of a website is DIRECTION — it gets reproduced in HTML and CSS and
 * must never be dropped in as an image, which is what "here is what I want it
 * to look like" produced more than once: the whole design, flattened, as a
 * single unclickable picture. The rule for telling them apart is in the brief
 * below, stated as something to look at rather than as something to infer.
 */

/* What to read off a reference, in the order it decides the page.
 *
 * Ordered outside-in on purpose: the container and the grid decide where
 * everything else can go, and a model that fixes the hero's proportions before
 * it knows the container width has to undo them. The last three are the ones
 * that get skipped when a list is long, so they are the ones stated most
 * concretely. */
const OBSERVABLES = [
  "The overall composition: what occupies the screen on first sight, and in what proportion. Which part is picture, which part is type, which part is space.",
  "The container: how wide the content runs, and how much gutter is left either side of it. Measure it against the full width of the reference rather than guessing a round number.",
  "The grid: how many columns, how wide the gaps are, and which elements break out of it.",
  "The header: how tall it is, whether it sits over the content or above it, and whether anything shows through it.",
  "The hero: its height as a fraction of the screen, and where its baseline falls relative to the fold.",
  "Every element's position: what is aligned with what, what is centred, what is deliberately not.",
  "The spacing rhythm: the gap between sections against the gap between a heading and its paragraph. Their RATIO is the design; the absolute numbers follow from it.",
  "The image scale and crop: how much of the frame the subject occupies, and where its edges fall.",
  "Where the subject sits inside its own frame — high, low, left of centre — and how much room is left above and below it.",
  "The type scale: the jump from the largest thing on the page to body text, the weights, the line heights, the measure a paragraph is set to.",
  "The layering: what sits over what, what casts a shadow, what is translucent, what shows through.",
  "The background treatment: flat, gradient, photographic, overlaid — and if overlaid, how strongly and in what direction.",
  "The visual hierarchy: what the eye reaches first, second and third, and what makes that order happen.",
  "The colour relationships: not the hexes, which you cannot sample reliably, but which element is darkest, which carries the accent, and how much of the page each covers.",
];

/* The rule that answers "move the cake down" before anybody has to type it.
 *
 * Everything here is about the SUBJECT, which is the thing nobody frames for.
 * A page places a picture; a designer places what is IN the picture, and the
 * gap between those two is every framing complaint in the support queue. */
const SUBJECT_RULES = [
  "Find the subject before you place the picture. Where does the cake begin and end? Where does the cone start and where does its tip finish? A photograph is not a rectangle of texture — it has a thing in it, and the thing has edges.",
  "Position the FRAME and the SUBJECT separately. The box is sized by the layout; where the picture sits inside that box is a second decision, and `object-position` is where you make it.",
  "The whole subject stays visible unless the reference deliberately crops it. A cone whose tip is cut off by the bottom of the hero is a defect, not a crop.",
  "Nothing important goes behind the header. If the header is fixed or overlays the hero, the subject sits far enough down that the header passes over empty picture, never over the face, the product or the headline.",
  "Never reach for `object-fit: cover; object-position: center` because it is what you always write. Choose: `cover` with a focal point when the frame is a different shape from the picture and the subject can take a crop; `contain` when the whole of it has to be visible and the box may have space in it; a deliberate scale when the subject is too small or too large in its own frame.",
  "Declare the choice so it can be adjusted later: `data-fit=\"cover\"` and `data-focal=\"50% 32%\"` on the <img>, which are compiled into `object-fit` and `object-position` after the build. A focal point of `50% 50%` is a decision too — write it only when the subject really is centred.",
  "Preserve the scale the reference chose. A subject that fills two thirds of its frame in the reference and a quarter of it in the build is the wrong picture, however good the crop.",
];

/* Responsive, stated as recalculation rather than as a breakpoint list.
 *
 * The rule people get wrong here is not "support phones" — everything supports
 * phones. It is that a phone layout is a different composition with the same
 * intent, and the failure is a desktop layout scaled down until it fits, which
 * passes every check and looks like nothing anybody designed. */
const RESPONSIVE_RULES = [
  "Lay the phone out as its own composition, then the tablet, then the desktop. The intent carries across; the measurements do not.",
  "Recalculate for each width rather than scaling: the image's scale and focal point, the text measure, the header height, the hero height, where the call to action falls, the content margins.",
  "A focal point that works at 1440px usually does not at 375px. A 16/9 hero becomes 4/5 on a phone and the subject has to be re-placed inside the new shape — that is a different `object-position`, in a media query.",
  "The phone layout is taller than the desktop one, because content that was in three columns is now in one. A page that is the same height on both has been shrunk rather than laid out.",
];

/**
 * How to read the pictures that came with this build.
 *
 * Written for the build prompt, and returned empty when nothing was attached —
 * a prompt carrying instructions about references that do not exist is a prompt
 * spending its opening on a hypothetical.
 */
export function referenceBrief(imageCount: number): string {
  if (!imageCount || imageCount < 1) return "";

  const some = imageCount === 1 ? "One image was" : `${imageCount} images were`;
  const it = imageCount === 1 ? "it" : "them";
  const its = imageCount === 1 ? "its" : "their";

  return `THE ATTACHED ${imageCount === 1 ? "IMAGE" : "IMAGES"} — read ${it} as a specification, not as inspiration.

${some} supplied alongside this brief. First decide what ${imageCount === 1 ? "it is" : "each one is"}, by looking at ${it}:

- A screenshot of a website, an app, a layout or a mockup is DIRECTION. Reproduce what it shows in HTML and CSS. Never place the file itself in the page — a design flattened into one image is not a page.
- A photograph, a product shot, a logo or an illustration is CONTENT. Place it, at the size and crop the layout needs.

Where ${it} ${imageCount === 1 ? "is" : "are"} direction, the reference is the specification for this build and matching it is the job. Read ${its} composition off ${it} and reproduce it:

${OBSERVABLES.map((item) => `- ${item}`).join("\n")}

Reproduce those measurements rather than approximating the feeling of them. A build that has the same colours and a different composition has not matched the reference; a build that has the same composition and slightly different colours has.

WHERE THE SUBJECT SITS — the part that is never right by accident:

${SUBJECT_RULES.map((item) => `- ${item}`).join("\n")}

EVERY WIDTH IS ITS OWN COMPOSITION:

${RESPONSIVE_RULES.map((item) => `- ${item}`).join("\n")}`;
}

/* The same thing, for an edit rather than a build.
 *
 * Shorter, because an edit already has a page in front of it and the question
 * is not "what does this design look like" but "which part of it does this
 * picture mean". The one rule it keeps in full is the direction/content one:
 * that is the mistake that produces a page with a screenshot of a page in it,
 * and it survives being told once. */
export function referenceEditBrief(imageCount: number): string {
  if (!imageCount || imageCount < 1) return "";

  return `ATTACHED ${imageCount === 1 ? "PICTURE" : "PICTURES"} — what ${imageCount === 1 ? "it is" : "they are"} for:

- A screenshot of a layout, a design or this page itself is DIRECTION: match what it shows in HTML and CSS, and do not place the file.
- A photograph, product shot or logo is CONTENT: place it with its attachment token as the src.
- A screenshot of THIS page marking a problem is a location. Find the markup behind what it shows and change that, and nothing around it.

When the reference shows a composition, match its measurements rather than its mood: container width, grid, header height, hero proportion, the spacing ratio between sections and within them, the type scale, and where the subject sits inside its own frame.`;
}
