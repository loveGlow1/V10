/* The rules every build obeys, whatever kind it is.
 *
 * Two halves, kept apart because they answer different complaints.
 *
 * CRAFT is the part that was already true and is unchanged in substance: one
 * self-contained file, content written into the markup, no storage APIs, and a
 * document that is actually finished. Those rules were learned from things that
 * went wrong in production — a page whose stories lived in a JS array arriving
 * empty in an email client, a session in localStorage crashing blank inside the
 * sandboxed preview frame — and none of them are up for renegotiation by a
 * blueprint.
 *
 * BAR is new, and it is the answer to "it keeps making a demo". A demo is not a
 * different kind of page; it is the same page with nothing in it. Four hollow
 * cards, three lines of copy about synergy, a price of $0.00 and a nav whose
 * links all point at "#". Every rule below names one of those tells and forbids
 * it by name, because "make it high quality" is advice and this has to be a
 * constraint. */

export const CRAFT = `OUTPUT FORMAT — absolute:
- Reply with the HTML document and nothing else. No prose before it, no explanation after it, no markdown fences.
- Start at <!doctype html> and end at </html>.
- FINISH THE DOCUMENT. An unfinished page is worthless — it renders as half a page and is rejected before it is stored. If you are running long, cut the sections marked optional in the blueprint below and finish the required ones. Never stop mid-document.

HOW IT IS BUILT:
- One file. Inline all CSS in a <style> tag and all JavaScript in a <script> tag. No build step, no imports, no bundler.
- Tailwind is available: <script src="https://cdn.tailwindcss.com"></script>. Prefer it over long hand-written stylesheets — it is far shorter, which is what leaves room to finish.
- No other external scripts, and no external images: use inline SVG, CSS gradients and solid shapes for artwork. A broken image is worse than no image, and every stock-photo URL you invent is broken.
- Prefer a system font stack over a webfont link. The page is downloadable as a file, and everything it fetches is something that file has to carry. Reach for a webfont only when the typeface is genuinely the design, and then only one family.
- Responsive from 320px up. Semantic HTML, labelled form controls, alt text, visible focus states, sufficient contrast.
- Forms and interactive controls must behave — validate and respond in-page. There is no server, so never post to one; show the state a real submission would produce.

CONTENT GOES IN THE HTML — the rule people notice when it is broken:
- Write every piece of content the page is about into the markup itself. Headlines, cards, prices, table rows, list items, articles, testimonials, the lot. If a reader is meant to see it, it is in the HTML.
- Do NOT build the page's content from a JavaScript array at load — no \`innerHTML = items.map(...)\` filling a container that ships empty. That pattern looks identical in a browser and renders nothing everywhere else.
- The page is downloadable as a file, and the places people open files are the strictest readers there are. An iOS file preview, an email client, a document viewer: many render the HTML and run none of the scripts. A page whose content lives in a JS array arrives there as a headline and four empty boxes.
- Use JavaScript for behaviour on top of content that is already there: filtering a list the HTML contains, opening a dialog the HTML contains, validating a form, switching a view. Enhancing, never constructing.
- If a filter or a "load more" hides some of it, ship it all in the markup and hide the extra with a class. Hidden content is content; absent content is nothing.

STATE — a hard constraint, not a preference:
- Hold all state in ordinary JavaScript variables.
- Do NOT use localStorage, sessionStorage, cookies or IndexedDB. The preview runs in a sandboxed frame with an opaque origin, and in that context those APIs throw a SecurityError on access — so a page that keeps its session there does not degrade, it crashes blank on load. If you have a real reason to touch one, wrap every access in try/catch and work correctly without it.
- State therefore lasts as long as the tab, which is expected. Say so once and quietly — a line of small text where it matters — rather than implying the data is real.`;

export const BAR = `THE BAR — you are building the real thing, not a demonstration of it:

- Write for THIS business. Every heading, sentence, price, name and number is specific to the brief: the industry's own vocabulary, plausible figures, real-sounding names of people and places. A reader who knows the field should recognise it.
- Placeholder text is a failed build. Never "Lorem ipsum", "Your headline here", "Feature one", "Product 1", "Item A", "Company Name", "Category", "Coming soon" as filler, "$0.00", "example@example.com", "Jane Doe" as the only name, or a heading followed by one sentence of nothing.
- Never leave a control inert. Every nav link points at an id that exists on the page; every button either does its job in-page or is a link that goes somewhere real on the page. A page of href="#" is a mockup.
- Meet the counts in the blueprint. When it says at least eight products or at least six articles, that is a floor, not a suggestion — three of anything reads as a placeholder for the rest, and the thinness is the single thing that makes a page look unfinished.
- Every section earns its place. If a section has nothing specific to say, drop it and make the ones that remain deeper; a page of eight thin sections is worse than four full ones.
- Design it rather than default it. A considered type scale, deliberate spacing, one coherent palette drawn from the brief's own world, restrained motion, and a shape to the page that is not four identical stacked bands.
- Match the ambition of the brief. A brief that names a competitor, an audience or a tone is telling you what standard to hit.`;

/* What each kind's blueprint fills in. The prose is deliberately in the
   blueprint files and not here: this is only the frame they hang on. */
export type Blueprint = {
  /** One sentence: what this kind of page is FOR. The model reads it first. */
  purpose: string;
  /** The sections it must contain, in order, each with what makes it real. */
  sections: string[];
  /** Sections worth having and safe to drop when the document is running long. */
  optional?: string[];
  /** Behaviour that has to actually work, not be depicted. */
  behaviour: string[];
  /** What this kind must NOT contain. The separation lives here. */
  excludes: string[];
  /** Counts and depths this kind is measured against. */
  depth: string[];
};
