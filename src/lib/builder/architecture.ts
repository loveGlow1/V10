/* Which layers a project is actually made of.
 *
 * The builder had two answers to this and neither was the question. kinds.ts
 * asks what a project is ABOUT — a store, a blog, an application. stack.ts asks
 * whether it can exist as one HTML file. Between them sits the thing that
 * decides what actually gets built: does this project have a database, does
 * anyone sign in, is there an admin side, does it hold files, does it take
 * money. Nothing answered that, so every project got the same answer by
 * accident — a storefront with no merchant behind it, a blog whose posts are
 * typed into the markup and cannot be edited by the person whose blog it is.
 *
 * The manifest is that answer, written down once and carried through the whole
 * pipeline: it picks the schema (schema.ts), it picks the routes and the client
 * the scaffold writes (scaffold.ts), it turns on the admin half of a blueprint
 * (blueprints/*), and it is stored with the build so that an edit six weeks
 * later can read what this project IS before changing it.
 *
 * ── Seven layers, and the discipline is which ones are OFF ────────────────
 *
 * The failure this exists to prevent is not a missing layer. It is a landing
 * page for a dentist arriving with a users table, an admin dashboard and a
 * storage bucket, because "more complete" sounded better than "correct". Every
 * layer here costs something real — a schema to migrate, policies to get right,
 * an admin nobody asked for — so each one has to be argued for by the brief or
 * by what the kind genuinely is, and the default for anything unargued is off.
 *
 * ── Where this may overrule stack.ts, and where it may not ────────────────
 *
 * stack.ts leans hard toward the single page, deliberately: the page previews
 * instantly, costs less, and is the safe half of a wrong answer. That lean is
 * right for a brief that is silent. It is wrong for a store.
 *
 * "Build me a shop" mentions no login, no database and no second route, so
 * stack.ts reads it as a page — and a shop that is one page is a picture of a
 * shop. Nobody can add a product to it, no order survives the tab closing, and
 * the person who asked for a store has been handed a brochure. So a kind whose
 * whole definition includes a back office (a store, a publication with a CMS)
 * may RAISE the stack to a project here.
 *
 * Two things bound that, and both matter more than the promotion does:
 *
 *   It never fires against the brief. Somebody who wrote "just the storefront
 *   design, no backend" has answered this question, and a promotion that
 *   ignores them is the builder deciding it knows better.
 *
 *   It never fires silently when it is a guess. A promotion carries `certain:
 *   false` back to the caller, which asks rather than spending a build — the
 *   same guard stack.ts already uses for soft evidence, for the same reason:
 *   the mistake is not recoverable by editing.
 *
 * Pure on purpose, like kinds.ts, market.ts and stack.ts beside it: regexes,
 * types and a decision function, no SDK import. The browser reads it to label a
 * project's layers and tools/check-architecture.mjs compiles it on its own.
 */

import type { BuildKind } from "./kinds";
import type { StackNeeds } from "./stack";

/* The layers, in the order they are built and the order they are read. Frontend
   is first because everything has one; payments is last because almost nothing
   does. */
export const LAYERS = [
  "frontend",
  "backend",
  "database",
  "authentication",
  "admin",
  "storage",
  "payments",
] as const;

export type Layer = (typeof LAYERS)[number];

/** What each layer is called where a person reads it. */
export const LAYER_LABEL: Record<Layer, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  authentication: "Authentication",
  admin: "Admin",
  storage: "Storage",
  payments: "Payments",
};

/**
 * What a project is made of.
 *
 * `frontend` is typed as the literal `true` rather than `boolean` because there
 * is no such thing here as a project without one, and a type that admits the
 * impossible case invites a branch that handles it.
 */
export type ArchitectureManifest = {
  type: BuildKind;
  frontend: true;
  backend: boolean;
  database: boolean;
  authentication: boolean;
  admin: boolean;
  storage: boolean;
  payments: boolean;
};

export type ArchitectureResult = {
  manifest: ArchitectureManifest;
  /* One clause per layer that is on, saying what turned it on. Read by the step
     list, and by anyone arguing with the answer — which is the point: "your
     store has an admin because it is a store" is a sentence somebody can
     disagree with, and "true" is not. */
  why: string[];
  /* Whether the project must be built as a tree of files rather than one page.
     Any layer past the frontend implies it: a database cannot be reached from a
     document with no build step and no environment. */
  needsProject: boolean;
  /* True when this raised the stack past what stack.ts chose. The caller uses it
     to decide whether to ask first — see the header. */
  promoted: boolean;
  /* Whether the answer is safe to spend a build on without asking. False means
     the layers were inferred from the shape of the brief rather than read off
     it. */
  certain: boolean;
};

