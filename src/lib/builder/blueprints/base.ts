import type { AssetType } from "@/lib/builder/assets/asset-types";
import type { BuildKind } from "@/lib/builder/kinds";

/* The contract every blueprint fills in, and the rules all four inherit.
 *
 * Three parts to this file:
 *
 *   Blueprint  — the shape. Nine fields, and the reason there are nine rather
 *                than one block of prose per kind is that each one is a
 *                different kind of instruction, and they are enforced
 *                differently. Requirements are what must exist. Conditional
 *                requirements are what must exist *if* the brief asks for it —
 *                the field that stops a calculator being given a CRM's back
 *                end. Exclusions are what must not exist at all. Depth is the
 *                floor. Completion rules are how "finished" is judged.
 *
 *   BASE       — how anything is built here at all: one self-contained file,
 *                content written into the markup, no storage APIs, and a
 *                document that is actually finished. These were learned from
 *                things that went wrong in production and are not negotiable by
 *                a blueprint.
 *
 *   BAR        — the anti-demo floor. A demo is not a different kind of page;
 *                it is the same page with nothing in it. Four hollow cards,
 *                three lines about synergy, a price of $0.00, and a nav whose
 *                links all point at "#". Every rule here names one of those
 *                tells and forbids it, because "make it high quality" is advice
 *                and this has to be a constraint. */

/** Something the build must contain if — and only if — the brief calls for it. */
export type ConditionalRequirement = {
  /** What has to be true of the brief. Written as a test, not as a topic. */
  when: string;
  /** What is then required. */
  require: string;
};

export type Blueprint = {
  kind: BuildKind;
  /** What this kind of product IS, in one sentence. The model reads it first. */
  identity: string;
  /** What every build of this kind must contain, in the order it is built. */
  requirements: string[];
  /** Worth having, and the first thing to cut when the document runs long. */
  optionalFeatures: string[];
  depth: {
    /** The fewest full units this may ship with. */
    minimumSections: number;
    /** What that number counts, when it is not sections. */
    counts?: string;
    /** The other floors: how many products, articles, rows, words. */
    floors: string[];
  };
  /** Behaviour that has to work, not be depicted. */
  interactions: string[];
  /** Architecture that appears only when the product actually needs it. */
  conditionalRequirements: ConditionalRequirement[];
  /** What this kind must not become. The separation lives here. */
  exclusions: string[];
  /** The standard this kind in particular is judged against. */
  qualityRules: string[];
  /** What "finished" means for this kind. Checked before the document ends. */
  completionRules: string[];
  /* What this kind needs to LOOK like it should, which is a different question
     from what it must contain. Named here rather than left to the code model,
     because a model deciding its own imagery one section at a time is how a
     project ends up with a luxury photograph, a cartoon and a 3D render in it.
     The planner reads this; see src/lib/builder/assets/asset-planner.ts. */
  assets: {
    /** Photographs this kind genuinely needs, by asset type. */
    photographs: AssetType[];
    /** Made in code, and not to be sourced or generated under any circumstance. */
    drawn: AssetType[];
    /** One line on how imagery should behave for this kind in particular. */
    note: string;
  };
};

