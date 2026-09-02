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
 * either evidence for that action or is in the way of it, and `exclusions` is a
 * list of the things most often in the way. A landing page for a shop is still
 * a landing page: it links to the shop, it is not the shop. */

export const landing: Blueprint = {
  kind: "landing",

  identity:
    "A marketing page that takes one audience from not knowing this offer exists to taking one specific action. Every section is evidence for that action.",

  requirements: [
    "Navigation — the wordmark, three to five anchors that jump to real sections on this page, and the primary call to action as a button. Sticky, and it collapses to a working menu on a phone.",
    "Hero — a headline that names the audience and the outcome in their words, not the company's ('Ship your Rails app on Friday', not 'Welcome to Acme'). A subhead of at most twenty-five words. The primary call to action, one quieter secondary action beside it, and a line of risk-reducing detail under them. A piece of artwork built from inline SVG or CSS — a product frame, a diagram, a shape — never an <img> to a URL you invented.",
    "The value proposition, stated plainly — what this is, who it is for, and what changes for them. One short band, not a wall.",
    "The problem in their words — two or three blocks naming what is broken today and what it costs, concretely. This is what makes the rest land, and it is the first section a generic page leaves out.",
    "What it is and how it works — three or four numbered steps: what the person does, and what happens next. Steps, not adjectives.",
    "Features or benefits, with depth — two or three alternating rows, each pairing one specific capability with an inline-SVG or CSS depiction of it and naming the outcome rather than the mechanism.",
    "Proof — real trust elements: named customers as styled wordmarks, metrics a real company would publish ('12,400 deploys last month'), certifications, or an integration row. Never a line of grey rectangles.",
    "Testimonials or a case study, where the product would plausibly have them — two or three quotes with a full name, a role, a company and a result, or one case study with before and after numbers.",
    "The offer — pricing when the thing has a price (two or three tiers, real numbers, one marked as the common choice, and what each tier is actually for), or a single framed offer with what is included when it does not.",
    "Objections — at least five real questions this audience would ask, answered plainly, in <details> elements that open and close.",
    "Closing call to action — a full-width band that restates the outcome and repeats the hero's action, with the same words on the button.",
    "Footer — company, three short link columns pointing at real anchors, contact, and a copyright line with a real year.",
  ],

  optionalFeatures: [
    "A comparison table against the way this is done today.",
    "A short 'who this is not for' block, which reads as confidence rather than as sales copy.",
    "A logo-wall band, when the product would credibly have one.",
  ],

  depth: {
    minimumSections: 9,
    floors: [
      "Eleven is better than nine, and every one of them full. A hero, three cards and a footer is the demo everyone is tired of.",
      "At least five FAQ entries.",
      "At least three testimonials, metrics or named customers across the proof sections.",
      "Body copy in complete sentences. No section that is a heading plus four words.",
    ],
  },

  interactions: [
    "Nav anchors scroll to sections that exist. A link to #pricing with no #pricing on the page is the most common broken thing on a generated landing page.",
    "The email or sign-up form validates in-page and answers with a success state naming what happens next. It never posts anywhere.",
    "FAQ items open and close, and any tabs, accordions or carousels work with the keyboard.",
    "The pricing toggle, if there is one, actually changes the prices shown.",
  ],

  conditionalRequirements: [
    {
      when: "the brief names a physical location, a venue, or an in-person service",
      require: "opening hours, an address, and a map drawn as CSS or inline SVG rather than an embed",
    },
    {
      when: "the brief is for an event, a launch or a waitlist with a date",
      require: "a countdown or a dated schedule that is real and consistent with the copy around it",
    },
    {
      when: "the brief names a regulated field — health, finance, law",
      require: "the disclosure or credential line such a page would carry, stated plainly and not invented as a specific licence number",
    },
  ],

  exclusions: [
    "No cart, no basket, no add-to-cart button, no product grid meant for buying, no checkout, no order flow. If the business sells things, this page links to the shop and does not become one.",
    "No sign-in wall, no sign-up-into-a-dashboard, no account menu, no authenticated area. A quiet 'Log in' link is allowed only when the brief mentions an existing product.",
    "No blog index, no article archive, no author pages.",
    "No admin dashboard, no inventory management, no data tables, no settings, no CRUD.",
    "No second page and no router. One document, one scroll.",
  ],

  qualityRules: [
    "The copy is written for one named audience, and it is possible to say who by reading the hero alone.",
    "One action, repeated. The hero's button and the closing band's button ask for the same thing in the same words.",
    "Visual hierarchy carries the argument: the page should be scannable in ten seconds and still reward reading in full.",
    "Vary the section shapes. Eight identical stacked bands is a template, not a design.",
  ],

  completionRules: [
    "Every nav anchor resolves to a section that exists.",
    "Every claim of proof names something specific — a person, a company, a number.",
    "The page can be read end to end without meeting a control that does nothing.",
  ],
};