/* ── What each kind is, before the brief says anything ─────────────────────
 *
 * The blueprint defaults, and the one place the product decisions in the spec
 * live as data rather than as prose inside a prompt. A store has a merchant
 * behind it; that is what distinguishes a store from a page with products drawn
 * on it. A publication has an editor. A landing page has neither and must not
 * grow them by accident.
 *
 * `webapp` is the deliberate blank. "Web app" covers a CRM and a unit
 * converter, and a default that gives the converter a users table is the same
 * mistake in the other direction — so it starts at nothing and every layer it
 * gets is one the brief asked for. stack.ts has already read that brief for
 * auth and persistence, and its answer is merged in below.
 */
const DEFAULTS: Record<BuildKind, Partial<Record<Layer, true>>> = {
  landing: {},
  ecommerce: {
    backend: true,
    database: true,
    authentication: true,
    admin: true,
    storage: true,
  },
  blog: {
    backend: true,
    database: true,
    authentication: true,
    admin: true,
    storage: true,
  },
  news: {
    backend: true,
    database: true,
    authentication: true,
    admin: true,
    storage: true,
  },
  webapp: {},
};

/* Why each kind's defaults are what they are, in the words that go in the step
   list. Only read for kinds that have defaults. */
const DEFAULT_REASON: Partial<Record<BuildKind, string>> = {
  ecommerce: "a store has a merchant behind it — products, orders and stock are managed, not typed into the page",
  blog: "a blog is written and edited by somebody, so the posts live in a database rather than in the markup",
  news: "a publication is edited by somebody, so the articles live in a database rather than in the markup",
};

/* ── Signals ───────────────────────────────────────────────────────────────
 *
 * Three layers stack.ts does not read for, because they were not its question.
 * Auth and database are not re-derived here — StackNeeds already holds a careful
 * reading of both, and a second set of regexes over the same brief is two
 * answers that will disagree.
 */

/* A back office. Note what is not here: "dashboard" on its own, which is the
   single most common word for a screen in a marketing mockup and means an admin
   about half the time. stack.ts already treats it as soft evidence, and adding
   it here would turn every "analytics dashboard" landing page into a CMS. */
const ADMIN = [
  /\b(admin (?:panel|area|dashboard|side|interface)|wp-?admin|back ?office)\b/i,
  /\b(cms|content management|headless cms|editor(?:ial)? (?:interface|dashboard))\b/i,
  /\b(manage|manageable|managing|edit|add|update)\b[^.]{0,30}\b(products?|posts?|articles?|orders?|inventory|stock|content|listings?|catalogue|catalog|users?|customers?)\b/i,
  /\b(merchant|seller|vendor|staff|editor|publisher)\b[^.]{0,20}\b(dashboard|portal|area|panel|interface|side|account)\b/i,
  /\b(publish|unpublish|draft)\b[^.]{0,20}\b(posts?|articles?|pages?|products?)\b/i,
];

/* Files that have to exist after the request that uploaded them. An <img> in a
   design is not storage; an upload button is. */
const STORAGE = [
  /\b(upload|uploading|uploads?)\b/i,
  /\b(media (?:library|manager)|file (?:manager|storage)|image (?:library|manager))\b/i,
  /\b(avatars?|profile (?:pictures?|photos?)|user (?:images?|photos?))\b/i,
  /\b(attach|attachments?|documents?|pdfs?)\b[^.]{0,24}\b(store|save|keep|upload)\b/i,
];

/* Money actually changing hands. "Price" and "pricing" are absent on purpose:
   every landing page on earth has a pricing section and none of them charge
   anybody. */
const PAYMENTS = [
  /\b(stripe|paystack|flutterwave|paypal|square|adyen|razorpay|mollie|braintree|monnify|interswitch)\b/i,
  /\b(payment(?:s| gateway| processing| provider)?|checkout process|take (?:card )?payments?)\b/i,
  /\b(subscriptions?|recurring billing|billing (?:portal|system)|invoices?)\b/i,
  /\b(card payments?|credit cards?|pay online|online payments?)\b/i,
];

