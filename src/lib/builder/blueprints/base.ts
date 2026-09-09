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
  /* Exclusions that hold only while this project has no admin layer.
   *
   * "No admin dashboard, no inventory back office" is the right instruction for
   * a storefront that is a storefront, and exactly the wrong one for a store
   * with a merchant behind it — which is what the manifest now decides. Keeping
   * them in `exclusions` meant the prompt forbade the admin in one paragraph
   * and required it in another, and a model handed a contradiction resolves it
   * by picking one, silently.
   *
   * So they moved here, and blueprints/index.ts drops them when the manifest
   * has an admin. A blueprint with no admin half leaves this empty and nothing
   * changes for it. */
  frontendOnlyExclusions?: string[];
  /* The back office, when this project has one.
   *
   * Separate from `requirements` because it is a different product for a
   * different person: the storefront is judged on whether a shopper can buy
   * something and the admin on whether a merchant can run the shop, and a
   * single list that interleaves them produces a shop with an "Add product"
   * button on the home page. Only reached when the manifest says admin. */
  admin?: {
    /** What the back office IS, in one sentence. */
    identity: string;
    /** What it must contain. Read in place of nothing when there is no admin. */
    requirements: string[];
  };
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
- Style every slot so it holds its shape before anything loads: give it width, aspect-ratio and object-fit, and a background tone. A page whose pictures have not arrived must still be laid out correctly.

FRAMING — where the SUBJECT sits inside the picture, which is a second decision:
- A photograph has a thing in it, and that thing has a top and a bottom. The layout sizes the box; you decide which part of the picture the box keeps. Declare it on the slot and it is compiled into CSS after you finish: data-fit="cover" data-focal="50% 38%".
- data-fit is \`cover\` when the frame is a different shape and the subject survives a crop, \`contain\` when all of it must be visible and the box may have space in it.
- data-focal pins that point of the PICTURE to the same point of the BOX, exactly as object-position does — so it runs backwards from how it is spoken: a SMALLER second number shows more of the top and puts the subject LOWER in the frame.
- Never centre it by reflex. Centre crops equally off all four sides, which suits a texture and takes the tip off a cone. The subject stays whole: if the frame's shape means it cannot be, change the frame's aspect-ratio or use contain.
- NOTHING IMPORTANT GOES UNDER THE HEADER. Where the header is fixed or overlays the hero, the subject sits low enough that the header passes over empty picture — never a face, a product or the headline.
- Frame again for each width: a 16/9 hero becomes 4/5 on a phone and the subject has to be re-placed inside the new shape, which is a different object-position in a media query.

STILL DRAWN, AND DELIBERATELY SO — reach for inline SVG or CSS for all of these:
- Charts and graphs. A chart is data, and a photograph of one is unreadable.
- Diagrams that explain a mechanism, flows, floor plans, maps.
- Logos, wordmarks, monograms and avatars.
- Icons, rules, patterns, textures and background shapes.
Never send one of these through a photo slot, and never send a photograph through an SVG.
- Prefer a system font stack over a webfont link. The page is downloadable as a file, and everything it fetches is something that file has to carry. Reach for a webfont only when the typeface is genuinely the design, and then only one family.
- Semantic HTML, labelled form controls, alt text, visible focus states, sufficient contrast.
- Forms and interactive controls must behave — validate and respond in-page. There is no server, so never post to one; show the state a real submission would produce.

THE PHONE IS THE DESIGN, NOT A CONCESSION TO IT:
- Lay it out for 320px first and let it grow. It is checked at 320, 375, 480, 768, 1280 and 1440 and has to be right at all six, not merely uncut.
- Each width is its own composition with the same intent, not the desktop one scaled down: recalculate the image scale, the focal point, the text measure, the header height, the hero height and the margins for it. A page the same height on a phone as on a laptop has been shrunk rather than laid out.
- ZERO horizontal scrolling at any width. What causes it, every time: a fixed px width, an unmeetable min-width, \`width: 100vw\` (that includes the scrollbar — use 100%), a fixed column count, an unbroken string, a wide table, an image with no max-width. Never hide it with \`overflow-x: hidden\` — that leaves the content cut off where nobody can reach it.
- Fluid over fixed: \`max-width\` not \`width\`, \`clamp()\` for type that scales, \`repeat(auto-fit, minmax(min(100%, 260px), 1fr))\` for a grid that must become one column, \`flex-wrap: wrap\` for a row that must stack.
- The navigation needs a layout for a narrow screen — stacked, wrapped, or behind a button opening a panel already in the markup. A horizontal nav that never becomes anything else lands on top of itself.
- Forms on a phone: one full-width field per line, labels above, 44px on anything you tap. Images take \`max-width: 100%\`, \`height: auto\`, \`object-fit: cover\`, and their container decides the size. Tables scroll inside their own box, never by taking the page with them.

WHAT IS TRUE — the rule about numbers, and it outranks how the page looks:
- NEVER invent business data: revenue, sales, turnover, growth, customer or user counts, transactions, ratings, review counts, uptime, conversion — unless the brief supplied the figure. These go out under a real company's name to their own customers, and the plausible ones are the worst, because nobody catches them.
- NEVER draw a chart of business performance from numbers you chose; a revenue graph with invented data is a lie with axes on it. NEVER write a testimonial, review, star rating or customer quote and present it as real. If the design needs the block, label it plainly as an example.
- Where a section wanted a statistic and the brief has none, say something true in the same space: what the business does, how the work is done, what is sold, who it is for, where it happens, what it costs.
- Where analytics or a dashboard is explicitly asked for and no data exists, build the real interface around an EMPTY STATE — "Analytics will appear once data is connected" — axes, filters and layout present, no invented series.
- Numbers that ARE content stay: prices, sizes, weights, opening hours, distances, dates, a menu's figures. The rule is about claims of performance, not about arithmetic.

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
- The last line of the document is </html>, and what precedes it is a complete product rather than a screenshot of one.

THE STANDARD IT IS JUDGED AGAINST — a studio's work, not a template's:
- Hierarchy before decoration. One thing is the most important thing on each screen, and size, weight, space and colour agree about which. A page where everything is emphasised has emphasised nothing.
- Space is the material. Generous, uneven, intentional: a section break is bigger than a paragraph break, a heading owns the room above it, and nothing is centred merely because it fitted.
- Typography carries the design. A real scale with real jumps, long-form text at 60–75 characters a line, headings that are allowed to be large.
- Restraint. A card, a border and a shadow are each a decision; three of them stacked around the same content are none. Do not fill space with cards, tiles, badges, stats or a dashboard because a section looked empty — cut the section or deepen it.
- Motion, sparingly and always for a reason: a transition on hover and focus, a considered state change. Nothing that moves on its own, nothing that delays the reading.
- The result should look art-directed — as though somebody chose the crop, the pairing and the order — rather than assembled from parts that each looked reasonable alone.`;

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
