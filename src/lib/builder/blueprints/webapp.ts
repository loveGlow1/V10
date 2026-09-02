import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A web application.
 *
 * The kind that must not be one shape. "Web app" covers a SaaS platform, a CRM,
 * a project tracker, a finance tool, an AI utility, a booking system, an
 * internal tool, an analytics product — and the first version of this blueprint
 * required all of them to have sign-in, three related tables, an API surface
 * and a SQL appendix. That is right for a CRM and absurd for a unit converter,
 * and a blueprint that demands a back end from a calculator produces the same
 * fake dashboard the whole split was meant to stop.
 *
 * So the requirements here are what every application has whatever it is — a
 * shell, navigation, four real workflows, and the four states that separate an
 * application from a screenshot of one — and everything architectural moved
 * into `conditionalRequirements`, each with the test that brings it in.
 *
 * When a product does need a back end, it is designed rather than implied: one
 * HTML file has no server, and no amount of prompting changes that. What it can
 * carry is a data layer that behaves like an API over declared tables, and the
 * schema and endpoint list written out at the end, so what the preview
 * demonstrates is a design somebody could go and build. */

export const webapp: Blueprint = {
  kind: "webapp",

  identity:
    "A working application: the product the brief describes, with the shell, the navigation and the real workflows it would actually have — shaped by what it is, not forced into a dashboard.",

  requirements: [
    "An application shell appropriate to THIS product. A tool with one job gets a workspace and a slim bar; a multi-object product gets a sidebar, a top bar and a content area. Choose the shell the product needs and say nothing about a dashboard unless it needs one.",
    "Navigation that names the real parts of this product, and leads to every one of them. Nothing in the navigation is unbuilt.",
    "At least four meaningful views, states or workflows — the things people actually come here to do. A workflow counts when it changes something and can be carried out end to end; a view that only displays does not.",
    "The product's primary workflow, built in full and prominent: the thing this application is for, from starting it to finishing it, including whatever it produces.",
    "Meaningful data representation — whatever this product's information actually is, written into the HTML: records, entries, results, documents, events, messages. Real values, varied, plausible for the domain.",
    "Create and edit, where the product has anything to create: a properly labelled form, field-level validation with inline errors, a busy state while it runs, and the result reflected everywhere it appears.",
    "Destructive actions confirmed by name, with an undo affordance where one makes sense.",
    "The four states, everywhere they apply: loading while something runs, empty when there is nothing yet (with the way to start), success when something lands, and error when something fails — stated in the interface, not in an alert.",
    "A settings or preferences surface appropriate to the product's size.",
  ],

  optionalFeatures: [
    "A command palette on ctrl/cmd-K over content already in the page.",
    "Keyboard shortcuts for the primary workflow.",
    "A dark-mode toggle.",
    "An onboarding checklist or first-run state.",
  ],

  depth: {
    minimumSections: 4,
    counts: "views, states or workflows",
    floors: [
      "All of them built. A navigation of six items where four do nothing is the tell.",
      "Enough seeded content to look used rather than new: for a records product, twenty or more rows with varied names, dates spread over months, several statuses and realistic amounts; for a tool, enough worked examples and history to show what it does.",
      "The primary workflow deep enough to be judged on: not one screen, but the sequence a real use of it takes.",
      "Depth appropriate to the product asked for. A team platform is bigger than a personal utility, and neither should be padded to look like the other.",
    ],
  },

  interactions: [
    "Views are sections of one document, shown and hidden by script. Never navigate away, never use a router, never open a second page.",
    "Every mutation re-renders what it affects. A record edited in a dialog changes in the list, in the detail panel, and in any figure derived from it.",
    "Sorting, filtering, searching and pagination all operate on content the HTML already contains.",
    "Anything that would take time shows a busy state while it runs, and at least one path returns a real error the interface handles properly.",
    "Forms validate specifically and inline. Nothing posts anywhere.",
  ],

  conditionalRequirements: [
    {
      when: "the product has user accounts, personal workspaces, saved data, private content, or more than one user",
      require:
        "sign-in, sign-up and sign-out that work, validating properly with inline errors; a protected area that does not render until someone is signed in; and ONE SEEDED DEMO ACCOUNT WHOSE EMAIL AND PASSWORD ARE PRINTED ON THE SIGN-IN SCREEN — a preview nobody can get into is a locked door",
    },
    {
      when: "the product has admins, team members, different access levels, or actions only some people may take",
      require:
        "roles on the seeded people, and permissions enforced where the action is carried out rather than by hiding the button — a viewer who cannot delete gets a refusal, not a missing control",
    },
    {
      when: "the product holds structured data that persists between uses",
      require:
        "a declared data model at the top of the script: tables as arrays of records with explicit ids, foreign keys, timestamps and enums, seeded realistically, with nothing in the interface reading a table directly",
    },
    {
      when: "the product needs a front end and a back end to talk to each other",
      require:
        "one api object as the only way the interface touches data — async methods that validate, enforce permissions, and return either data or a typed error; and the endpoint list it stands in for written out at the end of the document as an HTML comment, one line each with method, path and what it returns",
    },
    {
      when: "the product genuinely needs server-side work — persistence, authentication, integrations, scheduled or protected operations",
      require:
        "the back end designed and written down: the SQL schema (tables, columns, types, primary and foreign keys, indexes, and row-level security policies in Postgres/Supabase form) in an HTML comment at the end of the document, alongside the endpoints",
    },
    {
      when: "the product is a calculator, converter, generator, editor, single-purpose AI tool or other lightweight utility",
      require:
        "NONE of the four requirements above. No sign-in, no tables, no api layer, no schema. Build the tool itself properly instead: the input, the work, the result, the history of what has been done in this session, and the states around all of it. Forcing a CRM's architecture onto a utility is the failure this rule exists to prevent",
    },
    {
      when: "the product is analytics, reporting or monitoring",
      require: "charts drawn as inline SVG from the seeded data, with real axes and real values — never a charting library, never a decorative shape",
    },
    {
      when: "the product involves scheduling, bookings or a calendar",
      require: "a working calendar or availability view with real slots, and a booking that can be made, seen afterwards and cancelled",
    },
  ],

  exclusions: [
    "No marketing hero, no feature grid, no testimonials, no pricing section inside the application. The first screen is the product (or its sign-in, when it has one).",
    "No storefront mechanics — cart, checkout, product grid — unless the brief explicitly asked for them.",
    "No fake dashboard widgets. A tile, chart or counter that does not read from something real in the page is worse than no tile.",
    "No navigation item, tab or view that is not built.",
    "No fetch to any URL and no real network calls. Where the product needs a back end, the api layer is it.",
    "No storage APIs — state lives in variables. Say once, quietly, that it resets when the tab closes.",
  ],

  qualityRules: [
    "The structure matches the product that was asked for. If the brief says invoicing, the objects are invoices, clients and payments — not 'Items' on a generic dashboard.",
    "Use the domain's own vocabulary throughout: its words for its objects, its statuses, its actions.",
    "Density belongs to the kind of product. A data tool may be dense; a consumer tool should not be.",
    "Seeded content reads like a real account in use: varied, uneven, with history behind it.",
    "Do not add architecture the product does not need, and do not skip architecture it does.",
  ],

  completionRules: [
    "Every item in the navigation opens something that was built.",
    "The primary workflow can be carried out from start to finish, and what it produces persists for the rest of the session.",
    "Loading, empty, success and error states exist wherever they apply, not only on the first screen.",
    "Where a conditional requirement applied, it is met in full — and where none applied, none was invented.",
  ],
};