/* Somebody saying, in as many words, that the back half is not wanted. Held
   above every default: a person who writes "no backend" has made this decision
   and the builder is not entitled to overrule them. Deliberately narrower than
   stack.ts's equivalent — that one also catches "mockup" and "one-pager", which
   are statements about the stack rather than about the layers. */
const NO_BACKEND = [
  /\bno (?:back[- ]?end|database|admin|cms|accounts?|logins?|auth\w*|users?|server|payments?)\b/i,
  /\bwithout (?:a )?(?:back[- ]?end|database|admin|cms|accounts?|auth\w*|server|payments?)\b/i,
  /\b(?:just|only) the (?:front[- ]?end|design|ui|storefront|markup|theme)\b/i,
  /\b(?:front[- ]?end|design|ui) only\b/i,
  /\bstatic (?:site|page|html)\b/i,
  /\bmock-?up\b/i,
];

function firstMatch(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found) return found[0].toLowerCase();
  }
  return null;
}

/** A manifest with nothing on but the half every project has. */
function frontendOnly(kind: BuildKind): ArchitectureManifest {
  return {
    type: kind,
    frontend: true,
    backend: false,
    database: false,
    authentication: false,
    admin: false,
    storage: false,
    payments: false,
  };
}

/**
 * Which layers this project has, and why.
 *
 * Deterministic and free. Never throws: a brief nobody can read gets the
 * frontend and nothing else, which is the safe half of a wrong answer here for
 * the same reason it is in stack.ts — a project that should have had a database
 * can be rebuilt, and a landing page that arrived with one has already cost
 * somebody a schema they have to go and delete.
 */
export function decideArchitecture(
  brief: string,
  kind: BuildKind,
  needs: StackNeeds,
): ArchitectureResult {
  const text = brief ?? "";
  const why: string[] = [];

  /* Refusal first, and it ends the question. Everything below this line is the
     builder inferring what somebody probably wants; this is them saying it. */
  const refused = firstMatch(NO_BACKEND, text);
  if (refused) {
    return {
      manifest: frontendOnly(kind),
      why: [`"${refused}" — the front end is what was asked for`],
      needsProject: false,
      promoted: false,
      certain: true,
    };
  }

  const defaults = DEFAULTS[kind] ?? {};
  const manifest = frontendOnly(kind);

  /* The kind's own shape. A store is a store whether or not the brief spells
     out that products have to be managed. */
  const fromKind = Object.keys(defaults) as Layer[];
  if (fromKind.length > 0) {
    for (const layer of fromKind) manifest[layer] = true;
    const reason = DEFAULT_REASON[kind];
    if (reason) why.push(reason);
  }

  /* What stack.ts already read off the brief, rather than read again. Its two
     answers are the two layers it was looking for. */
  if (needs.auth) {
    manifest.authentication = true;
    manifest.backend = true;
    manifest.database = true;
  }
  if (needs.backend) {
    manifest.backend = true;
    manifest.database = true;
  }
  for (const clause of needs.why) why.push(clause);

  /* And the three it was not. */
  const adminPhrase = firstMatch(ADMIN, text);
  if (adminPhrase) {
    manifest.admin = true;
    /* An admin is a back office over stored data reached by somebody who signed
       in. Turning it on without those is a menu with nothing behind it. */
    manifest.backend = true;
    manifest.database = true;
    manifest.authentication = true;
    why.push(`"${adminPhrase}" is somebody managing this from the inside`);
  }

  const storagePhrase = firstMatch(STORAGE, text);
  if (storagePhrase) {
    manifest.storage = true;
    manifest.backend = true;
    why.push(`"${storagePhrase}" is a file that has to still be there afterwards`);
  }

  const paymentsPhrase = firstMatch(PAYMENTS, text);
  if (paymentsPhrase) {
    manifest.payments = true;
    manifest.backend = true;
    manifest.database = true;
    why.push(`"${paymentsPhrase}" is money actually changing hands`);
  }

  /* A store that takes orders takes them somewhere, and an order is a row. This
     is the one place a layer implies another after the fact rather than at the
     point it was turned on: payments without a database is a checkout that
     charges a card and forgets the sale. */
  if (manifest.payments) manifest.database = true;
  /* An admin nobody can sign into is a public back office. */
  if (manifest.admin) manifest.authentication = true;
  /* Anything past the frontend needs somewhere for the data to be. */
  if (manifest.authentication || manifest.admin || manifest.storage) manifest.backend = true;
  if (manifest.backend && (manifest.authentication || manifest.admin)) manifest.database = true;

  const needsProject = LAYERS.some((layer) => layer !== "frontend" && manifest[layer]);

  if (!needsProject) {
    return {
      manifest,
      why: why.length > 0 ? why : ["nothing here needs data, accounts or a back office"],
      needsProject: false,
      promoted: false,
      certain: true,
    };
  }

  /* Raising the stack. Only ever upward — a brief that stack.ts already read as
     a project is not talked back down to a page by this file, because the
     evidence it found is evidence this one has not seen.

     The promotion is a guess exactly when the layers came from the kind rather
     than from the brief. "Build me a shop" is the case: nothing in it asked for
     a database, and a store without one is not a store, but the person may
     genuinely have wanted the storefront on its own. So it promotes and says it
     is not certain, and the caller asks. */
  const promoted = needs.stack !== "nextjs";
  const certain = needs.certain && (!promoted || Boolean(adminPhrase || storagePhrase || paymentsPhrase));

  return { manifest, why, needsProject: true, promoted, certain };
}