export const BASE = `HOW ANYTHING IS BUILT HERE:
- One file. Inline all CSS in a <style> tag and all JavaScript in a <script> tag. No build step, no imports, no bundler.
- Tailwind is available: <script src="https://cdn.tailwindcss.com"></script>. Prefer it over long hand-written stylesheets — it is far shorter, which is what leaves room to finish.
- No other external scripts, and never an image URL: you cannot know one that works, and every stock-photo address you invent is a broken image.

PHOTOGRAPHS — do not draw them, declare them:
- Anywhere the design wants a PHOTOGRAPH — a product, a person, a room, a plate of food, a hero shot — write an <img> that describes the picture instead of an SVG that imitates it. A vector drawing of fabric reads as clip art; that is the single thing that makes a generated page look generated.
- The tag carries the art direction and nothing else. Leave src out entirely — it is filled in with a real photograph after you finish, and a src you write yourself would be overwritten or broken:

  <img data-shot="folded ochre wax print fabric, raking light, neutral seamless background"
       data-ratio="4/5" data-weight="thumb" alt="Ochre Adire wax print, six yards">

- data-shot is a photographer's brief: subject first, then lighting, setting and mood. "Woman in her forties at a workbench, soft window light, shallow depth of field" — not "image of a person".
- THE SUBJECT IS THIS BUSINESS, NOT ITS CATEGORY. Only the first clause is searched for, so it is the one clause that has to be specific: "adire wax print fabric folded on oak" finds this shop's cloth, where "textiles" finds a warehouse. Name the actual goods, the actual room, the actual work, the actual people — with their trade, their place and their period where the brief gives you one. A page whose photographs would suit any competitor is a page with stock on it.
- The pictures on one page must look like one commission. Same register, same light, same era, same treatment of people throughout — the difference between a publication and a mood board is that somebody chose.
- data-ratio is the crop the layout needs: 16/9, 4/3, 1/1, 4/5, 3/4.
- data-weight is hero, feature or thumb — how much of the page's picture budget it may take. One or two heroes at most.
- alt is real alt text describing the photograph, not the file.
- Style every slot so it holds its shape before anything loads: give it width, aspect-ratio and object-fit: cover, and a background tone. A page whose pictures have not arrived must still be laid out correctly.

STILL DRAWN, AND DELIBERATELY SO — reach for inline SVG or CSS for all of these:
- Charts and graphs. A chart is data, and a photograph of one is unreadable.
- Diagrams that explain a mechanism, flows, floor plans, maps.
- Logos, wordmarks, monograms and avatars.
- Icons, rules, patterns, textures and background shapes.
Never send one of these through a photo slot, and never send a photograph through an SVG.
- Prefer a system font stack over a webfont link. The page is downloadable as a file, and everything it fetches is something that file has to carry. Reach for a webfont only when the typeface is genuinely the design, and then only one family.
- Responsive from 320px up. Semantic HTML, labelled form controls, alt text, visible focus states, sufficient contrast.
- Forms and interactive controls must behave — validate and respond in-page. There is no server, so never post to one; show the state a real submission would produce.

CONTENT GOES IN THE HTML — the rule people notice when it is broken:
- Write every piece of content the build is about into the markup itself. Headlines, cards, prices, table rows, articles, list items, testimonials, the lot. If a reader is meant to see it, it is in the HTML.
- Do NOT build content from a JavaScript array at load — no \`innerHTML = items.map(...)\` filling a container that ships empty. That pattern looks identical in a browser and renders nothing everywhere else.
- The page is downloadable as a file, and the places people open files are the strictest readers there are. An iOS file preview, an email client, a document viewer: many render the HTML and run none of the scripts. Content that lives in a JS array arrives there as a headline and four empty boxes.
- Use JavaScript for behaviour on top of content that is already there: filtering a list the HTML contains, opening a dialog the HTML contains, validating a form, switching a view. Enhancing, never constructing.
- If a filter or a "load more" hides some of it, ship it all in the markup and hide the extra with a class. Hidden content is content; absent content is nothing.
- The one thing script may produce is what somebody's own input computes — a result, a total, a schedule, a chart of numbers they entered. That cannot be written in advance and nobody expects it to be. What it does not excuse is an empty shell: ship a worked default in the markup, so the build renders as something finished before a single event fires, and recompute over it from there.

STATE — a hard constraint, not a preference:
- Hold all state in ordinary JavaScript variables.
- Do NOT use localStorage, sessionStorage, cookies or IndexedDB. The preview runs in a sandboxed frame with an opaque origin, and in that context those APIs throw a SecurityError on access — so anything keeping its session there does not degrade, it crashes blank on load. If you have a real reason to touch one, wrap every access in try/catch and work correctly without it.
- State therefore lasts as long as the tab, which is expected. Say so once and quietly, where it matters, rather than implying the data is real.

FINISHING — how this is judged before anything else:
- Reply with the HTML document and nothing else. No prose before it, no explanation after it, no markdown fences. Start at <!doctype html> and end at </html>.
- FINISH THE DOCUMENT. An unfinished build is worthless — it renders as half a page and is rejected before it is stored.
- Build the required list in full, then the optional list with whatever room is left. If you are running long, drop optional features; never stop mid-document and never leave a required piece hollow to reach the end.
- Everything the build claims must exist. A nav item names a section that is there; a filter names a category that has entries; a view named in the navigation is a view that was built.
- Keep it internally consistent. One palette, one type scale, one voice, one currency, one date format. The same product costs the same everywhere it appears; the same person has the same name and role everywhere they appear.
- Never imply functionality that is not there. It is better to leave a feature out than to draw a control for it.
- The last line of the document is </html>, and what precedes it is a complete product rather than a screenshot of one.`;

export const BAR = `THE BAR — you are building the real thing, not a demonstration of it:

- Write for THIS product. Every heading, sentence, price, name and number is specific to the brief: the industry's own vocabulary, plausible figures, real-sounding names of people and places. A reader who knows the field should recognise it.
- Never use: Lorem ipsum, generic placeholder copy, a placeholder company name unless the brief asked for one, invented stock people such as "John Doe" or "Jane Doe", "$0.00", "example@example.com", "Category", "Feature one", "Product 1", "Item A", or "Coming soon" unless the brief asked for it.
- Never ship an empty card added to fill a row, or the same card repeated with the words swapped. Repetition is the loudest tell there is.
- Never write generic AI feature copy — "Powerful features", "Seamlessly integrate", "Take your business to the next level". Say what the thing does.

THE INTERACTION RULE — every visible interactive element must do at least one meaningful thing:
1. go somewhere real on the page,
2. change the state of what is being built,
3. submit or validate data,
4. open a dialog or panel that is genuinely there,
5. carry out the action its own label describes, or
6. perform some other real in-page interaction.
If an element does none of those, do not render it as an interactive control. No fake buttons, no inert controls, no decorative navigation, no href="#", no empty links, and nothing that looks pressable and is not.

THE SECTION DEPTH RULE — meaningful depth over artificial length:
- A section exists because it has something to say, never to make the build look longer.
- A feature section that reads "Feature one / some text. Feature two / some text." is a failed section. Each part carries supporting detail, a real example, a number, a depiction, or proof — whatever that section is actually for.
- Three thin sections should be two full ones. When you have to choose, cut the section and deepen what remains.
- Meet the floors below. They are a floor, not a target: three of anything reads as a placeholder for the rest, and that thinness is the single thing that makes a build look unfinished.`;
