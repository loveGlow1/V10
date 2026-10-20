import type { Blueprint } from "@/lib/builder/blueprints/base";

/* The marketing site of a software or AI product.
 *
 * A landing page with a stricter job. A SaaS site is judged by people who
 * have seen a thousand of them, so the furniture is fixed — a hero, a logo
 * cloud, a feature grid, the product shown working, pricing, an FAQ and a
 * closing call — and what separates a good one is that every piece of it is
 * about THIS product. The product demo is the section a generated site skips
 * and the one a buyer looks for first: an interface drawn in code, with the
 * product's own objects in it, not a stock photo of a laptop.
 *
 * Built on the landing family (kinds.ts): one audience, forms kept the way any
 * page keeps them, no accounts. The leads and the waitlist are its two tables
 * when it has a database — see the saas preset in presets.ts. */

export const saas: Blueprint = {
  kind: "saas",

  identity:
    "The marketing site of a software or AI product: it shows the product working, makes the case for it to one kind of buyer, and turns them into a trial, a demo request or a place on the waitlist.",

  requirements: [
    "Navigation — the wordmark, links to Product, Pricing, FAQ and any other section that exists, a quiet 'Log in' only if the brief says there is an app to log in to, and the primary call to action as a button. Sticky, and it collapses to a working menu on a phone.",
    "Hero — an eyebrow naming the category, a headline that names the outcome for the buyer in at most ten words, a subhead of at most thirty words, the primary call to action (start a trial, join the waitlist or book a demo — whichever the brief implies) and one quieter secondary action. Beside or under it, the product itself drawn in HTML and CSS: a framed window with the product's real objects in it.",
    "Logo cloud — five or six customer or integration wordmarks set as styled text in one muted tone, with a one-line caption ('Teams at … ship with …'). Never grey rectangles, never invented logos as images.",
    "Feature grid — six capabilities in a three-column grid, each with an inline-SVG icon, a title of at most five words and one sentence on what it changes for the buyer.",
    "Product demo — the product shown working: two or three tabs or steps, each switching a drawn interface (the dashboard, the editor, the result) with real, domain-specific content in it, and a caption saying what is happening. This is the section that sells, so it is the most detailed one on the page.",
    "How it works — three numbered steps from signing up to the first result.",
    "Social proof — two or three testimonials with a full name, role, company and a result in numbers, or one short case study with before and after figures.",
    "Pricing — two to four tiers with real prices, what each is for, four to eight included features each, one marked as the usual choice, and a monthly/yearly toggle that really changes the prices.",
    "FAQ — at least six real buyer questions (security, data, cancelling, trials, integrations, support) in <details> elements.",
    "Closing call to action — a full-width band that repeats the hero's action in the same words, with a working waitlist or trial form.",
    "Footer — product, company and resources columns pointing at real anchors, a status or security line, and a copyright with a real year.",
  ],

  optionalFeatures: [
    "An integrations row naming the tools it connects to.",
    "A comparison table against the old way of doing the job.",
    "A changelog teaser with three dated entries.",
    "A security and compliance band (encryption, SSO, data residency) when the buyer is a business.",
  ],

  depth: {
    minimumSections: 9,
    floors: [
      "Six features, not three — three cards is the demo everyone is tired of.",
      "At least six FAQ entries.",
      "The product demo shows at least two distinct screens of the product with real content in them.",
      "Pricing with real numbers in the market's currency, never 'Contact us' on every tier.",
    ],
  },

  interactions: [
    "Every nav link scrolls to a section that exists. A link to #pricing with no #pricing on the page is a broken site.",
    "The demo's tabs or steps switch what the drawn product shows, and work with the keyboard.",
    "The pricing toggle changes every price it claims to.",
    "The waitlist or trial form validates in-page (a real email check, inline errors) and answers with a success state that says what happens next.",
    "FAQ items open and close.",
  ],

  conditionalRequirements: [
    {
      when: "the brief names Stripe, paid plans, a trial with billing, or a checkout",
      require:
        "each paid tier's button wired to a Stripe Checkout socket — the button carries the plan and the price, and until Stripe is connected it answers 'Payments connect to a back end that isn't attached yet' rather than pretending to charge",
    },
    {
      when: "the brief asks for emails, a newsletter, or confirmation of the waitlist",
      require:
        "the waitlist and contact forms declared as sending a confirmation email through Resend once connected — the form still keeps every entry today",
    },
    {
      when: "the product is an AI product",
      require:
        "the demo shows a real input and a real, specific output for this product's domain, and the copy is plain about what the model does and does not do — no 'revolutionary AI' language",
    },
  ],

  exclusions: [
    "No working application behind a sign-in. This is the site that sells the product, not the product — a 'Log in' link is the most it may carry.",
    "No cart, no product grid for buying goods, no checkout flow beyond the pricing buttons.",
    "No blog index or article archive on the home page.",
    "No gradients, glows or emoji used as decoration; no stock photo of people pointing at a laptop.",
  ],

  qualityRules: [
    "The tokens are a neutral grey scale and ONE accent. Hairline 1px borders rather than shadows. Display type tightly tracked. Generous section spacing on a container of about 1200px.",
    "One subtle fade-up as sections enter, and nothing else that moves on its own.",
    "Every section is about this product: its objects, its buyer, its numbers. A section that would fit any SaaS site is filler.",
    "Copy is short, concrete and in the buyer's words.",
  ],

  completionRules: [
    "Every nav link resolves to a section that exists.",
    "The product demo, the pricing toggle and the waitlist form all work.",
    "The hero's button and the closing band's button ask for the same thing in the same words.",
  ],

  assets: {
    photographs: ["hero", "editorial"],
    drawn: ["logo", "brand-mark", "icon", "screenshot", "illustration", "avatar", "decorative"],
    note:
      "The product is drawn, not photographed: the interface in the hero and the demo is HTML and CSS with real content. At most one or two photographs of the people it is for. Customer avatars are monograms.",
  },
};