/** The layers that are on, in build order. Frontend is included: it is a layer. */
export function activeLayers(manifest: ArchitectureManifest): Layer[] {
  return LAYERS.filter((layer) => manifest[layer]);
}

/**
 * The manifest as a sentence, for the step list and the thread.
 *
 * Names the layers rather than the count, because "6 layers" tells somebody
 * nothing they can check and "frontend, backend, database, authentication,
 * admin and storage" tells them exactly what they are about to be given.
 */
export function describeArchitecture(manifest: ArchitectureManifest): string {
  const layers = activeLayers(manifest).map((layer) => LAYER_LABEL[layer].toLowerCase());
  if (layers.length === 1) return "Front end only";

  const last = layers[layers.length - 1];
  return `${layers.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * The question to put to somebody when the layers were inferred rather than
 * read.
 *
 * Asked about the product rather than about the architecture: "does this store
 * need a back office" is a question a person who sells things can answer, and
 * "do you want the database and authentication layers" is not.
 */
export function architectureQuestion(kind: BuildKind, manifest: ArchitectureManifest): string {
  const thing = kind === "ecommerce" ? "store" : kind === "news" ? "publication" : "site";
  const managed =
    kind === "ecommerce" ? "products, stock and orders" : "posts, categories and media";

  return `Two ways to build this ${thing}.

**The real thing** — a ${thing} with a database behind it and an admin area where you manage ${managed}. What you change in the admin changes on the site. People can sign in. This takes longer to build and gives you something you can actually run.

**The front of it** — the ${thing} exactly as a visitor sees it, with the ${
    kind === "ecommerce" ? "catalogue" : "writing"
  } built into the page. Faster, and right if what you want now is the design.

Which one?`;
}

/** The two answers, for the chips the question is offered with. */
export function architectureOptions(
  kind: BuildKind,
): { value: "full" | "frontend"; label: string; blurb: string }[] {
  const thing = kind === "ecommerce" ? "store" : kind === "news" ? "publication" : "site";

  return [
    {
      value: "full",
      label: "The real thing",
      blurb: `Database, accounts and an admin area. A ${thing} you can run.`,
    },
    {
      value: "frontend",
      label: "The front of it",
      blurb: "The design, with the content in the page. Faster.",
    },
  ];
}

/** Whether a value came back from the browser as one of the two answers. */
export function isArchitectureChoice(value: unknown): value is "full" | "frontend" {
  return value === "full" || value === "frontend";
}

/**
 * The manifest once somebody has answered the question.
 *
 * The missing half of this file. `decideArchitecture` has always known when it
 * was guessing and said so in `certain`, `architectureQuestion` has always had
 * the words to ask, and `architectureOptions` has always had the two chips —
 * and nothing anywhere read any of them, so every guess was spent on instead
 * of asked about. This is what an answer does to the decision.
 *
 * FRONTEND is a real answer and not a smaller version of the other one: it
 * turns every layer off, which is the whole point. Somebody who says they want
 * the front of a store has said they do not want a schema migrated into a
 * database, an admin nobody will open, or a Next.js project where a page would
 * do.
 *
 * FULL keeps exactly what was decided, because the question is only ever asked
 * when layers are already on — see `certain`, which is true whenever
 * `needsProject` is false. There is no minimum to apply and nothing to invent.
 *
 * Both come back `certain: true`. The question has been answered; asking again
 * on the next message would be the builder forgetting.
 */
export function architectureFromChoice(
  choice: "full" | "frontend",
  kind: BuildKind,
  decided: ArchitectureResult,
): ArchitectureResult {
  if (choice === "frontend") {
    return {
      manifest: frontendOnly(kind),
      why: ["you chose the front of it, so nothing behind it is built"],
      needsProject: false,
      promoted: false,
      certain: true,
    };
  }

  return { ...decided, certain: true };
}

/**
 * The manifest as the model is shown it.
 *
 * A block rather than a sentence, and the OFF layers are listed as well as the
 * on ones. That asymmetry is the whole value: a model told "this project has a
 * database" will build an admin for it unprompted, and a model told "this
 * project has no admin" will not. The absent instruction is the one that gets
 * invented.
 */
export function architectureBrief(manifest: ArchitectureManifest): string {
  const on = LAYERS.filter((layer) => manifest[layer]);
  const off = LAYERS.filter((layer) => !manifest[layer]);

  const lines = [
    "PROJECT ARCHITECTURE — what this project is made of.",
    "",
    "This was decided before you were called, from the brief and the kind of product. It is not a suggestion and not a starting point to improve on: build every layer listed under HAS, and do not build anything listed under HAS NOT.",
    "",
    `HAS: ${on.map((layer) => LAYER_LABEL[layer]).join(", ")}`,
  ];

  if (off.length > 0) {
    lines.push(
      `HAS NOT: ${off.map((layer) => LAYER_LABEL[layer]).join(", ")} — do not build these, do not stub them, do not leave a link pointing at one.`,
    );
  }

  return lines.join("\n");
}

/**
 * The manifest with layers added, and never with any taken away.
 *
 * Capability was decided once, at build time, and was immutable thereafter.
 * That is the reason this system leans toward giving every project everything
 * up front: if the first build guesses low there is no way back except a full
 * rebuild, which discards the page somebody has been working on. Make it
 * additive and the pressure to over-provision goes with it — a project can
 * start as the front of a shop and become a shop.
 *
 * ADDITIVE IS A RULE, not an implementation detail. A later message that does
 * not mention the database must never be read as a request to remove it: a
 * customer's tables, their rows and their auth users are not something a
 * classifier gets to decide about. Removal is a separate, explicit act.
 *
 * The implication chains from decideArchitecture are applied again here, for
 * the same reasons they exist there — an admin nobody can sign into is a public
 * back office, and payments with no database is a checkout that charges a card
 * and forgets the sale.
 */
export function raiseArchitecture(
  current: ArchitectureManifest,
  add: readonly Layer[],
): { manifest: ArchitectureManifest; added: Layer[] } {
  const manifest: ArchitectureManifest = { ...current, frontend: true };

  for (const layer of add) {
    if (layer === "frontend") continue;
    manifest[layer] = true;
  }

  if (manifest.payments) manifest.database = true;
  if (manifest.admin) manifest.authentication = true;
  if (manifest.authentication || manifest.admin || manifest.storage) manifest.backend = true;
  if (manifest.backend && (manifest.authentication || manifest.admin)) manifest.database = true;

  const added = LAYERS.filter((layer) => manifest[layer] && !current[layer]);
  return { manifest, added };
}

/**
 * What a capability upgrade is called where somebody reads it.
 *
 * Named as the thing they asked for rather than as the layers, because "adding
 * accounts, which needs a database behind them" is a sentence somebody can
 * agree or disagree with, and "authentication, backend, database" is a list
 * they have to translate first.
 */
export function describeUpgrade(added: readonly Layer[]): string {
  const names = added.map((layer) => LAYER_LABEL[layer].toLowerCase());
  if (names.length === 0) return "";
  if (names.length === 1) return `adding ${names[0]}`;

  const last = names[names.length - 1];
  return `adding ${names.slice(0, -1).join(", ")} and ${last}`;
}
