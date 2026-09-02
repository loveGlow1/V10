import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A landing page.
 *
 * The kind that was worst served by one shared prompt, and the reason this
 * split exists. Asked for a landing page, the old prompt reached for whatever
 * furniture it had — a product grid here, a cart icon there, a sign-in link in
 * the nav — because nothing told it that a landing page is a specific thing
 * with a specific job rather than "a website, generically".
 *
 * The job is one audience, one offer, one action. Everything on the page is
 * either evidence for that action or is in the way of it, and `excludes` below
 * is a list of the things that are most often in the way. A landing page for a
 * shop is still a landing page: it links to the shop, it is not the shop. */

export const landing: Blueprint = {
  purpose:
    "One page that takes one audience from not knowing this offer exists to taking one specific action. Every section is evidence for that action.",

  sections: [
    "Nav — the wordmark, three to five anchors that jump to real sections on this page, and the primary call to action as a button. Sticky, and it collapses to a working menu on a phone.",
    "Hero — a headline that names the audience and the outcome in their words, not the company's ('Ship your Rails app on Friday', not 'Welcome to Acme'). A subhead of at most twenty-five words that says what it is and who it is for. The primary CTA, one quieter secondary action beside it, and one line of risk-reducing detail under them (no card required, cancel any time, free while in beta). A piece of artwork built from inline SVG or CSS — a product frame, a diagram, a shape — never an <img> to a URL you invented.",
    "Proof strip — immediately under the hero. Either five or six customer wordmarks set as styled text or inline SVG, or three metrics that a real company would publish ('12,400 deploys last month'). Never a row of grey rectangles.",
    "The problem, in their words — two or three short blocks naming what is broken today and what it costs, concretely. This is the section that makes the rest land, and it is the first one a generic page leaves out.",
    "How it works — three or four numbered steps, each one sentence of what the person does and one of what happens next. Steps, not features.",
    "Feature depth — two or three alternating rows, each pairing one specific capability with an inline-SVG or CSS depiction of it, and naming the outcome rather than the mechanism.",
    "Proof — two or three testimonials with a full name, a role, a company and a sentence that names a result. Or one long case-study block with before and after numbers.",
    "The offer — pricing when the thing has a price (two or three tiers, real numbers, one marked as the common choice, and what each tier is actually for), or a single framed offer with what is included when it does not.",
    "Objections — five or six real questions this audience would actually ask, answered plainly, in <details> elements that open and close.",
    "Closing call to action — a full-width band that restates the outcome and repeats the same action as the hero, with the same words on the button.",
    "Footer — company, three short link columns pointing at real anchors, contact, and a copyright line with a real year.",
  ],

  optional: [
    "A comparison table against the way things are done today.",
    "A short FAQ-adjacent 'who this is not for' block, which reads as confidence rather than as sales copy.",
  ],

  behaviour: [
    "Nav anchors scroll smoothly to sections that exist. A link to #pricing with no #pricing on the page is the single most common broken thing on a generated landing page.",
    "The email or sign-up form validates in-page and answers with a success state that names what happens next. It never posts anywhere.",
    "FAQ items open and close. Any tabs or carousels work with the keyboard.",
  ],

  excludes: [
    "No cart, no basket, no add-to-cart button, no product grid, no checkout, no order flow. If the business sells things, this page links to the shop and does not become one.",
    "No sign-in, no sign-up-to-a-dashboard, no account menu, no authenticated area. A 'Log in' link in the nav is allowed only if the brief mentions an existing product; it goes nowhere and is styled quietly.",
    "No blog index, no article archive, no category filters, no author pages.",
    "No admin panel, no data tables, no settings, no CRUD.",
    "No second page and no router. One document, one scroll.",
  ],

  depth: [
    "Nine to eleven sections, all of them full. A landing page that is a hero, three cards and a footer is the demo everyone is tired of.",
    "At least three testimonials, metrics or logos of real weight in the proof sections combined.",
    "At least five FAQ entries.",
    "Body copy in complete sentences: no section that is a heading plus four words.",
  ],
};
